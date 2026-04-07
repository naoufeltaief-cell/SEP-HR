"""Schedule routes — CRUD with recurrence, publish, bulk operations, week approval, import/export"""
from datetime import timedelta, date as date_type, datetime
import io, csv, re, logging
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from ..database import get_db
from ..models.models import Schedule, ScheduleApproval, Employee, Client, new_id
from ..models.schemas import ScheduleCreate, ScheduleUpdate, ScheduleOut
from ..services.auth_service import require_admin, get_current_user

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
@router.get("/")
async def list_schedules(
    start: str = Query(None, description="Start date YYYY-MM-DD"),
    end: str = Query(None, description="End date YYYY-MM-DD"),
    employee_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user)
):
    q = select(Schedule)
    if start:
        q = q.where(Schedule.date >= start)
    if end:
        q = q.where(Schedule.date <= end)
    if employee_id:
        q = q.where(Schedule.employee_id == employee_id)
    if user.role == "employee" and user.employee_id:
        q = q.where(Schedule.employee_id == user.employee_id)
        q = q.where(Schedule.status == "published")
    q = q.order_by(Schedule.date, Schedule.start)
    result = await db.execute(q)
    schedules = result.scalars().all()

    # Fallback: if historical schedules have no client_id, use employee default client_id
    employee_ids = list({s.employee_id for s in schedules if getattr(s, "employee_id", None)})
    employee_client_map = {}
    if employee_ids:
        emp_result = await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
        for emp in emp_result.scalars().all():
            if getattr(emp, "client_id", None):
                employee_client_map[emp.id] = emp.client_id

    for s in schedules:
        if not getattr(s, "client_id", None):
            fallback_client_id = employee_client_map.get(s.employee_id)
            if fallback_client_id:
                s.client_id = fallback_client_id

    return [ScheduleOut.model_validate(s) for s in schedules]


@router.post("/", status_code=201)
async def create_schedule(data: ScheduleCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    dates = _expand_dates(data)
    group_id = new_id() if len(dates) > 1 else None
    created = []
    effective_rate = data.billable_rate
    if not effective_rate and data.employee_id:
        emp_result = await db.execute(select(Employee).where(Employee.id == data.employee_id))
        employee = emp_result.scalar_one_or_none()
        if employee and getattr(employee, "rate", 0):
            effective_rate = employee.rate
    for d in dates:
        sched = Schedule(
            id=new_id(), employee_id=data.employee_id, date=d,
            start=data.start, end=data.end, hours=data.hours, pause=data.pause,
            location=data.location, billable_rate=effective_rate,
            status=data.status, notes=data.notes, client_id=data.client_id,
            km=data.km, deplacement=data.deplacement, autre_dep=data.autre_dep,
            garde_hours=data.garde_hours, rappel_hours=data.rappel_hours,
            mandat_start=data.mandat_start, mandat_end=data.mandat_end,
            recurrence_group=group_id,
        )
        db.add(sched)
        created.append(sched)
    await db.commit()
    # For single creation, return the full schedule object (frontend needs it)
    if len(created) == 1:
        await db.refresh(created[0])
        return ScheduleOut.model_validate(created[0])
    return {"created": len(created), "ids": [s.id for s in created]}


# ── STATIC routes BEFORE /{sid} ──

@router.post("/publish-all")
async def publish_all(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.status == "draft"))
    count = 0
    for sched in result.scalars().all():
        sched.status = "published"
        count += 1
    await db.commit()
    return {"published": count}


# ── CSV / Excel IMPORT ──

def _normalise_time(raw: str) -> str:
    """Convert time string to HH:MM format."""
    if not raw or not str(raw).strip():
        return "00:00"
    raw = str(raw).strip()
    # Handle "7:00" → "07:00", "15:15" stays, "0:00" → "00:00"
    m = re.match(r'^(\d{1,2}):(\d{2})(?::\d{2})?$', raw)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return "00:00"


