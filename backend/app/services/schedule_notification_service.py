from __future__ import annotations

import os
from datetime import datetime, timedelta
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models import Employee, Schedule, ScheduleChangeNotification
from .email_service import FRONTEND_URL, send_schedule_change_notification_email

SCHEDULE_CHANGE_DEBOUNCE_MINUTES = int(
    os.getenv("SCHEDULE_CHANGE_DEBOUNCE_MINUTES", "2") or 2
)
SCHEDULE_CHANGE_LOOKAHEAD_DAYS = int(
    os.getenv("SCHEDULE_CHANGE_LOOKAHEAD_DAYS", "14") or 14
)


def _schedule_snapshot(schedule: Schedule | None) -> dict | None:
    if not schedule:
        return None
    return {
        "id": schedule.id,
        "date": schedule.date.isoformat() if getattr(schedule, "date", None) else "",
        "start": str(schedule.start or ""),
        "end": str(schedule.end or ""),
        "hours": float(schedule.hours or 0),
        "location": str(schedule.location or ""),
        "status": str(schedule.status or ""),
    }


def _change_summary(action: str, before: dict | None, after: dict | None) -> dict:
    target = after or before or {}
    time_range = ""
    if target.get("start") and target.get("end"):
        time_range = f"{target.get('start')}-{target.get('end')}"
    location_suffix = f" a {target.get('location')}" if target.get("location") else ""

    if action == "created":
        summary = f"Nouveau quart ajoute{location_suffix}."
    elif action == "deleted":
        summary = "Quart supprime."
    elif action == "cancelled":
        summary = "Quart annule."
    else:
        summary = "Quart modifie."

    if action == "updated" and before and after:
        before_range = (
            f"{before.get('start')}-{before.get('end')}"
            if before.get("start") and before.get("end")
            else ""
        )
        after_range = (
            f"{after.get('start')}-{after.get('end')}"
            if after.get("start") and after.get("end")
            else ""
        )
        if before_range and after_range and before_range != after_range:
            summary = f"Quart modifie: {before_range} devient {after_range}."
        elif before.get("status") != after.get("status") and after.get("status") == "cancelled":
            summary = "Quart annule."

    return {
        "action": action,
        "schedule_id": target.get("id"),
        "date": target.get("date", ""),
        "time_range": time_range,
        "summary": summary,
        "before": before,
        "after": after,
        "recorded_at": datetime.utcnow().isoformat(),
    }


def clone_schedule_like(schedule: Schedule | None):
    if not schedule:
        return None
    return SimpleNamespace(
        id=getattr(schedule, "id", None),
        date=getattr(schedule, "date", None),
        start=getattr(schedule, "start", ""),
        end=getattr(schedule, "end", ""),
        hours=getattr(schedule, "hours", 0),
        location=getattr(schedule, "location", ""),
        status=getattr(schedule, "status", ""),
    )


async def enqueue_schedule_change_notification(
    db: AsyncSession,
    employee_id: int | None,
    action: str,
    before: Schedule | None = None,
    after: Schedule | None = None,
) -> ScheduleChangeNotification | None:
    if not employee_id:
        return None

    employee_result = await db.execute(select(Employee).where(Employee.id == employee_id))
    employee = employee_result.scalar_one_or_none()
    if not employee or not getattr(employee, "email", ""):
        return None

    now = datetime.utcnow()
    send_after = now + timedelta(minutes=SCHEDULE_CHANGE_DEBOUNCE_MINUTES)
    entry = _change_summary(action, _schedule_snapshot(before), _schedule_snapshot(after))

    result = await db.execute(
        select(ScheduleChangeNotification)
        .where(
            ScheduleChangeNotification.employee_id == employee_id,
            ScheduleChangeNotification.status == "pending",
        )
        .order_by(ScheduleChangeNotification.created_at.desc())
    )
    notification = result.scalars().first()
    if notification:
        changes = list(notification.pending_changes or [])
        changes.append(entry)
        notification.pending_changes = changes[-100:]
        notification.send_after = send_after
        notification.updated_at = now
        notification.last_error = ""
        await db.flush()
        return notification

    notification = ScheduleChangeNotification(
        employee_id=employee_id,
        status="pending",
        pending_changes=[entry],
        send_after=send_after,
        created_at=now,
        updated_at=now,
    )
    db.add(notification)
    await db.flush()
    return notification


async def process_pending_schedule_change_notifications(db: AsyncSession) -> list[dict]:
    now = datetime.utcnow()
    result = await db.execute(
        select(ScheduleChangeNotification)
        .where(
            ScheduleChangeNotification.status == "pending",
            ScheduleChangeNotification.send_after <= now,
        )
        .order_by(ScheduleChangeNotification.send_after.asc())
    )
    notifications = result.scalars().all()
    sent_items: list[dict] = []

    for notification in notifications:
        employee_result = await db.execute(
            select(Employee).where(Employee.id == notification.employee_id)
        )
        employee = employee_result.scalar_one_or_none()
        if not employee or not getattr(employee, "email", ""):
            notification.status = "skipped"
            notification.last_error = "Employe ou courriel introuvable"
            notification.updated_at = now
            continue

        lookahead_end = now.date() + timedelta(days=SCHEDULE_CHANGE_LOOKAHEAD_DAYS)
        schedules_result = await db.execute(
            select(Schedule)
            .where(
                Schedule.employee_id == employee.id,
                Schedule.date >= now.date(),
                Schedule.date <= lookahead_end,
                Schedule.status != "cancelled",
            )
            .order_by(Schedule.date.asc(), Schedule.start.asc())
        )
        upcoming = schedules_result.scalars().all()
        upcoming_summary = [
            {
                "date": shift.date.isoformat(),
                "time_range": f"{shift.start}-{shift.end}",
                "summary": shift.location or "Quart publie",
            }
            for shift in upcoming[:8]
        ]
        changes = list(notification.pending_changes or [])
        merged_changes = (changes + upcoming_summary)[:12]
        try:
            await send_schedule_change_notification_email(
                email=employee.email,
                name=employee.name,
                changes=merged_changes,
                portal_url=FRONTEND_URL,
                db=db,
            )
            notification.status = "sent"
            notification.sent_at = now
            notification.updated_at = now
            notification.last_error = ""
            sent_items.append(
                {
                    "employee_id": employee.id,
                    "employee_name": employee.name,
                    "change_count": len(changes),
                    "email": employee.email,
                }
            )
        except Exception as exc:
            notification.last_error = str(exc)
            notification.updated_at = now
            notification.send_after = now + timedelta(
                minutes=SCHEDULE_CHANGE_DEBOUNCE_MINUTES
            )
    return sent_items
