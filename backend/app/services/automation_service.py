from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from datetime import datetime
from email.utils import getaddresses
from zoneinfo import ZoneInfo

from sqlalchemy import select

from ..database import async_session
from ..models.models import AutomationRun
from .billing_gmail_oauth import BILLING_SENDER_EMAIL, send_via_connected_billing_gmail
from .email_service import _send_email
from .timesheet_service import completed_billing_period, format_french_period

AUTOMATION_TIMEZONE = ZoneInfo(os.getenv("AUTOMATION_TIMEZONE", "America/Toronto"))
TIMESHEET_REMINDER_ENABLED = str(os.getenv("TIMESHEET_REMINDER_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
TIMESHEET_REMINDER_HOUR = int(os.getenv("TIMESHEET_REMINDER_HOUR", "9") or 9)
TIMESHEET_REMINDER_MINUTE = int(os.getenv("TIMESHEET_REMINDER_MINUTE", "0") or 0)
TIMESHEET_REMINDER_TO = (os.getenv("TIMESHEET_REMINDER_TO") or BILLING_SENDER_EMAIL).strip()
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
