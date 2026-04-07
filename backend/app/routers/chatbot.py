"""
Soins Expert Plus — Dual Agent System
OpenAI Responses API + business tools.
"""
import os
import json
import re
import unicodedata
import httpx
import imaplib
import email as email_lib
from email.header import decode_header
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from ..database import get_db
from ..models.models import Employee, Schedule, Client, Accommodation, new_id
from ..models.models_invoice import Invoice
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin
from ..services.billing_gmail_oauth import get_billing_gmail_connection, list_recent_billing_gmail_messages
from ..services.email_service import _send_email, BILLING_SENDER_EMAIL
from ..services.invoice_service import generate_invoice_number, recalculate_invoice, is_tax_exempt, get_rate_for_title, GARDE_RATE, KM_RATE, MAX_KM, MAX_DEPLACEMENT_HOURS

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1")
IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_USER = (
    os.getenv("IMAP_USER_PAIE")
    or os.getenv("IMAP_USER")
    or os.getenv("SMTP_USER_PAIE")
    or os.getenv("SMTP_USER")
    or BILLING_SENDER_EMAIL
)
IMAP_PASS = (
    os.getenv("IMAP_PASS_PAIE")
    or os.getenv("IMAP_PASS")
    or os.getenv("SMTP_PASS_PAIE")
    or os.getenv("SMTP_PASS")
    or ""
)

BUSINESS_KNOWLEDGE = """
TAUX DE FACTURATION PAR TITRE D'EMPLOI:
- Infirmier(ère) / Infirmier(ère) Clinicien(ne): 86.23 $/h
- Infirmier(ère) auxiliaire: 57.18 $/h
- Préposé(e) aux bénéficiaires (PAB): 50.35 $/h
- Éducateur(trice): Variable selon entente
- Agent administratif: Variable selon entente

RÈGLES DE FACTURATION:
- Période de facturation: Dimanche au Samedi
- Garde: 8 heures de garde = 1 heure facturable au taux de 86.23$/h
- Kilométrage: 0.525 $/km (max 750 km aller, 1500 km aller-retour)
- Déplacement: Max 8 heures par déplacement, facturable une seule fois par assignation
- Exception CISSS Gaspésie: déplacement remboursé une seule fois par assignation
- Hébergement: coût total / nombre total de quarts travaillés sur la période d'hébergement, puis multiplié par les quarts de la période facturée
- TPS: 5% (numéro: 714564891RT0001)
- TVQ: 9.975% (numéro: 1225765936TQ0001)
- Clients exemptés de taxes: Centre de Santé Inuulitsivik, Conseil Cri de la Santé
"""

