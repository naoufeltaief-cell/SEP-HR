from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from email.utils import parseaddr
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models import (
    Accommodation,
    AccommodationAttachment,
    Client,
    Employee,
    InvoiceAttachment,
    ScheduleApproval,
    Timesheet,
    TimesheetAttachment,
    TimesheetShift,
    new_id,
)
from ..models.models_invoice import Invoice, InvoiceStatus
from ..models.models_schedule_review import ScheduleApprovalAttachment

_FRENCH_MONTHS = {
    "janvier": 1,
    "fevrier": 2,
    "février": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "août": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
    "décembre": 12,
}
_MONTH_LABELS = {
    1: "Janvier",
    2: "Février",
    3: "Mars",
    4: "Avril",
    5: "Mai",
    6: "Juin",
    7: "Juillet",
    8: "Août",
    9: "Septembre",
    10: "Octobre",
    11: "Novembre",
    12: "Décembre",
}
_ATTACHMENT_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "gif"}


def _norm(value: str) -> str:
    raw = unicodedata.normalize("NFKD", (value or "").strip().lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9@.\- ]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _attachment_extension(filename: str = "", content_type: str = "") -> str:
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].strip().lower()
        if ext in _ATTACHMENT_EXTENSIONS:
            return ext
    content = (content_type or "").strip().lower()
    if content == "application/pdf":
        return "pdf"
    if content in {"image/jpeg", "image/jpg"}:
        return "jpg"
    if content == "image/png":
        return "png"
    if content == "image/gif":
        return "gif"
    return "bin"


def completed_billing_period(reference_date: Optional[date] = None) -> tuple[date, date]:
    ref = reference_date or date.today()
    completed_day = ref - timedelta(days=1)
    days_since_sunday = (completed_day.weekday() + 1) % 7
    period_start = completed_day - timedelta(days=days_since_sunday)
    return period_start, period_start + timedelta(days=6)


def format_french_period(period_start: date, period_end: date) -> str:
    start_month = _MONTH_LABELS.get(period_start.month, period_start.strftime("%B"))
    end_month = _MONTH_LABELS.get(period_end.month, period_end.strftime("%B"))
    if period_start.month == period_end.month and period_start.year == period_end.year:
        return f"du {period_start.day} au {period_end.day} {end_month}"
    if period_start.year == period_end.year:
        return f"du {period_start.day} {start_month} au {period_end.day} {end_month}"
    return f"du {period_start.day} {start_month} {period_start.year} au {period_end.day} {end_month} {period_end.year}"


def extract_period_from_text(text: str, reference_date: Optional[date] = None) -> Optional[tuple[date, date]]:
    raw = str(text or "").strip()
    if not raw:
        return None

    for start_text, end_text in re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b.*?\b(20\d{2}-\d{2}-\d{2})\b", raw, flags=re.IGNORECASE | re.DOTALL):
        try:
            start_date = date.fromisoformat(start_text)
            end_date = date.fromisoformat(end_text)
            if end_date >= start_date:
                return start_date, end_date
        except ValueError:
            continue

    lowered = raw.lower()
    month_pattern = "|".join(sorted((re.escape(name) for name in _FRENCH_MONTHS.keys()), key=len, reverse=True))
    range_pattern = re.compile(
        rf"(?:du\s+)?(\d{{1,2}})\s*(?:au|\-|a)\s*(\d{{1,2}})\s+({month_pattern})(?:\s+(20\d{{2}}))?",
        flags=re.IGNORECASE,
    )
    for start_day, end_day, month_name, year_value in range_pattern.findall(lowered):
        month_number = _FRENCH_MONTHS.get(month_name.lower())
        if not month_number:
            continue
        year_number = int(year_value or (reference_date or date.today()).year)
        try:
            start_date = date(year_number, month_number, int(start_day))
            end_date = date(year_number, month_number, int(end_day))
        except ValueError:
            continue
        if end_date >= start_date:
            return start_date, end_date

    return None