def _safe_float(val, default=0.0):
    try:
        if val is None or str(val).strip() == '':
            return default
        return float(str(val).strip().replace(',', '.'))
    except (ValueError, TypeError):
        return default


def _clean_text(value) -> str:
    raw = str(value or "").strip()
    return "" if raw.lower() == "nan" else raw


def _normalize_lookup(value: str) -> str:
    raw = unicodedata.normalize("NFKD", _clean_text(value).lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _normalize_email(value: str) -> str:
    return _clean_text(value).strip().lower()


def _employee_name_keys(name: str) -> set[str]:
    norm = _normalize_lookup(name)
    if not norm:
        return set()
    parts = norm.split()
    keys = {norm}
    if len(parts) >= 2:
        keys.add(f"{parts[0]} {parts[-1]}")
        keys.add(f"{parts[-1]} {parts[0]}")
        keys.add(" ".join(reversed(parts)))
    return {key for key in keys if key}


def _row_employee_keys(prenom: str, nom: str) -> list[str]:
    first = _normalize_lookup(prenom)
    last = _normalize_lookup(nom)
    keys = []
    for candidate in (
        f"{first} {last}".strip(),
        f"{last} {first}".strip(),
        f"{first.split()[0] if first else ''} {last.split()[-1] if last else ''}".strip(),
        f"{last.split()[-1] if last else ''} {first.split()[0] if first else ''}".strip(),
    ):
        if candidate and candidate not in keys:
            keys.append(candidate)
    return keys


@router.post("/import-csv")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Import schedules from CSV or Excel file.
    
    Expected CSV columns (from AgendRH export):
    Prénom, Nom, Numero_employe, Courriel, Date_du_quart, Heure_debut, Heure_fin,
    Heures_travaillees, Taux_horaire, Temps de Préparation, Cout, Equipe, Position,
    Lieu, Code_lieu, Sous_lieu, Code_sous_lieu, Statut, Note, Note_employe, Note_interne,
    Assigne_par, Date_assignation
    """
    import pandas as pd

    # ── Read file ──
    content = await file.read()
    fname = (file.filename or "").lower()
    try:
        if fname.endswith(".xlsx") or fname.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(content), dtype=str)
        else:
            # Try utf-8, then latin-1
            try:
                df = pd.read_csv(io.BytesIO(content), dtype=str, encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(content), dtype=str, encoding="latin-1")
    except Exception as exc:
        raise HTTPException(400, f"Impossible de lire le fichier: {exc}")

    if df.empty:
        return {"success": 0, "errors": 0, "error_details": [], "message": "Fichier vide"}

    # ── Normalize column names ──
    col_map = {
        'prénom': 'prenom', 'prenom': 'prenom',
        'nom': 'nom',
        'numero_employe': 'numero_employe',
        'courriel': 'courriel',
        'date_du_quart': 'date_du_quart',
        'heure_debut': 'heure_debut',
        'heure_fin': 'heure_fin',
        'heures_travaillees': 'heures_travaillees',
        'taux_horaire': 'taux_horaire',
        'temps de préparation': 'temps_preparation',
        'temps de preparation': 'temps_preparation',
        'cout': 'cout', 'coût': 'cout',
        'equipe': 'equipe', 'équipe': 'equipe',
        'position': 'position',
        'lieu': 'lieu',
        'code_lieu': 'code_lieu',
        'sous_lieu': 'sous_lieu',
        'code_sous_lieu': 'code_sous_lieu',
        'statut': 'statut',
        'note': 'note',
        'note_employe': 'note_employe',
        'note_interne': 'note_interne',
        'assigne_par': 'assigne_par',
        'date_assignation': 'date_assignation',
    }
    df.columns = [col_map.get(c.strip().lower().replace('é', 'e').replace('ê', 'e').replace('û', 'u').replace('ô', 'o'), c.strip().lower()) for c in df.columns]
    # More robust: remap with accent-insensitive matching
    remap = {}
    for orig_col in df.columns:
        norm = orig_col.strip().lower()
        for k, v in col_map.items():
            if norm == k or norm.replace('é', 'e').replace('ê', 'e').replace('û', 'u').replace('ô', 'o') == k:
                remap[orig_col] = v
                break
    if remap:
        df.rename(columns=remap, inplace=True)

    # ── Load employees and clients from DB ──
    emp_result = await db.execute(select(Employee))
    employees = emp_result.scalars().all()
    emp_by_name = {}
    emp_by_email = {}

    def _index_employee(emp: Employee):
        for key in _employee_name_keys(emp.name):
            emp_by_name[key] = emp
        email_key = _normalize_email(getattr(emp, "email", "") or "")
        if email_key:
            emp_by_email[email_key] = emp

    for e in employees:
        _index_employee(e)

    client_result = await db.execute(select(Client))
    clients_db = client_result.scalars().all()
    client_by_name = {c.name.strip().lower(): c for c in clients_db}

    existing_sched_result = await db.execute(select(Schedule))
    existing_schedule_index = {
        (
            s.employee_id,
            s.date.isoformat() if hasattr(s.date, "isoformat") else str(s.date),
            _normalise_time(s.start),
            _normalise_time(s.end),
        ): s
        for s in existing_sched_result.scalars().all()
    }

    created_employees = 0
    replaced_schedule_keys = set()
    for _, row in df.iterrows():
        raw_prenom = _clean_text(row.get('prenom', ''))
        raw_nom = _clean_text(row.get('nom', ''))
        row_email = _normalize_email(row.get('courriel', ''))
        display_name = " ".join(part for part in [raw_prenom, raw_nom] if part).strip()
        position = _clean_text(row.get('position', ''))

        seeded_emp = emp_by_email.get(row_email) if row_email else None
        if not seeded_emp:
            for key in _row_employee_keys(raw_prenom, raw_nom):
                seeded_emp = emp_by_name.get(key)
                if seeded_emp:
                    break
        if not seeded_emp:
            lookup_tokens = set(" ".join(_row_employee_keys(raw_prenom, raw_nom)).split())
            if lookup_tokens:
                best_match = None
                best_score = 0
                for existing_emp in employees:
                    existing_tokens = set(_normalize_lookup(existing_emp.name).split())
                    score = len(lookup_tokens & existing_tokens)
                    if score > best_score and score >= min(2, len(lookup_tokens)):
                        best_match = existing_emp
                        best_score = score
                seeded_emp = best_match
        if not seeded_emp and display_name:
            rate_hint = _safe_float(row.get('taux_horaire'), 0)
            seeded_emp = Employee(
                name=display_name,
                position=position,
                phone="",
                email=row_email,
                rate=rate_hint or 0,
                is_active=True,
            )
            db.add(seeded_emp)
            await db.flush()
            employees.append(seeded_emp)
            _index_employee(seeded_emp)
            created_employees += 1
        if seeded_emp:
            full_name_key = f"{raw_prenom} {raw_nom}".strip().lower()
            reverse_name_key = f"{raw_nom} {raw_prenom}".strip().lower()
            if full_name_key:
                emp_by_name[full_name_key] = seeded_emp
            if reverse_name_key:
                emp_by_name[reverse_name_key] = seeded_emp
            date_str = _clean_text(row.get('date_du_quart', ''))
            if date_str:
                parsed_date = None
                try:
                    parsed_date = date_type.fromisoformat(date_str)
                except ValueError:
                    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d'):
                        try:
                            parsed_date = datetime.strptime(date_str, fmt).date()
                            break
                        except ValueError:
                            continue
                if parsed_date:
                    start_time = _normalise_time(row.get('heure_debut', ''))
                    end_time = _normalise_time(row.get('heure_fin', ''))
                    schedule_key = (seeded_emp.id, parsed_date.isoformat(), start_time, end_time)
                    existing_sched = existing_schedule_index.get(schedule_key)
                    if existing_sched and schedule_key not in replaced_schedule_keys:
                        await db.delete(existing_sched)
                        existing_schedule_index.pop(schedule_key, None)
                        replaced_schedule_keys.add(schedule_key)

    # ── Process rows ──
    success_count = 0
    created_count = 0
    updated_count = 0
    error_details = []
    created_ids = []
    changed = False

    for idx, row in df.iterrows():
        row_num = idx + 2  # +2 for header + 0-indexed
        try:
            # ── Find employee ──
            prenom = str(row.get('prenom', '') or '').strip()
            nom = str(row.get('nom', '') or '').strip()
            full_name = f"{prenom} {nom}".strip().lower()
            reverse_name = f"{nom} {prenom}".strip().lower()
            
            emp = emp_by_name.get(full_name) or emp_by_name.get(reverse_name)
            if not emp:
                # Try partial matching
                for key, e in emp_by_name.items():
                    if prenom.lower() in key and nom.lower() in key:
                        emp = e
                        break
            if not emp:
                error_details.append({"row": row_num, "error": f"Employé introuvable: {prenom} {nom}"})
                continue

            # ── Parse date ──
            date_str = str(row.get('date_du_quart', '') or '').strip()
            if not date_str or date_str == 'nan':
                error_details.append({"row": row_num, "error": "Date manquante"})
                continue
            try:
                shift_date = date_type.fromisoformat(date_str)
            except ValueError:
                # Try other formats
                for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d'):
                    try:
                        shift_date = datetime.strptime(date_str, fmt).date()
                        break
                    except ValueError:
                        continue
                else:
                    error_details.append({"row": row_num, "error": f"Format de date invalide: {date_str}"})
                    continue

            # ── Parse times ──
            start_time = _normalise_time(row.get('heure_debut', ''))
            end_time = _normalise_time(row.get('heure_fin', ''))

            # ── Parse numeric fields ──
            hours = _safe_float(row.get('heures_travaillees'), 0)
            rate = _safe_float(row.get('taux_horaire'), 0)
            prep = _safe_float(row.get('temps_preparation'), 0)

            # ── Location ──
            lieu = str(row.get('lieu', '') or '').strip()
            if lieu == 'nan':
                lieu = ''
            sous_lieu = str(row.get('sous_lieu', '') or '').strip()
            if sous_lieu and sous_lieu != 'nan':
                lieu = f"{lieu} - {sous_lieu}" if lieu else sous_lieu

            # ── Notes ──
            note_parts = []
            for nf in ('note', 'note_employe', 'note_interne'):
                v = str(row.get(nf, '') or '').strip()
                if v and v != 'nan':
                    note_parts.append(v)
            notes = '; '.join(note_parts)

            # ── Client lookup from location ──
            client_id = None
            if lieu:
                lieu_lower = lieu.lower()
                for cn, cl in client_by_name.items():
                    if cn in lieu_lower or lieu_lower in cn:
                        client_id = cl.id
                        break
            # Fallback to employee default client
            if not client_id and emp.client_id:
                client_id = emp.client_id

            # ── Status mapping ──
            statut_raw = str(row.get('statut', '') or '').strip().lower()
            if 'annul' in statut_raw:
                # Skip cancelled shifts
                continue
            elif statut_raw in ('quart assigné', 'quart assigne', 'assigné', 'assigne', 'publié', 'publie', 'published'):
                status = 'published'
            else:
                status = 'draft'

            # ── Create schedule record ──
            sched = Schedule(
                id=new_id(),
                employee_id=emp.id,
                date=shift_date,
                start=start_time,
                end=end_time,
                hours=hours,
                pause=0,
                location=lieu,
                billable_rate=rate,
                status=status,
                notes=notes,
                client_id=client_id,
                km=0,
                deplacement=0,
                autre_dep=0,
                garde_hours=0,
                rappel_hours=0,
            )
            db.add(sched)
            existing_schedule_index[(emp.id, shift_date.isoformat(), start_time, end_time)] = sched
            created_ids.append(sched.id)
            success_count += 1

        except Exception as exc:
            error_details.append({"row": row_num, "error": str(exc)})

    updated_count = len(replaced_schedule_keys)
    created_count = max(success_count - updated_count, 0)

    if created_ids or replaced_schedule_keys or created_employees:
        await db.commit()

    return {
        "success": success_count,
        "errors": len(error_details),
        "total_rows": len(df),
        "created": created_count,
        "updated": updated_count,
        "created_employees": created_employees,
        "error_details": error_details[:100],  # Cap at 100 errors
        "message": f"{success_count} quarts importés ou mis à jour avec succès"
                   + (f" ({created_count} créés, {updated_count} mis à jour" + (f", {created_employees} employés créés" if created_employees else "") + ")" if success_count else "")
                   + (f", {len(error_details)} erreurs" if error_details else ""),
    }


# ── CSV / Excel EXPORT ──

@router.get("/export-csv")
async def export_csv(
    date_start: str = Query(None),
    date_end: str = Query(None),
    employee_id: int = Query(None),
    client_id: int = Query(None),
    format: str = Query("csv", description="csv or xlsx"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Export schedules as CSV or Excel file."""
    import pandas as pd

    q = select(Schedule)
    if date_start:
        q = q.where(Schedule.date >= date_start)
    if date_end:
        q = q.where(Schedule.date <= date_end)
    if employee_id:
        q = q.where(Schedule.employee_id == employee_id)
    if client_id:
        q = q.where(Schedule.client_id == client_id)
    q = q.order_by(Schedule.date, Schedule.start)

    result = await db.execute(q)
    schedules = result.scalars().all()

    # Load employees and clients for display names
    emp_result = await db.execute(select(Employee))
    emp_map = {e.id: e for e in emp_result.scalars().all()}
    client_result = await db.execute(select(Client))
    client_map = {c.id: c for c in client_result.scalars().all()}

    rows = []
    for s in schedules:
        emp = emp_map.get(s.employee_id)
        cl = client_map.get(s.client_id) if s.client_id else None
        emp_name = emp.name if emp else ""
        name_parts = emp_name.split(maxsplit=1)
        prenom = name_parts[0] if name_parts else ""
        nom = name_parts[1] if len(name_parts) > 1 else ""

        rows.append({
            "Prénom": prenom,
            "Nom": nom,
            "Employé_ID": s.employee_id,
            "Courriel": emp.email if emp else "",
            "Date": str(s.date),
            "Début": s.start,
            "Fin": s.end,
            "Heures": s.hours,
            "Pause": s.pause,
            "Taux horaire": s.billable_rate,
            "Lieu": s.location or "",
            "Client": cl.name if cl else "",
            "Client_ID": s.client_id or "",
            "KM": s.km,
            "Déplacement": s.deplacement,
            "Autre dépense": s.autre_dep,
            "Heures garde": s.garde_hours,
            "Heures rappel": s.rappel_hours,
            "Statut": s.status,
            "Notes": s.notes or "",
        })

    df = pd.DataFrame(rows)

    if format == "xlsx":
        buf = io.BytesIO()
        df.to_excel(buf, index=False, engine="openpyxl")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=horaires_export.xlsx"},
        )
    else:
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        content = buf.getvalue().encode("utf-8-sig")  # BOM for Excel compatibility
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=horaires_export.csv"},
        )