RAW_TOOLS = [
    {"name": "search_employees", "description": "Rechercher des employés par nom, poste ou email.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "search_clients", "description": "Rechercher des clients par nom.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "get_employee_schedule", "description": "Obtenir l'horaire d'un employé pour une période donnée.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "start_date": {"type": "string"}, "end_date": {"type": "string"}}, "required": []}},
    {"name": "generate_invoice_for_employee", "description": "Générer une facture brouillon à partir des horaires d'un employé pour une période donnée. Utiliser quand on te demande explicitement de générer une facture.", "input_schema": {"type": "object", "properties": {"employee_name": {"type": "string"}, "employee_id": {"type": "integer"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}}, "required": ["period_start", "period_end"]}},
    {"name": "read_recent_emails", "description": "Lire les courriels récents de la boîte de réception.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 10}, "search": {"type": "string"}, "folder": {"type": "string", "default": "INBOX"}}}},
    {"name": "generate_current_invoice_for_employee", "description": "Generer une facture brouillon pour la periode actuelle de facturation d'un employe.", "input_schema": {"type": "object", "properties": {"employee_name": {"type": "string"}, "employee_id": {"type": "integer"}, "client_name": {"type": "string"}, "client_id": {"type": "integer"}}, "required": []}},
    {"name": "send_email", "description": "Envoyer un courriel.", "input_schema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body_html": {"type": "string"}}, "required": ["to", "subject", "body_html"]}},
    {"name": "create_schedule_shift", "description": "Creer un quart dans l'horaire. Les heures doivent etre en format 24 h HH:MM.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "date": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "pause_minutes": {"type": "number"}, "pause_hours": {"type": "number"}, "hours": {"type": "number"}, "location": {"type": "string"}, "billable_rate": {"type": "number"}, "status": {"type": "string"}, "notes": {"type": "string"}, "km": {"type": "number"}, "deplacement": {"type": "number"}, "autre_dep": {"type": "number"}, "garde_hours": {"type": "number"}, "rappel_hours": {"type": "number"}}, "required": ["date", "start", "end"]}},
    {"name": "update_schedule_shift", "description": "Modifier un quart existant. Utiliser schedule_id en priorite. Sinon identifier le quart avec employe + current_date + current_start.", "input_schema": {"type": "object", "properties": {"schedule_id": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "current_date": {"type": "string"}, "current_start": {"type": "string"}, "current_end": {"type": "string"}, "date": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "pause_minutes": {"type": "number"}, "pause_hours": {"type": "number"}, "hours": {"type": "number"}, "location": {"type": "string"}, "billable_rate": {"type": "number"}, "status": {"type": "string"}, "notes": {"type": "string"}, "km": {"type": "number"}, "deplacement": {"type": "number"}, "autre_dep": {"type": "number"}, "garde_hours": {"type": "number"}, "rappel_hours": {"type": "number"}}, "required": []}},
    {"name": "delete_schedule_shift", "description": "Supprimer un quart existant. Utiliser schedule_id en priorite. Sinon identifier le quart avec employe + current_date + current_start.", "input_schema": {"type": "object", "properties": {"schedule_id": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "current_date": {"type": "string"}, "current_start": {"type": "string"}, "current_end": {"type": "string"}}, "required": []}},
    {"name": "get_candidates", "description": "Lister les employés actifs, avec filtres par titre/région, pour soumission ou assignation.", "input_schema": {"type": "object", "properties": {"title_filter": {"type": "string"}, "region_filter": {"type": "string"}}}},
    {"name": "get_invoices_summary", "description": "Obtenir un résumé des factures avec filtre optionnel par statut ou client.", "input_schema": {"type": "object", "properties": {"status_filter": {"type": "string"}, "client_id": {"type": "integer"}}}},
    {"name": "get_reports", "description": "Obtenir les rapports facturation par client, employé ou période.", "input_schema": {"type": "object", "properties": {"report_type": {"type": "string", "enum": ["by-client", "by-employee", "by-period"]}}, "required": ["report_type"]}},
    {"name": "get_accommodations", "description": "Obtenir la liste des hébergements actifs pour les employés.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}}},
    {"name": "create_accommodation_record", "description": "Ajouter un hebergement pour un employe.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "start_date": {"type": "string"}, "end_date": {"type": "string"}, "total_cost": {"type": "number"}, "days_worked": {"type": "integer"}, "cost_per_day": {"type": "number"}, "notes": {"type": "string"}}, "required": ["start_date", "end_date", "total_cost"]}},
    {"name": "get_business_info", "description": "Obtenir les informations business.", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}}},
]
TOOLS = [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"], "strict": False} for t in RAW_TOOLS]


def _norm(s: str) -> str:
    raw = unicodedata.normalize("NFKD", (s or "").strip().lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()

async def _find_employee(db: AsyncSession, employee_id=None, employee_name=None):
    if employee_id:
        r = await db.execute(select(Employee).where(Employee.id == employee_id))
        return r.scalar_one_or_none()
    if employee_name:
        q = _norm(employee_name)
        r = await db.execute(select(Employee))
        emps = r.scalars().all()
        exact = [e for e in emps if _norm(e.name) == q]
        if exact:
            active_exact = [e for e in exact if getattr(e, "is_active", False)]
            return active_exact[0] if active_exact else exact[0]
        partial = [e for e in emps if q in _norm(e.name)]
        if len(partial) == 1:
            return partial[0]
        if partial:
            active_partial = [e for e in partial if getattr(e, "is_active", False)]
            if len(active_partial) == 1:
                return active_partial[0]
            if active_partial:
                return active_partial[0]
    return None


async def _find_client(db: AsyncSession, client_id=None, client_name=None):
    if client_id:
        result = await db.execute(select(Client).where(Client.id == client_id))
        return result.scalar_one_or_none()
    if client_name:
        q = _norm(client_name)
        result = await db.execute(select(Client))
        clients = result.scalars().all()
        exact = [c for c in clients if _norm(c.name) == q]
        if exact:
            return exact[0]
        partial = [c for c in clients if q in _norm(c.name)]
        if len(partial) == 1:
            return partial[0]
    return None


def _parse_date_value(value, field_name="date"):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_name} manquant")
    try:
        return date.fromisoformat(raw[:10])
    except ValueError as exc:
        raise ValueError(f"{field_name} invalide. Utilise YYYY-MM-DD.") from exc


def _current_billing_period(reference_date=None):
    current = reference_date or date.today()
    days_since_sunday = (current.weekday() + 1) % 7
    period_start = current - timedelta(days=days_since_sunday)
    period_end = period_start + timedelta(days=6)
    return period_start, period_end


def _normalize_time_value(value, field_name="heure"):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_name} manquante")
    raw = raw.replace("h", ":").replace("H", ":").replace(".", ":")
    if ":" not in raw:
        if len(raw) <= 2 and raw.isdigit():
            raw = f"{int(raw):02d}:00"
        elif len(raw) == 4 and raw.isdigit():
            raw = f"{int(raw[:2]):02d}:{raw[2:]}"
    parts = raw.split(":")
    if len(parts) < 2:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.")
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError as exc:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.") from exc
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.")
    return f"{hours:02d}:{minutes:02d}"


def _time_to_minutes(value, field_name="heure"):
    normalized = _normalize_time_value(value, field_name)
    hours, minutes = normalized.split(":")
    return int(hours) * 60 + int(minutes)


def _get_float_value(input_data, *keys, default=None):
    for key in keys:
        if key in input_data and input_data.get(key) not in (None, ""):
            try:
                return float(input_data.get(key))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} invalide") from exc
    return default