def serialize_timesheet_attachment(att: TimesheetAttachment) -> dict:
    return {
        "id": att.id,
        "timesheet_id": att.timesheet_id,
        "filename": att.filename,
        "original_filename": att.original_filename,
        "file_type": att.file_type,
        "file_size": att.file_size,
        "category": att.category,
        "description": att.description,
        "uploaded_by": att.uploaded_by,
        "source": att.source,
        "source_message_id": att.source_message_id,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


async def get_attachment_count_map(db: AsyncSession, model, fk_field, ids: Iterable) -> dict:
    ids = [item for item in ids if item is not None]
    if not ids:
        return {}
    result = await db.execute(
        select(fk_field, func.count(model.id))
        .where(fk_field.in_(ids))
        .group_by(fk_field)
    )
    return {row[0]: int(row[1] or 0) for row in result.all()}


async def find_timesheet(
    db: AsyncSession,
    employee_id: int,
    period_start: date,
    period_end: date,
) -> Optional[Timesheet]:
    result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id == employee_id,
            Timesheet.period_start == period_start,
            Timesheet.period_end == period_end,
        )
    )
    return result.scalar_one_or_none()


async def ensure_timesheet_for_period(
    db: AsyncSession,
    employee_id: int,
    period_start: date,
    period_end: date,
    status: str = "received",
    notes: str = "",
) -> tuple[Timesheet, bool]:
    existing = await find_timesheet(db, employee_id, period_start, period_end)
    if existing:
        if notes:
            current = (existing.notes or "").strip()
            if notes.strip() and notes.strip() not in current:
                existing.notes = f"{current}\n{notes}".strip() if current else notes.strip()
        if status and existing.status in {"draft", "received"}:
            existing.status = status
        return existing, False

    timesheet = Timesheet(
        id=new_id(),
        employee_id=employee_id,
        period_start=period_start,
        period_end=period_end,
        status=status,
        notes=(notes or "").strip(),
    )
    db.add(timesheet)
    await db.flush()
    return timesheet, True


async def upsert_submitted_timesheet(db: AsyncSession, data) -> tuple[Timesheet, bool]:
    existing = await find_timesheet(db, data.employee_id, data.period_start, data.period_end)
    created = existing is None
    if existing:
        current = (existing.notes or "").strip()
        new_notes = (data.notes or "").strip()
        existing.notes = f"{current}\n{new_notes}".strip() if current and new_notes and new_notes not in current else (new_notes or current)
        existing.status = "submitted"
        shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == existing.id))
        for shift in shifts_result.scalars().all():
            await db.delete(shift)
        target = existing
    else:
        target = Timesheet(
            id=new_id(),
            employee_id=data.employee_id,
            period_start=data.period_start,
            period_end=data.period_end,
            status="submitted",
            notes=(data.notes or "").strip(),
        )
        db.add(target)
        await db.flush()

    for sh in data.shifts:
        db.add(
            TimesheetShift(
                id=new_id(),
                timesheet_id=target.id,
                schedule_id=sh.schedule_id,
                date=sh.date,
                hours_worked=sh.hours_worked,
                pause=sh.pause,
                garde_hours=sh.garde_hours,
                rappel_hours=sh.rappel_hours,
                start_actual=sh.start_actual,
                end_actual=sh.end_actual,
            )
        )
    await db.flush()
    return target, created


