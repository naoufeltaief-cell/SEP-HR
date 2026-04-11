from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from datetime import date, datetime
from email.utils import getaddresses
from zoneinfo import ZoneInfo

from sqlalchemy import select

from ..database import async_session
from ..models.models import AutomationRun
from ..models.models_invoice import Invoice, InvoiceStatus
from .billing_gmail_oauth import (
    BILLING_SENDER_EMAIL,
    create_billing_gmail_draft,
    list_recent_billing_gmail_documents,
    send_via_connected_billing_gmail,
)
from .email_service import _send_email
from .invoice_service import generate_invoices_from_timesheets
from .timesheet_service import (
    build_weekly_validation_queue,
    completed_billing_period,
    find_timesheet,
    format_french_period,
    index_recent_timesheet_email_documents,
    sync_timesheet_attachments_to_invoice,
)

AUTOMATION_TIMEZONE = ZoneInfo(os.getenv("AUTOMATION_TIMEZONE", "America/Toronto"))
TIMESHEET_REMINDER_ENABLED = str(os.getenv("TIMESHEET_REMINDER_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
TIMESHEET_REMINDER_HOUR = int(os.getenv("TIMESHEET_REMINDER_HOUR", "9") or 9)
TIMESHEET_REMINDER_MINUTE = int(os.getenv("TIMESHEET_REMINDER_MINUTE", "0") or 0)
TIMESHEET_REMINDER_TO = (os.getenv("TIMESHEET_REMINDER_TO") or BILLING_SENDER_EMAIL).strip()
TIMESHEET_INBOX_MONITOR_ENABLED = str(os.getenv("TIMESHEET_INBOX_MONITOR_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
TIMESHEET_INBOX_MAX_RESULTS = int(os.getenv("TIMESHEET_INBOX_MAX_RESULTS", "30") or 30)
TIMESHEET_INBOX_SEARCH = (os.getenv("TIMESHEET_INBOX_SEARCH") or "newer_than:14d").strip()
TIMESHEET_AUTO_DRAFT_ENABLED = str(os.getenv("TIMESHEET_AUTO_DRAFT_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
TIMESHEET_AUTO_DRAFT_MIN_CONFIDENCE = float(os.getenv("TIMESHEET_AUTO_DRAFT_MIN_CONFIDENCE", "0.68") or 0.68)
DEFAULT_REMINDER_RECIPIENTS = [
    "ines_achour@hotmail.ca",
    "vaniecote1960@hotmail.fr",
    "sindygaetan@gmail.com",
    "olivierkabongo547@gmail.com",
    "sunly016@hotmail.com",
    "alhachsoul@gmail.com",
    "romain.gavet11@gmail.com",
    "jo_anne821@hotmail.com",
    "melanie.choquette868@gmail.com",
    "lovely.estinvil@hotmail.com",
    "mukala.chance@hotmail.com",
    "hemerciennedagaud23@gmail.com",
    "cozzi.tan007@gmail.com",
    "gemimalacombe11@yahoo.com",
    "line.gosselin@icloud.com",
    "mirlandemmoise@gmail.com",
    "stpedro@hotmail.ca",
    "williamhamel@hotmail.fr",
    "malika0106@hotmail.com",
    "marjorietremblay@live.ca",
]
AUTO_DRAFT_BLOCKER_FLAGS = {"client_a_confirmer", "fdt_manquante", "fdt_sans_piece_jointe", "ecart_horaire_fdt"}


def _parse_bcc_recipients() -> list[str]:
    raw = os.getenv("TIMESHEET_REMINDER_BCC", "").strip()
    if not raw:
        return DEFAULT_REMINDER_RECIPIENTS
    recipients = []
    for _, email in getaddresses([raw]):
        normalized = (email or "").strip()
        if normalized and normalized not in recipients:
            recipients.append(normalized)
    return recipients or DEFAULT_REMINDER_RECIPIENTS


async def _maybe_auto_draft_invoices(db, indexing_result: dict) -> list[dict]:
    if not TIMESHEET_AUTO_DRAFT_ENABLED:
        return []

    drafted = []
    seen_periods = set()
    source_items = indexing_result.get("timesheet_items") or indexing_result.get("items") or []
    for item in source_items:
        if str(item.get("document_type") or "fdt").strip().lower() != "fdt":
            continue
        employee_id = item.get("employee_id")
        period_start = item.get("period_start")
        period_end = item.get("period_end")
        if not employee_id or not period_start or not period_end:
            continue
        key = (employee_id, period_start, period_end)
        if key in seen_periods:
            continue
        seen_periods.add(key)

        queue = await build_weekly_validation_queue(db, date.fromisoformat(period_start), date.fromisoformat(period_end))
        period_items = [
            row for row in (queue.get("items") or [])
            if row.get("employee_id") == employee_id
            and row.get("week_start") == period_start
            and row.get("week_end") == period_end
        ]
        timesheet = await find_timesheet(db, employee_id, date.fromisoformat(period_start), date.fromisoformat(period_end))
        if not timesheet:
            continue

        for dossier in period_items:
            blockers = [flag for flag in (dossier.get("flags") or []) if flag in AUTO_DRAFT_BLOCKER_FLAGS]
            if blockers:
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": dossier.get("client_id"),
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "skipped",
                    "reason": f"bloqueurs: {', '.join(blockers)}",
                })
                continue
            if not dossier.get("client_id"):
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": None,
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "skipped",
                    "reason": "client non resolu",
                })
                continue
            if dossier.get("invoice_id"):
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": dossier.get("client_id"),
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "existing",
                    "invoice_id": dossier.get("invoice_id"),
                    "invoice_number": dossier.get("invoice_number", ""),
                })
                continue
            if float(dossier.get("confidence_score") or 0) < TIMESHEET_AUTO_DRAFT_MIN_CONFIDENCE:
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": dossier.get("client_id"),
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "skipped",
                    "reason": f"confiance insuffisante ({int(round(float(dossier.get('confidence_score') or 0) * 100))}%)",
                })
                continue

            existing_result = await db.execute(
                select(Invoice).where(
                    Invoice.employee_id == employee_id,
                    Invoice.client_id == dossier.get("client_id"),
                    Invoice.period_start == date.fromisoformat(period_start),
                    Invoice.period_end == date.fromisoformat(period_end),
                    Invoice.status != InvoiceStatus.CANCELLED.value,
                )
            )
            existing_invoice = existing_result.scalar_one_or_none()
            if existing_invoice:
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": dossier.get("client_id"),
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "existing",
                    "invoice_id": existing_invoice.id,
                    "invoice_number": existing_invoice.number,
                })
                continue

            generated = await generate_invoices_from_timesheets(
                db,
                period_start=date.fromisoformat(period_start),
                period_end=date.fromisoformat(period_end),
                client_id=dossier.get("client_id"),
                employee_id=employee_id,
                user_email="automation@soins-expert-plus.com",
            )
            invoice = next(
                (
                    candidate for candidate in generated
                    if candidate.employee_id == employee_id and candidate.client_id == dossier.get("client_id")
                ),
                None,
            )
            if not invoice:
                drafted.append({
                    "employee_id": employee_id,
                    "employee_name": dossier.get("employee_name", ""),
                    "client_id": dossier.get("client_id"),
                    "client_name": dossier.get("client_name", ""),
                    "period_start": period_start,
                    "period_end": period_end,
                    "status": "skipped",
                    "reason": "aucun brouillon cree",
                })
                continue

            attached_count = await sync_timesheet_attachments_to_invoice(db, timesheet, invoice)
            await db.commit()
            drafted.append({
                "employee_id": employee_id,
                "employee_name": dossier.get("employee_name", ""),
                "client_id": dossier.get("client_id"),
                "client_name": dossier.get("client_name", ""),
                "period_start": period_start,
                "period_end": period_end,
                "status": "created",
                "invoice_id": invoice.id,
                "invoice_number": invoice.number,
                "invoice_total": round(float(invoice.total or 0), 2),
                "timesheet_attachments_synced": attached_count,
                "confidence_score": dossier.get("confidence_score"),
            })

    return drafted