def _get_pause_hours(input_data, default=None):
    pause_minutes = _get_float_value(input_data, "pause_minutes")
    if pause_minutes is not None:
        return round(pause_minutes / 60.0, 2)
    pause_hours = _get_float_value(input_data, "pause_hours", "pause")
    if pause_hours is not None:
        return round(pause_hours, 2)
    return default


def _calculate_schedule_hours(start_value, end_value, pause_hours=0):
    start_minutes = _time_to_minutes(start_value, "start")
    end_minutes = _time_to_minutes(end_value, "end")
    if end_minutes <= start_minutes:
        end_minutes += 24 * 60
    total_hours = (end_minutes - start_minutes) / 60.0 - float(pause_hours or 0)
    return round(max(total_hours, 0), 2)


def _serialize_schedule(shift, employee_name="", client_name=""):
    pause_hours = float(getattr(shift, "pause", 0) or 0)
    return {
        "id": shift.id,
        "employee_id": shift.employee_id,
        "employee_name": employee_name,
        "client_id": getattr(shift, "client_id", None),
        "client_name": client_name or "",
        "date": shift.date.isoformat() if hasattr(shift.date, "isoformat") else str(shift.date),
        "start": getattr(shift, "start", "") or "",
        "end": getattr(shift, "end", "") or "",
        "hours": round(float(getattr(shift, "hours", 0) or 0), 2),
        "pause_hours": round(pause_hours, 2),
        "pause_minutes": int(round(pause_hours * 60)),
        "location": getattr(shift, "location", "") or "",
        "status": getattr(shift, "status", "") or "",
        "notes": getattr(shift, "notes", "") or "",
        "billable_rate": float(getattr(shift, "billable_rate", 0) or 0),
        "km": float(getattr(shift, "km", 0) or 0),
        "deplacement": float(getattr(shift, "deplacement", 0) or 0),
        "autre_dep": float(getattr(shift, "autre_dep", 0) or 0),
        "garde_hours": float(getattr(shift, "garde_hours", 0) or 0),
        "rappel_hours": float(getattr(shift, "rappel_hours", 0) or 0),
    }


async def _find_schedule(
    db: AsyncSession,
    schedule_id=None,
    employee_id=None,
    employee_name=None,
    client_id=None,
    client_name=None,
    current_date=None,
    current_start=None,
    current_end=None,
):
    if schedule_id:
        result = await db.execute(select(Schedule).where(Schedule.id == str(schedule_id)))
        shift = result.scalar_one_or_none()
        if shift:
            return shift, None
        return None, "Quart introuvable"

    employee = await _find_employee(db, employee_id, employee_name)
    if not employee:
        return None, "Employe introuvable"
    if not current_date or not current_start:
        return None, "Fournis schedule_id ou employe + current_date + current_start."

    target_date = _parse_date_value(current_date, "current_date")
    target_start = _normalize_time_value(current_start, "current_start")
    query = select(Schedule).where(
        Schedule.employee_id == employee.id,
        Schedule.date == target_date,
        Schedule.start == target_start,
    )

    if current_end:
        query = query.where(Schedule.end == _normalize_time_value(current_end, "current_end"))

    client = None
    if client_id or client_name:
        client = await _find_client(db, client_id, client_name)
        if not client:
            return None, "Client introuvable"
        query = query.where(Schedule.client_id == client.id)

    result = await db.execute(query.order_by(Schedule.date, Schedule.start))
    matches = result.scalars().all()
    if len(matches) == 1:
        return matches[0], None
    if not matches:
        return None, "Quart introuvable"
    return None, "Plusieurs quarts correspondent. Fournis schedule_id pour etre plus precis."


async def _get_schedule_names(db: AsyncSession, shift):
    employee_name = ""
    client_name = ""
    if getattr(shift, "employee_id", None):
        employee_result = await db.execute(select(Employee).where(Employee.id == shift.employee_id))
        employee = employee_result.scalar_one_or_none()
        employee_name = employee.name if employee else ""
    if getattr(shift, "client_id", None):
        client_result = await db.execute(select(Client).where(Client.id == shift.client_id))
        client = client_result.scalar_one_or_none()
        client_name = client.name if client else ""
    return employee_name, client_name

