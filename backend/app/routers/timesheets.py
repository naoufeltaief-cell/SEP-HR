"""Timesheet routes — submit, approve, reject, attachments."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.models import Timesheet, TimesheetAttachment, TimesheetShift
from ..models.schemas import TimesheetCreate
from ..services.auth_service import get_current_user, require_admin
from ..services.timesheet_service import (
    add_timesheet_attachment,
    get_attachment_count_map,
    serialize_timesheet_attachment,
    sync_timesheet_attachments_to_reviews,
    upsert_submitted_timesheet,
)

router = APIRouter()

ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _ensure_timesheet_access(user, timesheet: Timesheet):
    if getattr(user, "role", "") == "admin":
        return
    if getattr(user, "employee_id", None) and getattr(user, "employee_id", None) == timesheet.employee_id:
        return
    raise HTTPException(status_code=403, detail="Accès refusé à cette FDT")


async def _serialize_timesheet(db: AsyncSession, ts: Timesheet) -> dict:
    shifts_result = await db.execute(
        select(TimesheetShift).where(TimesheetShift.timesheet_id == ts.id).order_by(TimesheetShift.date)
    )
    shifts = [
        {
            "id": shift.id,
            "schedule_id": shift.schedule_id,
            "date": shift.date.isoformat(),
            "hours_worked": shift.hours_worked,
            "pause": shift.pause,
            "garde_hours": shift.garde_hours,
            "rappel_hours": shift.rappel_hours,
            "start_actual": shift.start_actual,
            "end_actual": shift.end_actual,
        }
        for shift in shifts_result.scalars().all()
    ]
    attachment_counts = await get_attachment_count_map(
        db,
        TimesheetAttachment,
        TimesheetAttachment.timesheet_id,
        [ts.id],
    )
    return {
        "id": ts.id,
        "employee_id": ts.employee_id,
        "period_start": ts.period_start.isoformat(),
        "period_end": ts.period_end.isoformat(),
        "status": ts.status,
        "notes": ts.notes,
        "shifts": shifts,
        "attachment_count": attachment_counts.get(ts.id, 0),
        "created_at": ts.created_at.isoformat() if ts.created_at else None,
    }


@router.get("")
@router.get("/")
async def list_timesheets(
    employee_id: int | None = Query(default=None),
    period_start: str | None = Query(default=None),
    period_end: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    query = select(Timesheet).order_by(Timesheet.period_start.desc(), Timesheet.created_at.desc())
    if getattr(user, "role", "") == "employee" and getattr(user, "employee_id", None):
        query = query.where(Timesheet.employee_id == user.employee_id)
    elif employee_id:
        query = query.where(Timesheet.employee_id == employee_id)
    if period_start:
        query = query.where(Timesheet.period_start >= period_start)
    if period_end:
        query = query.where(Timesheet.period_end <= period_end)

    result = await db.execute(query)
    timesheets = result.scalars().all()
    return [await _serialize_timesheet(db, ts) for ts in timesheets]


@router.post("/", status_code=201)
async def submit_timesheet(
    data: TimesheetCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    if getattr(user, "role", "") == "employee":
        if not getattr(user, "employee_id", None) or user.employee_id != data.employee_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette FDT")
    target, created = await upsert_submitted_timesheet(db, data)
    await sync_timesheet_attachments_to_reviews(db, target)
    await db.commit()
    return {
        "id": target.id,
        "message": "FDT soumise" if created else "FDT mise à jour",
    }


@router.put("/{tid}/approve")
async def approve_timesheet(
    tid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    ts.status = "approved"
    await db.commit()
    return {"message": "FDT approuvée"}


@router.put("/{tid}/reject")
async def reject_timesheet(
    tid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    ts.status = "rejected"
    await db.commit()
    return {"message": "FDT refusée"}


@router.delete("/{tid}")
async def delete_timesheet(
    tid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == tid))
    for shift in shifts_result.scalars().all():
        await db.delete(shift)
    attachments_result = await db.execute(select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == tid))
    for attachment in attachments_result.scalars().all():
        await db.delete(attachment)
    await db.delete(ts)
    await db.commit()
    return {"message": "FDT supprimée"}


@router.get("/{tid}/attachments")
async def list_timesheet_attachments(
    tid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    _ensure_timesheet_access(user, ts)
    attachments_result = await db.execute(
        select(TimesheetAttachment)
        .where(TimesheetAttachment.timesheet_id == tid)
        .order_by(TimesheetAttachment.created_at.desc())
    )
    return [serialize_timesheet_attachment(att) for att in attachments_result.scalars().all()]


@router.post("/{tid}/attachments")
async def upload_timesheet_attachment(
    tid: str,
    file: UploadFile = File(...),
    category: str = Form("fdt"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    _ensure_timesheet_access(user, ts)

    content_type = file.content_type or ""
    if content_type and content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"Type non supporté: {content_type}")
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (max 10 MB)")

    attachment, created = await add_timesheet_attachment(
        db,
        timesheet_id=tid,
        filename=file.filename or "document",
        file_data=data,
        content_type=content_type,
        category=category,
        description=description,
        uploaded_by=uploaded_by or getattr(user, "email", "admin"),
        source="manual",
    )
    await sync_timesheet_attachments_to_reviews(db, ts)
    await db.commit()
    payload = serialize_timesheet_attachment(attachment)
    payload["message"] = "Pièce jointe ajoutée" if created else "Pièce jointe déjà présente"
    return payload


@router.get("/{tid}/attachments/{att_id}")
async def get_timesheet_attachment(
    tid: str,
    att_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    timesheet_result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = timesheet_result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    _ensure_timesheet_access(user, ts)

    result = await db.execute(
        select(TimesheetAttachment).where(
            TimesheetAttachment.id == att_id,
            TimesheetAttachment.timesheet_id == tid,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable")
    media_type = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(str(attachment.file_type).lower(), "application/octet-stream")
    return Response(
        content=attachment.file_data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.original_filename}"'},
    )


@router.delete("/{tid}/attachments/{att_id}")
async def delete_timesheet_attachment(
    tid: str,
    att_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    timesheet_result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = timesheet_result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    _ensure_timesheet_access(user, ts)

    result = await db.execute(
        select(TimesheetAttachment).where(
            TimesheetAttachment.id == att_id,
            TimesheetAttachment.timesheet_id == tid,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable")
    await db.delete(attachment)
    await db.commit()
    return {"message": "Pièce jointe supprimée"}