async def process_incoming_timesheet_emails(
    triggered_by: str = "system",
    max_results: int | None = None,
    unread_only: bool = False,
) -> dict:
    if not TIMESHEET_INBOX_MONITOR_ENABLED and triggered_by == "scheduler":
        return {"status": "disabled", "indexed_count": 0, "drafted_count": 0}

    async with async_session() as db:
        documents = await list_recent_billing_gmail_documents(
            db,
            max_results=max_results or TIMESHEET_INBOX_MAX_RESULTS,
            search=TIMESHEET_INBOX_SEARCH,
            unread_only=unread_only,
        )
        if documents is None:
            return {"status": "not_connected", "indexed_count": 0, "drafted_count": 0}

        indexing_result = await index_recent_timesheet_email_documents(db, documents, uploaded_by=triggered_by or "system")
        await db.commit()
        drafted = await _maybe_auto_draft_invoices(db, indexing_result)

        if indexing_result.get("created_attachments") or indexing_result.get("created_timesheets") or any(item.get("status") == "created" for item in drafted):
            db.add(
                AutomationRun(
                    job_key="incoming_timesheet_emails",
                    period_key=datetime.now(AUTOMATION_TIMEZONE).strftime("%Y%m%d%H%M"),
                    status="processed",
                    details=(
                        f"indexed={indexing_result.get('indexed_count', 0)} "
                        f"fdt={indexing_result.get('created_timesheets', 0)} "
                        f"hebergement={indexing_result.get('created_accommodations', 0)} "
                        f"drafted={len(drafted)} ignored={len(indexing_result.get('ignored', []))} "
                        f"unmatched={len(indexing_result.get('unmatched', []))}"
                    ),
                    triggered_by=triggered_by or "system",
                )
            )
            await db.commit()

        return {
            "status": "processed",
            "indexed_count": indexing_result.get("indexed_count", 0),
            "created_timesheets": indexing_result.get("created_timesheets", 0),
            "created_attachments": indexing_result.get("created_attachments", 0),
            "created_accommodations": indexing_result.get("created_accommodations", 0),
            "created_accommodation_attachments": indexing_result.get("created_accommodation_attachments", 0),
            "mirrored_review_attachments": indexing_result.get("mirrored_review_attachments", 0),
            "ignored_count": len(indexing_result.get("ignored", [])),
            "unmatched_count": len(indexing_result.get("unmatched", [])),
            "drafted_count": len([item for item in drafted if item.get("status") == "created"]),
            "items": indexing_result.get("items", []),
            "timesheet_items": indexing_result.get("timesheet_items", []),
            "accommodation_items": indexing_result.get("accommodation_items", []),
            "ignored": indexing_result.get("ignored", []),
            "unmatched": indexing_result.get("unmatched", []),
            "drafted": drafted,
        }