async def add_timesheet_attachment(
    db: AsyncSession,
    timesheet_id: str,
    filename: str,
    file_data: bytes,
    content_type: str = "",
    category: str = "fdt",
    description: str = "",
    uploaded_by: str = "admin",
    source: str = "manual",
    source_message_id: str = "",
) -> tuple[TimesheetAttachment, bool]:
    original_filename = filename or "document"
    duplicate_query = select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet_id)
    if source_message_id:
        duplicate_query = duplicate_query.where(TimesheetAttachment.source_message_id == source_message_id)
        result = await db.execute(duplicate_query)
        duplicates = result.scalars().all()
        for existing in duplicates:
            if existing.original_filename == original_filename:
                return existing, False
    else:
        result = await db.execute(duplicate_query)
        duplicates = result.scalars().all()
        for existing in duplicates:
            if existing.original_filename == original_filename and int(existing.file_size or 0) == len(file_data or b""):
                return existing, False

    ext = _attachment_extension(original_filename, content_type)
    stored_name = original_filename
    attachment = TimesheetAttachment(
        timesheet_id=timesheet_id,
        filename=stored_name,
        original_filename=original_filename,
        file_type=ext,
        file_size=len(file_data or b""),
        file_data=file_data,
        category=category or "fdt",
        description=(description or "").strip(),
        uploaded_by=(uploaded_by or "admin").strip() or "admin",
        source=(source or "manual").strip() or "manual",
        source_message_id=(source_message_id or "").strip(),
    )
    db.add(attachment)
    await db.flush()
    return attachment, True


async def sync_timesheet_attachments_to_reviews(
    db: AsyncSession,
    timesheet: Timesheet,
    approval: Optional[ScheduleApproval] = None,
) -> int:
    if not timesheet:
        return 0

    approvals = []
    if approval is not None:
        approvals = [approval]
    else:
        result = await db.execute(
            select(ScheduleApproval).where(
                ScheduleApproval.employee_id == timesheet.employee_id,
                ScheduleApproval.week_start == timesheet.period_start,
                ScheduleApproval.week_end == timesheet.period_end,
            )
        )
        approvals = result.scalars().all()

    if not approvals:
        return 0

    attachments_result = await db.execute(
        select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet.id)
    )
    timesheet_attachments = attachments_result.scalars().all()
    if not timesheet_attachments:
        return 0

    created = 0
    for review in approvals:
        existing_result = await db.execute(
            select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.approval_id == review.id)
        )
        existing_attachments = existing_result.scalars().all()
        existing_keys = {
            (
                (item.original_filename or "").strip().lower(),
                int(item.file_size or 0),
                (item.category or "").strip().lower(),
            )
            for item in existing_attachments
        }
        for attachment in timesheet_attachments:
            key = (
                (attachment.original_filename or "").strip().lower(),
                int(attachment.file_size or 0),
                "fdt",
            )
            if key in existing_keys:
                continue
            db.add(
                ScheduleApprovalAttachment(
                    approval_id=review.id,
                    filename=attachment.filename,
                    original_filename=attachment.original_filename,
                    file_type=attachment.file_type,
                    file_size=attachment.file_size,
                    file_data=attachment.file_data,
                    category="fdt",
                    description=attachment.description or "Feuille de temps reçue",
                    uploaded_by=attachment.uploaded_by or "system",
                )
            )
            created += 1
    await db.flush()
    return created


def _match_text_against_employee(employee: Employee, candidates: list[str]) -> int:
    employee_name = _norm(employee.name)
    employee_tokens = set(employee_name.split())
    email_value = _norm(employee.email or "")
    best_score = 0
    for candidate in candidates:
        normalized = _norm(candidate)
        if not normalized:
            continue
        if email_value and normalized == email_value:
            best_score = max(best_score, 100)
        if employee_name and employee_name in normalized:
            best_score = max(best_score, 90)
        overlap = sum(1 for token in employee_tokens if token and token in normalized)
        if overlap:
            best_score = max(best_score, overlap * 20)
    return best_score


async def match_employee_from_email(
    db: AsyncSession,
    sender_header: str,
    subject: str = "",
    body_preview: str = "",
    attachment_names: Optional[list[str]] = None,
) -> tuple[Optional[Employee], str]:
    result = await db.execute(select(Employee))
    employees = result.scalars().all()
    sender_name, sender_email = parseaddr(sender_header or "")
    candidate_texts = [
        sender_header or "",
        sender_name or "",
        sender_email or "",
        subject or "",
        body_preview or "",
    ]
    candidate_texts.extend(attachment_names or [])

    exact_email_matches = [
        employee for employee in employees
        if sender_email and _norm(employee.email or "") == _norm(sender_email)
    ]
    if len(exact_email_matches) == 1:
        return exact_email_matches[0], "email"

    scored = []
    for employee in employees:
        score = _match_text_against_employee(employee, candidate_texts)
        if score > 0:
            scored.append((score, employee))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return None, ""
    if len(scored) == 1 or scored[0][0] > scored[1][0]:
        return scored[0][1], "nom"
    return None, ""