@router.post("/approve-week")
async def approve_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    week_start_str = data.get("week_start")
    approved_by = data.get("approved_by", getattr(user, "email", "admin"))
    notes = data.get("notes", "")
    if not all([employee_id, client_id, week_start_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    ws = date_type.fromisoformat(week_start_str)
    if ws.weekday() != 6:
        ws = ws - timedelta(days=(ws.weekday() + 1) % 7)
    we = ws + timedelta(days=6)
    result = await db.execute(select(ScheduleApproval).where(
        ScheduleApproval.employee_id == employee_id,
        ScheduleApproval.client_id == client_id,
        ScheduleApproval.week_start == ws,
    ))
    existing = result.scalar_one_or_none()
    if existing:
        existing.status = "approved"
        existing.approved_by = approved_by
        existing.approved_at = datetime.utcnow()
        existing.notes = notes
        await db.commit()
        await db.refresh(existing)
        return {"id": existing.id, "status": "approved", "message": "Semaine re-approuvee"}
    approval = ScheduleApproval(
        employee_id=employee_id, client_id=client_id,
        week_start=ws, week_end=we,
        approved_by=approved_by, status="approved", notes=notes,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    return {"id": approval.id, "status": "approved", "week_start": str(ws), "week_end": str(we), "message": "Semaine approuvee"}


@router.post("/revoke-week")
async def revoke_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    ws_str = data.get("week_start")
    if not all([employee_id, client_id, ws_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    result = await db.execute(select(ScheduleApproval).where(
        ScheduleApproval.employee_id == employee_id,
        ScheduleApproval.client_id == client_id,
        ScheduleApproval.week_start == date_type.fromisoformat(ws_str),
    ))
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(404, "Aucune approbation trouvee")
    approval.status = "rejected"
    await db.commit()
    return {"message": "Approbation revoquee", "status": "rejected"}


@router.get("/approvals")
async def list_approvals(
    employee_id: int = None,
    client_id: int = None,
    week_start: str = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    q = select(ScheduleApproval)
    if employee_id:
        q = q.where(ScheduleApproval.employee_id == employee_id)
    if client_id:
        q = q.where(ScheduleApproval.client_id == client_id)
    if week_start:
        q = q.where(ScheduleApproval.week_start == date_type.fromisoformat(week_start))
    result = await db.execute(q.order_by(ScheduleApproval.week_start.desc()))
    return [
        {
            "id": a.id, "employee_id": a.employee_id, "client_id": a.client_id,
            "week_start": str(a.week_start), "week_end": str(a.week_end),
            "status": a.status, "approved_by": a.approved_by,
            "approved_at": a.approved_at.isoformat() if a.approved_at else None,
            "notes": a.notes,
        }
        for a in result.scalars().all()
    ]


# ── PARAMETERIZED routes /{sid} AFTER static routes ──

@router.put("/{sid}")
async def update_schedule(sid: str, data: ScheduleUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    updates = data.model_dump(exclude_unset=True)
    if "billable_rate" in updates and not updates["billable_rate"] and getattr(sched, "billable_rate", 0):
        updates.pop("billable_rate")
    for k, v in updates.items():
        setattr(sched, k, v)
    await db.commit()
    await db.refresh(sched)
    return ScheduleOut.model_validate(sched)


@router.delete("/{sid}")
async def delete_schedule(sid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    await db.delete(sched)
    await db.commit()
    return {"message": "Quart supprime"}


@router.post("/{sid}/publish")
async def publish_one(sid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    sched.status = "published"
    await db.commit()
    return {"message": "Quart publie"}


def _expand_dates(data: ScheduleCreate):
    if not data.recurrence or data.recurrence == "once":
        return [data.date]
    end = data.recurrence_end or data.date + timedelta(days=6)
    dates = []
    d = data.date
    while d <= end:
        if data.recurrence == "daily":
            dates.append(d)
        elif data.recurrence == "weekdays":
            if d.weekday() < 5:
                dates.append(d)
        elif data.recurrence == "custom" and data.recurrence_days:
            py_day = (d.weekday() + 1) % 7
            if py_day in data.recurrence_days:
                dates.append(d)
        d += timedelta(days=1)
    return dates if dates else [data.date]