def _reminder_subject(period_start, period_end) -> str:
    return f"Feuille de temps - période {format_french_period(period_start, period_end)}"


def _reminder_html(period_start, period_end) -> str:
    formatted_period = format_french_period(period_start, period_end)
    return f"""
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#20343c;max-width:680px;margin:0 auto;padding:24px">
      <p>Bonjour,</p>
      <p>J'espère que vous allez bien.</p>
      <p>Nous aurons besoin de votre <strong>Feuille de temps</strong> pour la période <strong>{formatted_period}</strong>.</p>
      <p>Pour les PAB, bien vouloir envoyer votre feuille de route pour la période mentionnée.</p>
      <p><strong>Veuillez ignorer ce courriel si vous avez déjà envoyé votre FDT.</strong></p>
      <p>J'attends votre retour.</p>
      <p>Merci et bonne journée</p>
      <p style="margin-top:24px;color:#60717a;font-size:12px">Soins Expert Plus<br/>{BILLING_SENDER_EMAIL}</p>
    </div>
    """


def _reminder_text(period_start, period_end) -> str:
    formatted_period = format_french_period(period_start, period_end)
    return (
        "Bonjour,\n\n"
        "J'espère que vous allez bien.\n\n"
        f"Nous aurons besoin de votre Feuille de temps pour la période {formatted_period}.\n\n"
        "Pour les PAB, bien vouloir envoyer votre feuille de route pour la période mentionnée.\n\n"
        "Veuillez ignorer ce courriel si vous avez déjà envoyé votre FDT.\n\n"
        "J'attends votre retour.\n\n"
        "Merci et bonne journée"
    )


def _reminder_subject(period_start, period_end) -> str:
    return f"Votre Feuille de temps pour la periode du {format_french_period(period_start, period_end)}"