async def _build_invoice_from_schedules(
    db: AsyncSession,
    employee,
    period_start: str,
    period_end: str,
    client_id=None,
    client_name=None,
):
    ps = date.fromisoformat(period_start)
    pe = date.fromisoformat(period_end)
    scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee.id, Schedule.date >= ps, Schedule.date <= pe, Schedule.status != 'cancelled').order_by(Schedule.date))
    scheds = scheds_r.scalars().all()
    if not scheds:
        return {"error": "Aucun quart trouvé pour cette période"}
    selected_client = await _find_client(db, client_id, client_name) if (client_id or client_name) else None
    if (client_id or client_name) and not selected_client:
        return {"error": "Client introuvable pour cette facture"}
    client_ids = sorted({s.client_id for s in scheds if getattr(s, 'client_id', None)})
    effective_client = None
    if selected_client:
        effective_client = selected_client
        scheds = [
            s for s in scheds
            if getattr(s, 'client_id', None) == selected_client.id
            or (not getattr(s, 'client_id', None) and getattr(employee, 'client_id', None) == selected_client.id)
        ]
        if not scheds:
            return {"error": "Aucun quart trouve pour ce client dans cette periode"}
    elif len(client_ids) == 1:
        cr = await db.execute(select(Client).where(Client.id == client_ids[0]))
        effective_client = cr.scalar_one_or_none()
    elif len(client_ids) == 0 and getattr(employee, 'client_id', None):
        cr = await db.execute(select(Client).where(Client.id == employee.client_id))
        effective_client = cr.scalar_one_or_none()
        scheds = [s for s in scheds if not getattr(s, 'client_id', None) or s.client_id == employee.client_id]
    else:
        return {"error": f"Client ambigu pour cette période: {client_ids}"}
    if not effective_client:
        return {"error": "Aucun client associé trouvé pour cette période"}
    existing = await db.execute(select(Invoice).where(Invoice.employee_id == employee.id, Invoice.client_id == effective_client.id, Invoice.period_start == ps, Invoice.period_end == pe, Invoice.status != 'cancelled'))
    existing = existing.scalar_one_or_none()
    if existing:
        return {"id": existing.id, "number": existing.number, "status": existing.status, "total": existing.total, "client_name": existing.client_name, "employee_name": existing.employee_name, "message": "Facture déjà existante"}
    rate = get_rate_for_title(employee.position or 'Infirmier(ère)')
    include_tax = not is_tax_exempt(effective_client.name)
    lines, expense_lines = [], []
    for s in scheds:
        hours = round((getattr(s, 'hours', 0) or 0), 2)
        garde_h = getattr(s, 'garde_hours', 0) or 0
        rappel_h = getattr(s, 'rappel_hours', 0) or 0
        garde_billable = garde_h / 8.0 if garde_h else 0
        lines.append({"date": s.date.isoformat() if hasattr(s.date, 'isoformat') else str(s.date), "employee": employee.name or '', "location": effective_client.name, "start": getattr(s, 'start', '') or '', "end": getattr(s, 'end', '') or '', "pause_min": getattr(s, 'pause', 0) or 0, "hours": hours, "rate": rate, "service_amount": round(hours * rate, 2), "garde_hours": garde_h, "garde_amount": round(garde_billable * GARDE_RATE, 2), "rappel_hours": rappel_h, "rappel_amount": round(rappel_h * rate, 2)})
        km_val = getattr(s, 'km', 0) or 0
        if km_val:
            capped = min(float(km_val), MAX_KM)
            expense_lines.append({"type": "km", "description": f"Kilométrage ({s.date})", "quantity": capped, "rate": KM_RATE, "amount": round(capped * KM_RATE, 2)})
        depl_val = getattr(s, 'deplacement', 0) or 0
        if depl_val:
            capped = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
            expense_lines.append({"type": "deplacement", "description": f"Déplacement ({s.date})", "quantity": capped, "rate": rate, "amount": round(capped * rate, 2)})
        autre_val = getattr(s, 'autre_dep', 0) or 0
        if autre_val:
            expense_lines.append({"type": "autre", "description": f"Autres frais ({s.date})", "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})
    accom_r = await db.execute(select(Accommodation).where(Accommodation.employee_id == employee.id, Accommodation.start_date <= pe, Accommodation.end_date >= ps))
    accom_records = accom_r.scalars().all()
    all_scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee.id, Schedule.status != 'cancelled'))
    all_scheds = all_scheds_r.scalars().all()
    all_worked = sorted({s.date for s in all_scheds})
    billed_worked = sorted({s.date for s in scheds})
    accommodation_lines = []
    for a in accom_records:
        full_span_worked = [d for d in all_worked if a.start_date <= d <= a.end_date]
        billed_span_worked = [d for d in billed_worked if max(ps, a.start_date) <= d <= min(pe, a.end_date)]
        if not billed_span_worked:
            continue
        total_cost = float(getattr(a, 'total_cost', 0) or 0)
        denom = len(full_span_worked) or int(getattr(a, 'days_worked', 0) or 0) or 1
        cpd = round(total_cost / denom, 2) if total_cost else float(getattr(a, 'cost_per_day', 0) or 0)
        accommodation_lines.append({"employee": employee.name or '', "period": f"{max(ps, a.start_date).isoformat()} → {min(pe, a.end_date).isoformat()}", "days": len(billed_span_worked), "cost_per_day": cpd, "amount": round(cpd * len(billed_span_worked), 2)})
    inv = Invoice(number=await generate_invoice_number(db), date=date.today(), period_start=ps, period_end=pe, client_id=effective_client.id, client_name=effective_client.name, client_address=getattr(effective_client, 'address', '') or '', client_email=getattr(effective_client, 'email', '') or '', client_phone=getattr(effective_client, 'phone', '') or '', employee_id=employee.id, employee_name=employee.name or '', employee_title=employee.position or '', include_tax=include_tax, status='draft', lines=lines, accommodation_lines=accommodation_lines, expense_lines=expense_lines, extra_lines=[])
    inv = recalculate_invoice(inv)
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return {"id": inv.id, "number": inv.number, "status": inv.status, "total": inv.total, "client_name": inv.client_name, "employee_name": inv.employee_name, "period_start": period_start, "period_end": period_end}