def _line_date(line: dict) -> str:
    return str(line.get("date") or "").strip()[:10]


def _line_hours(line: dict) -> float:
    try:
        return round(float(line.get("hours", 0) or 0), 2)
    except (TypeError, ValueError):
        return 0.0


async def build_timesheet_reconciliation(
    db: AsyncSession,
    employee: Employee,
    period_start: date,
    period_end: date,
    invoice_id: str = "",
    client_id: Optional[int] = None,
) -> dict:
    timesheet = await find_timesheet(db, employee.id, period_start, period_end)
    if not timesheet:
        return {
            "employee_id": employee.id,
            "employee_name": employee.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "confidence_score": 0.15,
            "confidence_level": "faible",
            "analysis_quality": "faible",
            "reasons": ["Aucune feuille de temps trouvée pour cette période."],
            "recommendation": "Indexer ou soumettre la FDT avant de concilier la facture.",
        }

    shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == timesheet.id))
    timesheet_shifts = shifts_result.scalars().all()
    attachments_result = await db.execute(select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet.id))
    timesheet_attachments = attachments_result.scalars().all()

    invoice_query = select(Invoice).where(
        Invoice.employee_id == employee.id,
        Invoice.period_start == period_start,
        Invoice.period_end == period_end,
        Invoice.status != InvoiceStatus.CANCELLED.value,
    )
    if invoice_id:
        invoice_query = invoice_query.where(Invoice.id == invoice_id)
    if client_id:
        invoice_query = invoice_query.where(Invoice.client_id == client_id)
    invoice_result = await db.execute(invoice_query)
    invoices = invoice_result.scalars().all()

    if not invoices:
        return {
            "timesheet_id": timesheet.id,
            "employee_id": employee.id,
            "employee_name": employee.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "attachment_count": len(timesheet_attachments),
            "shift_count": len(timesheet_shifts),
            "timesheet_hours": round(sum(float(item.hours_worked or 0) for item in timesheet_shifts), 2),
            "confidence_score": 0.3 if timesheet_shifts else 0.2,
            "confidence_level": "faible",
            "analysis_quality": "moyen" if timesheet_attachments else "faible",
            "reasons": ["Aucune facture trouvée pour cette période."],
            "recommendation": "Générer la facture puis relancer la conciliation.",
        }

    timesheet_hours = round(sum(float(item.hours_worked or 0) for item in timesheet_shifts), 2)
    shift_by_schedule = {item.schedule_id: item for item in timesheet_shifts if item.schedule_id}

    scored = []
    for invoice in invoices:
        lines = list(getattr(invoice, "lines", None) or [])
        used_shift_ids = set()
        matched_line_count = 0
        matched_by_schedule_id = 0

        for line in lines:
            schedule_id = str(line.get("schedule_id") or "").strip()
            if schedule_id and schedule_id in shift_by_schedule and shift_by_schedule[schedule_id].id not in used_shift_ids:
                used_shift_ids.add(shift_by_schedule[schedule_id].id)
                matched_line_count += 1
                matched_by_schedule_id += 1
                continue

            line_date = _line_date(line)
            line_hours = _line_hours(line)
            for shift in timesheet_shifts:
                if shift.id in used_shift_ids:
                    continue
                if line_date and line_date != shift.date.isoformat():
                    continue
                if abs(round(float(shift.hours_worked or 0), 2) - line_hours) > 0.05:
                    continue
                used_shift_ids.add(shift.id)
                matched_line_count += 1
                break

        invoice_hours = round(sum(_line_hours(line) for line in lines), 2)
        unmatched_timesheet = max(len(timesheet_shifts) - matched_line_count, 0)
        unmatched_invoice = max(len(lines) - matched_line_count, 0)
        hours_gap = round(invoice_hours - timesheet_hours, 2)
        missing_schedule_links = sum(1 for line in lines if not line.get("schedule_id"))

        score = 1.0
        if len(invoices) > 1:
            score -= min(0.2, 0.08 * (len(invoices) - 1))
        if len(timesheet_attachments) == 0:
            score -= 0.1
        if abs(hours_gap) > 0.01:
            score -= min(0.45, abs(hours_gap) / max(timesheet_hours or 1, 1) * 0.9)
        if len(timesheet_shifts):
            score -= min(0.2, unmatched_timesheet / len(timesheet_shifts) * 0.2)
        if len(lines):
            score -= min(0.2, unmatched_invoice / len(lines) * 0.2)
        if missing_schedule_links:
            score -= min(0.1, missing_schedule_links / max(len(lines), 1) * 0.1)
        if matched_by_schedule_id == 0 and matched_line_count > 0:
            score -= 0.08
        score = round(max(0.05, min(score, 0.99)), 2)

        scored.append(
            {
                "invoice": invoice,
                "score": score,
                "invoice_hours": invoice_hours,
                "hours_gap": hours_gap,
                "matched_line_count": matched_line_count,
                "matched_by_schedule_id": matched_by_schedule_id,
                "unmatched_timesheet": unmatched_timesheet,
                "unmatched_invoice": unmatched_invoice,
                "missing_schedule_links": missing_schedule_links,
            }
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    best = scored[0]
    best_invoice = best["invoice"]
    confidence_score = float(best["score"])
    confidence_level = "élevé" if confidence_score >= 0.85 else "moyen" if confidence_score >= 0.6 else "faible"

    analysis_quality = "élevé"
    if not timesheet_attachments or best["missing_schedule_links"] > 0:
        analysis_quality = "moyen"
    if not timesheet_shifts or not invoices:
        analysis_quality = "faible"

    reasons = []
    if len(timesheet_attachments) > 0:
        reasons.append(f"{len(timesheet_attachments)} document(s) FDT rattaché(s) à la période.")
    else:
        reasons.append("Aucun document FDT n'est rattaché à cette période.")
    if len(invoices) > 1:
        reasons.append(f"{len(invoices)} factures existent pour cette période; la meilleure correspondance a été retenue.")
    if abs(best["hours_gap"]) <= 0.05:
        reasons.append("Les heures FDT et facture concordent.")
    else:
        reasons.append(f"Écart de {best['hours_gap']:+.2f} h entre la FDT et la facture.")
    if best["unmatched_timesheet"] > 0:
        reasons.append(f"{best['unmatched_timesheet']} quart(s) de la FDT n'ont pas trouvé de ligne facture.")
    if best["unmatched_invoice"] > 0:
        reasons.append(f"{best['unmatched_invoice']} ligne(s) facture ne correspondent pas clairement à la FDT.")
    if best["missing_schedule_links"] > 0:
        reasons.append(f"{best['missing_schedule_links']} ligne(s) facture n'ont pas de schedule_id, donc l'analyse est moins précise.")

    recommendation = "Conciliation prête."
    if confidence_level == "moyen":
        recommendation = "Vérifier les écarts signalés avant l'envoi final."
    if confidence_level == "faible":
        recommendation = "Valider manuellement la FDT, les quarts et la facture avant de poursuivre."

    client_name = ""
    if getattr(best_invoice, "client_id", None):
        client_result = await db.execute(select(Client).where(Client.id == best_invoice.client_id))
        client = client_result.scalar_one_or_none()
        client_name = client.name if client else (best_invoice.client_name or "")

    return {
        "timesheet_id": timesheet.id,
        "invoice_id": best_invoice.id,
        "invoice_number": best_invoice.number,
        "employee_id": employee.id,
        "employee_name": employee.name,
        "client_id": best_invoice.client_id,
        "client_name": client_name or (best_invoice.client_name or ""),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "timesheet_status": timesheet.status,
        "attachment_count": len(timesheet_attachments),
        "shift_count": len(timesheet_shifts),
        "invoice_line_count": len(getattr(best_invoice, "lines", None) or []),
        "timesheet_hours": timesheet_hours,
        "invoice_hours": best["invoice_hours"],
        "hours_gap": best["hours_gap"],
        "matched_line_count": best["matched_line_count"],
        "matched_by_schedule_id": best["matched_by_schedule_id"],
        "unmatched_timesheet_shifts": best["unmatched_timesheet"],
        "unmatched_invoice_lines": best["unmatched_invoice"],
        "confidence_score": confidence_score,
        "confidence_level": confidence_level,
        "analysis_quality": analysis_quality,
        "reasons": reasons,
        "recommendation": recommendation,
    }


async def build_timesheet_documents_summary(
    db: AsyncSession,
    group_by: str = "week",
    employee_id: Optional[int] = None,
) -> list[dict]:
    query = select(Timesheet).order_by(Timesheet.period_start.desc(), Timesheet.created_at.desc())
    if employee_id:
        query = query.where(Timesheet.employee_id == employee_id)
    result = await db.execute(query)
    timesheets = result.scalars().all()
    timesheet_ids = [timesheet.id for timesheet in timesheets]
    attachment_counts = await get_attachment_count_map(db, TimesheetAttachment, TimesheetAttachment.timesheet_id, timesheet_ids)

    grouped = {}
    for timesheet in timesheets:
        if group_by == "month":
            key = timesheet.period_start.strftime("%Y-%m")
            label = key
        else:
            key = timesheet.period_start.isoformat()
            label = f"Semaine du {timesheet.period_start.isoformat()}"
        bucket = grouped.setdefault(
            key,
            {"group_key": key, "label": label, "timesheet_count": 0, "document_count": 0, "hours": 0.0},
        )
        bucket["timesheet_count"] += 1
        bucket["document_count"] += attachment_counts.get(timesheet.id, 0)
        shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == timesheet.id))
        bucket["hours"] += sum(float(shift.hours_worked or 0) for shift in shifts_result.scalars().all())

    values = list(grouped.values())
    values.sort(key=lambda item: item["group_key"], reverse=True)
    for item in values:
        item["hours"] = round(item["hours"], 2)
    return values