def _reminder_html(period_start, period_end) -> str:
    formatted_period = format_french_period(period_start, period_end)
    return f"""
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.72;color:#204d97;max-width:720px;margin:0 auto;padding:20px 28px;background:#ffffff">
      <p style="margin:0 0 34px 0;font-size:16px;color:#204d97">Bonjour,</p>
      <p style="margin:0 0 38px 0;font-size:16px;color:#204d97">J'espere que vous allez bien.</p>
      <p style="margin:0 0 18px 0;font-size:16px;color:#204d97">
        Nous aurons besoin de votre Feuille de temps pour <strong>la periode du {formatted_period}</strong>.
      </p>
      <p style="margin:0 0 38px 0;font-size:16px;color:#204d97">
        Pour les <strong>PAB</strong>, bien vouloir envoyer votre <strong>feuille de route</strong> pour la periode mentionnee.
      </p>
      <p style="margin:0 0 38px 0;font-size:17px;color:#204d97;font-weight:700">
        <span style="background:#fff35c;padding:2px 4px">**Veuillez ignorer ce courriel si vous avez deja envoye votre FDT.**</span>
      </p>
      <p style="margin:0 0 38px 0;font-size:16px;color:#204d97">J'attends votre retour.</p>
      <p style="margin:0 0 52px 0;font-size:16px;color:#204d97">Merci et bonne journee</p>
      <p style="margin:0 0 24px 0;color:#6b7280;font-size:16px">--</p>
      <div style="border-top:1px solid #d7e3f6;padding-top:16px">
        <p style="margin:0;font-size:18px;font-weight:700;color:#2b4ea0">Service Financiers</p>
        <p style="margin:6px 0 0 0;font-size:15px;color:#2b4ea0">Soins Expert Plus</p>
        <p style="margin:6px 0 0 0;font-size:15px;color:#2b4ea0">{BILLING_SENDER_EMAIL}</p>
      </div>
    </div>
    """


def _reminder_text(period_start, period_end) -> str:
    formatted_period = format_french_period(period_start, period_end)
    return (
        "Bonjour,\n\n"
        "J'espere que vous allez bien.\n\n"
        f"Nous aurons besoin de votre Feuille de temps pour la periode du {formatted_period}.\n\n"
        "Pour les PAB, bien vouloir envoyer votre feuille de route pour la periode mentionnee.\n\n"
        "**Veuillez ignorer ce courriel si vous avez deja envoye votre FDT.**\n\n"
        "J'attends votre retour.\n\n"
        "Merci et bonne journee\n\n"
        "--\n\n"
        "Service Financiers\n"
        "Soins Expert Plus\n"
        f"{BILLING_SENDER_EMAIL}"
    )


def _build_weekly_timesheet_reminder_payload(reference_date: date | None = None) -> dict:
    anchor = reference_date or datetime.now(AUTOMATION_TIMEZONE).date()
    period_start, period_end = completed_billing_period(anchor)
    recipients = _parse_bcc_recipients()
    return {
        "period_start": period_start,
        "period_end": period_end,
        "period_label": format_french_period(period_start, period_end),
        "subject": _reminder_subject(period_start, period_end),
        "body_html": _reminder_html(period_start, period_end),
        "body_text": _reminder_text(period_start, period_end),
        "to_email": TIMESHEET_REMINDER_TO,
        "bcc_recipients": recipients,
        "recipient_count": len(recipients),
    }


def get_automation_config() -> dict:
    return {
        "timezone": str(AUTOMATION_TIMEZONE),
        "timesheet_reminder": {
            "enabled": TIMESHEET_REMINDER_ENABLED,
            "day_of_week": "Sunday",
            "day_of_week_fr": "dimanche",
            "time": f"{TIMESHEET_REMINDER_HOUR:02d}:{TIMESHEET_REMINDER_MINUTE:02d}",
            "to_email": TIMESHEET_REMINDER_TO,
            "bcc_recipients": _parse_bcc_recipients(),
        },
        "timesheet_inbox_monitor": {
            "enabled": TIMESHEET_INBOX_MONITOR_ENABLED,
            "max_results": TIMESHEET_INBOX_MAX_RESULTS,
            "search": TIMESHEET_INBOX_SEARCH,
        },
        "timesheet_auto_draft": {
            "enabled": TIMESHEET_AUTO_DRAFT_ENABLED,
            "min_confidence": TIMESHEET_AUTO_DRAFT_MIN_CONFIDENCE,
        },
    }