async def execute_tool(name: str, input_data: dict, db: AsyncSession) -> str:
    try:
        if name == 'search_employees':
            q = _norm(input_data.get('query', ''))
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            employees = result.scalars().all()
            matches = [e for e in employees if q in _norm(e.name) or q in _norm(e.position or '') or q in _norm(e.email or '')]
            return json.dumps([{"id": e.id, "name": e.name, "position": e.position, "rate": e.rate, "email": e.email, "phone": e.phone, "client_id": e.client_id} for e in matches[:20]], ensure_ascii=False)
        if name == 'search_clients':
            q = _norm(input_data.get('query', ''))
            result = await db.execute(select(Client))
            clients = result.scalars().all()
            matches = [c for c in clients if q in _norm(c.name)]
            return json.dumps([{"id": c.id, "name": c.name, "email": getattr(c, 'email', ''), "address": getattr(c, 'address', ''), "tax_exempt": getattr(c, 'tax_exempt', False)} for c in matches[:20]], ensure_ascii=False)
        if name == 'get_employee_schedule':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employé introuvable"
            q = select(Schedule).where(Schedule.employee_id == emp.id)
            if input_data.get('start_date'):
                q = q.where(Schedule.date >= input_data['start_date'])
            if input_data.get('end_date'):
                q = q.where(Schedule.date <= input_data['end_date'])
            q = q.order_by(Schedule.date, Schedule.start)
            result = await db.execute(q)
            shifts = result.scalars().all()
            client_ids = sorted({s.client_id for s in shifts if getattr(s, 'client_id', None)})
            client_map = {}
            if client_ids:
                client_result = await db.execute(select(Client).where(Client.id.in_(client_ids)))
                client_map = {c.id: c.name for c in client_result.scalars().all()}
            return json.dumps({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "shifts": [_serialize_schedule(s, emp.name, client_map.get(s.client_id, "")) for s in shifts],
                "total_hours": round(sum(float(getattr(s, 'hours', 0) or 0) for s in shifts), 2),
                "total_shifts": len(shifts),
            }, ensure_ascii=False)
        if name == 'generate_invoice_for_employee':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employé introuvable pour génération de facture"
            period_start = input_data.get('period_start')
            period_end = input_data.get('period_end')
            if not period_start or not period_end:
                current_start, current_end = _current_billing_period()
                period_start = current_start.isoformat()
                period_end = current_end.isoformat()
            result = await _build_invoice_from_schedules(
                db,
                emp,
                period_start,
                period_end,
                input_data.get('client_id'),
                input_data.get('client_name'),
            )
            return json.dumps(result, ensure_ascii=False)
        if name == 'generate_current_invoice_for_employee':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour generation de facture"
            period_start, period_end = _current_billing_period()
            result = await _build_invoice_from_schedules(
                db,
                emp,
                period_start.isoformat(),
                period_end.isoformat(),
                input_data.get('client_id'),
                input_data.get('client_name'),
            )
            if isinstance(result, dict) and 'period_start' not in result:
                result['period_start'] = period_start.isoformat()
                result['period_end'] = period_end.isoformat()
            return json.dumps(result, ensure_ascii=False)
        if name == 'read_recent_emails':
            gmail_connection = await get_billing_gmail_connection(db)
            try:
                gmail_result = await list_recent_billing_gmail_messages(
                    db,
                    max_results=input_data.get('max_results', 10),
                    search=input_data.get('search', ''),
                    folder=input_data.get('folder', 'INBOX'),
                    unread_only=bool(input_data.get('unread_only')),
                )
                if gmail_result:
                    return json.dumps(gmail_result, ensure_ascii=False)
            except Exception as gmail_error:
                if gmail_connection and getattr(gmail_connection, 'is_active', False) and getattr(gmail_connection, 'refresh_token', ''):
                    return f"Lecture du courriel paie impossible: {str(gmail_error)}"
                if not IMAP_USER or not IMAP_PASS:
                    return f"Lecture du courriel paie impossible: {str(gmail_error)}"
            if not IMAP_USER or not IMAP_PASS:
                return "Configuration IMAP manquante."
            try:
                mail = imaplib.IMAP4_SSL(IMAP_HOST)
                mail.login(IMAP_USER, IMAP_PASS)
                folder = input_data.get('folder', 'INBOX')
                mail.select(folder)
                search_criteria = 'UNSEEN' if input_data.get('unread_only') else 'ALL'
                if input_data.get('search'):
                    s = input_data['search']
                    if input_data.get('unread_only'):
                        search_criteria = f'(UNSEEN OR (FROM "{s}") (SUBJECT "{s}"))'
                    else:
                        search_criteria = f'(OR (FROM "{s}") (SUBJECT "{s}"))'
                _, msg_nums = mail.search(None, search_criteria)
                nums = msg_nums[0].split()
                max_r = input_data.get('max_results', 10)
                recent = nums[-max_r:] if len(nums) > max_r else nums
                emails = []
                for num in reversed(recent):
                    _, msg_data = mail.fetch(num, '(RFC822)')
                    msg = email_lib.message_from_bytes(msg_data[0][1])
                    subject = decode_header(msg['Subject'] or '')[0]
                    subject = subject[0].decode(subject[1] or 'utf-8') if isinstance(subject[0], bytes) else str(subject[0])
                    from_addr = msg['From'] or ''
                    date_str = msg['Date'] or ''
                    body = ''
                    has_pdf = False
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == 'text/plain':
                                body = part.get_payload(decode=True).decode('utf-8', errors='replace')[:500]
                            if part.get_filename() and part.get_filename().lower().endswith('.pdf'):
                                has_pdf = True
                    else:
                        body = msg.get_payload(decode=True).decode('utf-8', errors='replace')[:500]
                    emails.append({"from": from_addr, "subject": subject, "date": date_str[:25], "body_preview": body[:200], "has_pdf_attachment": has_pdf})
                mail.logout()
                return json.dumps({"mailbox": IMAP_USER, "folder": folder, "items": emails}, ensure_ascii=False)
            except Exception as e:
                return f"Erreur lecture emails: {str(e)}"
        if name == 'send_email':
            await _send_email(input_data['to'], input_data['subject'], input_data['body_html'])
            return f"Courriel envoyé à {input_data['to']}: {input_data['subject']}"
        if name == 'create_schedule_shift':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour creation de quart"
            client = None
            if input_data.get('client_id') or input_data.get('client_name'):
                client = await _find_client(db, input_data.get('client_id'), input_data.get('client_name'))
                if not client:
                    return "Client introuvable pour creation de quart"
            shift_date = _parse_date_value(input_data.get('date'))
            start_value = _normalize_time_value(input_data.get('start'), 'start')
            end_value = _normalize_time_value(input_data.get('end'), 'end')
            pause_hours = _get_pause_hours(input_data, default=0) or 0
            hours = _get_float_value(input_data, 'hours', default=None)
            if hours is None:
                hours = _calculate_schedule_hours(start_value, end_value, pause_hours)
            shift = Schedule(
                id=new_id(),
                employee_id=emp.id,
                client_id=client.id if client else getattr(emp, 'client_id', None),
                date=shift_date,
                start=start_value,
                end=end_value,
                hours=hours,
                pause=pause_hours,
                location=(input_data.get('location') or '').strip(),
                billable_rate=_get_float_value(input_data, 'billable_rate', default=float(getattr(emp, 'rate', 0) or 0)) or 0,
                status=(input_data.get('status') or 'published').strip() or 'published',
                notes=(input_data.get('notes') or '').strip(),
                km=_get_float_value(input_data, 'km', default=0) or 0,
                deplacement=_get_float_value(input_data, 'deplacement', default=0) or 0,
                autre_dep=_get_float_value(input_data, 'autre_dep', 'other_dep', default=0) or 0,
                garde_hours=_get_float_value(input_data, 'garde_hours', default=0) or 0,
                rappel_hours=_get_float_value(input_data, 'rappel_hours', default=0) or 0,
            )
            db.add(shift)
            await db.commit()
            await db.refresh(shift)
            _, client_name = await _get_schedule_names(db, shift)
            return json.dumps({
                "message": "Quart cree",
                "shift": _serialize_schedule(shift, emp.name, client_name),
            }, ensure_ascii=False)
        if name == 'update_schedule_shift':
            shift, error = await _find_schedule(
                db,
                schedule_id=input_data.get('schedule_id'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                current_date=input_data.get('current_date'),
                current_start=input_data.get('current_start'),
                current_end=input_data.get('current_end'),
            )
            if error:
                return error
            updates = {}
            if input_data.get('client_id') or input_data.get('client_name'):
                resolved_client = await _find_client(db, input_data.get('client_id'), input_data.get('client_name'))
                if not resolved_client:
                    return "Client introuvable pour mise a jour du quart"
                updates['client_id'] = resolved_client.id
            if input_data.get('date'):
                updates['date'] = _parse_date_value(input_data.get('date'))
            if input_data.get('start'):
                updates['start'] = _normalize_time_value(input_data.get('start'), 'start')
            if input_data.get('end'):
                updates['end'] = _normalize_time_value(input_data.get('end'), 'end')
            pause_hours = _get_pause_hours(input_data, default=None)
            if pause_hours is not None:
                updates['pause'] = pause_hours
            for text_key in ('location', 'status', 'notes'):
                if text_key in input_data and input_data.get(text_key) is not None:
                    updates[text_key] = str(input_data.get(text_key) or '').strip()
            numeric_map = {
                'billable_rate': ('billable_rate',),
                'hours': ('hours',),
                'km': ('km',),
                'deplacement': ('deplacement',),
                'autre_dep': ('autre_dep', 'other_dep'),
                'garde_hours': ('garde_hours',),
                'rappel_hours': ('rappel_hours',),
            }
            for target_key, source_keys in numeric_map.items():
                value = _get_float_value(input_data, *source_keys, default=None)
                if value is not None:
                    updates[target_key] = value
            if 'hours' not in updates and any(key in updates for key in ('start', 'end', 'pause')):
                updates['hours'] = _calculate_schedule_hours(
                    updates.get('start', shift.start),
                    updates.get('end', shift.end),
                    updates.get('pause', float(getattr(shift, 'pause', 0) or 0)),
                )
            if not updates:
                return "Aucune modification demandee pour ce quart"
            for key, value in updates.items():
                setattr(shift, key, value)
            await db.commit()
            await db.refresh(shift)
            employee_name, client_name = await _get_schedule_names(db, shift)
            return json.dumps({
                "message": "Quart mis a jour",
                "shift": _serialize_schedule(shift, employee_name, client_name),
            }, ensure_ascii=False)
        if name == 'delete_schedule_shift':
            shift, error = await _find_schedule(
                db,
                schedule_id=input_data.get('schedule_id'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                current_date=input_data.get('current_date'),
                current_start=input_data.get('current_start'),
                current_end=input_data.get('current_end'),
            )
            if error:
                return error
            employee_name, client_name = await _get_schedule_names(db, shift)
            snapshot = _serialize_schedule(shift, employee_name, client_name)
            await db.delete(shift)
            await db.commit()
            return json.dumps({"message": "Quart supprime", "shift": snapshot}, ensure_ascii=False)
        if name == 'get_candidates':
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            emps = result.scalars().all()
            title_filter = _norm(input_data.get('title_filter', ''))
            region_filter = _norm(input_data.get('region_filter', ''))
            matches = []
            for e in emps:
                if title_filter and title_filter not in _norm(e.position or ''):
                    continue
                if region_filter and region_filter not in _norm(getattr(e, 'address', '') or '') and region_filter not in _norm(getattr(e, 'city', '') or ''):
                    continue
                matches.append({"id": e.id, "name": e.name, "position": e.position, "email": e.email, "phone": e.phone, "rate": e.rate})
            return json.dumps(matches[:50], ensure_ascii=False)
        if name == 'get_invoices_summary':
            q = select(Invoice).order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            if input_data.get('status_filter'):
                q = select(Invoice).where(Invoice.status == input_data['status_filter']).order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            if input_data.get('client_id'):
                base = select(Invoice).where(Invoice.client_id == input_data['client_id'])
                if input_data.get('status_filter'):
                    base = base.where(Invoice.status == input_data['status_filter'])
                q = base.order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            result = await db.execute(q)
            invs = result.scalars().all()
            total = sum(float(getattr(i, 'total', 0) or 0) for i in invs)
            outstanding = sum(float(getattr(i, 'balance_due', 0) or 0) for i in invs)
            return json.dumps({"count": len(invs), "total": round(total, 2), "outstanding": round(outstanding, 2), "items": [{"id": i.id, "number": i.number, "client_name": i.client_name, "employee_name": i.employee_name, "status": i.status, "total": i.total, "balance_due": i.balance_due} for i in invs[:20]]}, ensure_ascii=False)
        if name == 'get_reports':
            result = await db.execute(select(Invoice).where(Invoice.status != 'cancelled').order_by(desc(Invoice.date)))
            invs = result.scalars().all()
            rtype = input_data['report_type']
            if rtype == 'by-client':
                agg = {}
                for i in invs:
                    key = i.client_name or 'Non assigné'
                    agg.setdefault(key, {"client_name": key, "total": 0, "count": 0, "outstanding": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["outstanding"] += float(i.balance_due or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['total'], reverse=True), ensure_ascii=False)
            if rtype == 'by-employee':
                agg = {}
                for i in invs:
                    key = i.employee_name or 'Non assigné'
                    agg.setdefault(key, {"employee_name": key, "total": 0, "count": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['total'], reverse=True), ensure_ascii=False)
            if rtype == 'by-period':
                agg = {}
                for i in invs:
                    key = i.date.strftime('%Y-%m') if i.date else 'unknown'
                    agg.setdefault(key, {"period": key, "total": 0, "count": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['period']), ensure_ascii=False)
        if name == 'get_accommodations':
            emp = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            q = select(Accommodation)
            if emp:
                q = q.where(Accommodation.employee_id == emp.id)
            result = await db.execute(q)
            accoms = result.scalars().all()
            data = []
            for a in accoms:
                er = await db.execute(select(Employee).where(Employee.id == a.employee_id))
                e = er.scalar_one_or_none()
                data.append({"id": a.id, "employee": e.name if e else '?', "employee_id": a.employee_id, "start": a.start_date.isoformat() if a.start_date else '', "end": a.end_date.isoformat() if a.end_date else '', "total_cost": a.total_cost, "days": a.days_worked, "cost_per_day": a.cost_per_day, "notes": getattr(a, 'notes', '') or ''})
            return json.dumps(data, ensure_ascii=False)
        if name == 'create_accommodation_record':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour hebergement"
            start_date = _parse_date_value(input_data.get('start_date'), 'start_date')
            end_date = _parse_date_value(input_data.get('end_date'), 'end_date')
            if end_date < start_date:
                return "La date de fin doit etre apres ou egale a la date de debut"
            total_cost = _get_float_value(input_data, 'total_cost', default=None)
            if total_cost is None:
                return "total_cost manquant pour l'hebergement"
            accommodation = Accommodation(
                id=new_id(),
                employee_id=emp.id,
                total_cost=total_cost,
                start_date=start_date,
                end_date=end_date,
                days_worked=int(_get_float_value(input_data, 'days_worked', default=0) or 0),
                cost_per_day=_get_float_value(input_data, 'cost_per_day', default=0) or 0,
                notes=(input_data.get('notes') or '').strip(),
            )
            db.add(accommodation)
            await db.commit()
            await db.refresh(accommodation)
            return json.dumps({
                "message": "Hebergement ajoute",
                "accommodation": {
                    "id": accommodation.id,
                    "employee_id": accommodation.employee_id,
                    "employee_name": emp.name,
                    "start_date": accommodation.start_date.isoformat(),
                    "end_date": accommodation.end_date.isoformat(),
                    "total_cost": float(accommodation.total_cost or 0),
                    "days_worked": int(accommodation.days_worked or 0),
                    "cost_per_day": float(accommodation.cost_per_day or 0),
                    "notes": accommodation.notes or "",
                },
            }, ensure_ascii=False)
        if name == 'get_business_info':
            return BUSINESS_KNOWLEDGE
        return f"Outil '{name}' non reconnu"
    except Exception as e:
        return f"Erreur outil {name}: {str(e)}"

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les horaires, les courriels, les hébergements, les rapports et générer des factures brouillon à partir des données déjà dans la plateforme. Quand on te demande de générer une facture, utilise l'outil generate_invoice_for_employee. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les employés actifs, lire les courriels, proposer des candidats et créer des quarts de travail. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as accès aux outils de facturation, recrutement, courriels et rapports. Utilise les outils dès qu'une action ou une donnée système est demandée. Réponds en français.\n\n" + BUSINESS_KNOWLEDGE

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu peux consulter la boite paie, lire les courriels recents, consulter et modifier les horaires, ajouter des hebergements et generer des factures brouillon a partir des donnees deja dans la plateforme. Quand on te demande de creer une facture pour la periode actuelle, utilise l'outil generate_current_invoice_for_employee. Pour une periode precise, utilise l'outil generate_invoice_for_employee. Quand on te demande de modifier un quart, utilise les outils create_schedule_shift, update_schedule_shift ou delete_schedule_shift. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu peux consulter les employes actifs, lire les courriels, proposer des candidats et creer, modifier ou supprimer des quarts de travail. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as acces aux outils de facturation, recrutement, courriels, hebergements et horaires. Utilise les outils des qu'une action ou une donnee systeme est demandee. Si l'utilisateur demande une modification de quart, un ajout d'hebergement, une lecture de courriel paie ou la generation d'une facture, execute l'action demandee puis resume le resultat. Quand l'utilisateur parle de la periode actuelle de facturation, utilise l'outil generate_current_invoice_for_employee. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais.\n\n" + BUSINESS_KNOWLEDGE

def _detect_prompt(message: str):
    m = message.lower()
    if any(kw in m for kw in ['factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impay', 'conciliation', 'courriel', 'email', 'hebergement', 'hébergement']):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in ['candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation', 'placement', 'horaire', 'quart']):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    if any(kw in m for kw in ['factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impayé', 'conciliation']):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in ['candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation', 'placement']):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    return GENERAL_PROMPT, 'general'

def _history_to_input(history, user_message):
    items = []
    for m in history or []:
        items.append({"role": m.get('role', 'user'), "content": str(m.get('content', ''))})
    items.append({"role": 'user', "content": user_message})
    return items

def _extract_text(data):
    if data.get('output_text'):
        return data['output_text']
    texts = []
    for item in data.get('output', []) or []:
        if item.get('type') == 'message':
            for c in item.get('content', []) or []:
                if c.get('type') in ('output_text', 'text') and c.get('text'):
                    texts.append(c['text'])
    return '\n'.join(texts).strip()

@router.post('/chat')
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail='Clé API OpenAI non configurée. Ajouter OPENAI_API_KEY dans les variables d\'environnement Render.')
    system_prompt, agent_name = _detect_prompt(msg.message)
    inputs = _history_to_input(msg.history, msg.message)
    headers = {'Authorization': f'Bearer {OPENAI_API_KEY}', 'Content-Type': 'application/json'}
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            data = None
            for _ in range(8):
                resp = await client.post('https://api.openai.com/v1/responses', headers=headers, json={'model': OPENAI_MODEL, 'instructions': system_prompt, 'input': inputs, 'tools': TOOLS, 'parallel_tool_calls': False})
                resp.raise_for_status()
                data = resp.json()
                tool_calls = [item for item in data.get('output', []) if item.get('type') == 'function_call']
                if not tool_calls:
                    break
                inputs.extend(data.get('output', []))
                for call in tool_calls:
                    try:
                        args = json.loads(call.get('arguments') or '{}')
                    except Exception:
                        args = {}
                    result = await execute_tool(call.get('name', ''), args, db)
                    inputs.append({'type': 'function_call_output', 'call_id': call.get('call_id'), 'output': result})
            return {'reply': _extract_text(data or {}) or "Je n'ai pas pu générer de réponse.", 'usage': (data or {}).get('usage', {}), 'agent': agent_name, 'model': OPENAI_MODEL}
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f'Erreur API OpenAI: {e.response.text}')
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