async def build_accommodation_documents_summary(
    db: AsyncSession,
    group_by: str = "week",
    employee_id: Optional[int] = None,
) -> list[dict]:
    query = select(Accommodation).order_by(Accommodation.start_date.desc())
    if employee_id:
        query = query.where(Accommodation.employee_id == employee_id)
    result = await db.execute(query)
    accommodations = result.scalars().all()
    accommodation_ids = [item.id for item in accommodations]
    attachment_counts = await get_attachment_count_map(
        db,
        AccommodationAttachment,
        AccommodationAttachment.accommodation_id,
        accommodation_ids,
    )

    grouped = {}
    for accommodation in accommodations:
        if group_by == "month":
            key = accommodation.start_date.strftime("%Y-%m")
            label = key
        else:
            week_start = accommodation.start_date - timedelta(days=(accommodation.start_date.weekday() + 1) % 7)
            key = week_start.isoformat()
            label = f"Semaine du {week_start.isoformat()}"
        bucket = grouped.setdefault(
            key,
            {"group_key": key, "label": label, "document_count": 0, "accommodation_count": 0, "total_cost": 0.0},
        )
        bucket["document_count"] += attachment_counts.get(accommodation.id, 0)
        bucket["accommodation_count"] += 1
        bucket["total_cost"] += float(accommodation.total_cost or 0)

    values = list(grouped.values())
    values.sort(key=lambda item: item["group_key"], reverse=True)
    for item in values:
        item["total_cost"] = round(item["total_cost"], 2)
    return values