async def draft_weekly_timesheet_reminder(triggered_by: str = "system") -> dict:
    payload = _build_weekly_timesheet_reminder_payload()
    async with async_session() as db:
        draft = await create_billing_gmail_draft(
            db,
            to_email=payload["to_email"],
            subject=payload["subject"],
            body_text=payload["body_text"],
            body_html=payload["body_html"],
            bcc_emails=payload["bcc_recipients"],
        )
        if not draft:
            return {
                "status": "not_connected",
                "message": "Le compte Gmail de facturation n'est pas connecte",
                "period_start": payload["period_start"].isoformat(),
                "period_end": payload["period_end"].isoformat(),
                "period_label": payload["period_label"],
                "recipient_count": payload["recipient_count"],
            }

        db.add(
            AutomationRun(
                job_key="weekly_timesheet_reminder_draft",
                period_key=f"{payload['period_start'].isoformat()}_{payload['period_end'].isoformat()}_{datetime.now(AUTOMATION_TIMEZONE).strftime('%H%M%S')}",
                status="drafted",
                details=f"{payload['subject']} | {payload['recipient_count']} destinataires CCI",
                triggered_by=triggered_by or "system",
            )
        )
        await db.commit()

    return {
        "status": "drafted",
        "job_key": "weekly_timesheet_reminder_draft",
        "period_start": payload["period_start"].isoformat(),
        "period_end": payload["period_end"].isoformat(),
        "period_label": payload["period_label"],
        "recipient_count": payload["recipient_count"],
        "to_email": payload["to_email"],
        "bcc_recipients": payload["bcc_recipients"],
        "draft": draft,
    }


async def send_weekly_timesheet_reminder(triggered_by: str = "system", force: bool = False) -> dict:
    now = datetime.now(AUTOMATION_TIMEZONE)
    period_start, period_end = completed_billing_period(now.date())
    period_key = f"{period_start.isoformat()}_{period_end.isoformat()}"
    recipients = _parse_bcc_recipients()

    async with async_session() as db:
        if not force:
            existing_result = await db.execute(
                select(AutomationRun).where(
                    AutomationRun.job_key == "weekly_timesheet_reminder",
                    AutomationRun.period_key == period_key,
                    AutomationRun.status == "sent",
                )
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                return {
                    "status": "already_sent",
                    "job_key": "weekly_timesheet_reminder",
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                    "period_label": format_french_period(period_start, period_end),
                    "recipient_count": len(recipients),
                }

        subject = _reminder_subject(period_start, period_end)
        html = _reminder_html(period_start, period_end)
        text = _reminder_text(period_start, period_end)

        delivery = None
        try:
            delivery = await send_via_connected_billing_gmail(
                db,
                to_email=TIMESHEET_REMINDER_TO,
                subject=subject,
                body_text=text,
                body_html=html,
                bcc_emails=recipients,
            )
        except Exception:
            delivery = None

        if not delivery:
            await _send_email(
                TIMESHEET_REMINDER_TO,
                subject,
                html,
                bcc_emails=recipients,
            )
            delivery = {"transport": "smtp", "from_email": BILLING_SENDER_EMAIL}

        db.add(
            AutomationRun(
                job_key="weekly_timesheet_reminder",
                period_key=period_key,
                status="sent",
                details=f"{subject} | {len(recipients)} destinataires CCI | transport={delivery.get('transport', 'unknown')}",
                triggered_by=triggered_by or "system",
            )
        )
        await db.commit()

    return {
        "status": "sent",
        "job_key": "weekly_timesheet_reminder",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "period_label": format_french_period(period_start, period_end),
        "recipient_count": len(recipients),
        "transport": delivery.get("transport", "unknown"),
    }


async def run_pending_automations() -> None:
    if TIMESHEET_INBOX_MONITOR_ENABLED:
        await process_incoming_timesheet_emails(triggered_by="scheduler", unread_only=False)
    if not TIMESHEET_REMINDER_ENABLED:
        return
    now = datetime.now(AUTOMATION_TIMEZONE)
    if now.weekday() != 6:
        return
    if (now.hour, now.minute) < (TIMESHEET_REMINDER_HOUR, TIMESHEET_REMINDER_MINUTE):
        return
    await send_weekly_timesheet_reminder(triggered_by="scheduler", force=False)


async def automation_loop() -> None:
    while True:
        try:
            await run_pending_automations()
        except Exception as exc:
            print(f"[AUTOMATION ERROR] {exc}")
        await asyncio.sleep(600)


async def cancel_automation_task(task) -> None:
    if not task:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
