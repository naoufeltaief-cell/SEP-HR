"""Accommodation routes — CRUD + attachments"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from ..database import get_db
from ..models.models import Accommodation, AccommodationAttachment, Employee, new_id
from ..models.schemas import AccommodationCreate, AccommodationOut, AccommodationUpdate
from ..services.auth_service import require_admin
from ..services.automation_service import sync_accommodation_reminder_state

router = APIRouter()


def _safe_sync_accommodation_reminder(accommodation: Accommodation) -> None:
    try:
        sync_accommodation_reminder_state(accommodation)
    except Exception as exc:
        accommodation.reminder_last_error = str(exc)
        if getattr(accommodation, "reminder_enabled", True):
            accommodation.reminder_status = "error"


def _serialize_accommodation(accommodation: Accommodation, attachment_count: int = 0) -> dict:
    _safe_sync_accommodation_reminder(accommodation)
    return {
        "id": accommodation.id,
        "employee_id": accommodation.employee_id,
        "total_cost": float(getattr(accommodation, "total_cost", 0) or 0),
        "start_date": getattr(accommodation, "start_date", None),
        "end_date": getattr(accommodation, "end_date", None),
        "days_worked": int(getattr(accommodation, "days_worked", 0) or 0),
        "cost_per_day": float(getattr(accommodation, "cost_per_day", 0) or 0),
        "notes": getattr(accommodation, "notes", "") or "",
        "pdf_name": getattr(accommodation, "pdf_name", "") or "",
        "reminder_enabled": bool(getattr(accommodation, "reminder_enabled", True)),
        "reminder_status": getattr(accommodation, "reminder_status", "scheduled") or "scheduled",
        "reminder_scheduled_for": getattr(accommodation, "reminder_scheduled_for", None),
        "reminder_sent_at": getattr(accommodation, "reminder_sent_at", None),
        "reminder_cancelled_at": getattr(accommodation, "reminder_cancelled_at", None),
        "reminder_last_error": getattr(accommodation, "reminder_last_error", "") or "",
        "attachment_count": int(attachment_count or 0),
    }


@router.get("")
@router.get("/")
async def list_accommodations(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Accommodation).order_by(Accommodation.start_date.desc()))
    accommodations = result.scalars().all()
    ids = [a.id for a in accommodations]
    attachment_counts = {}
    if ids:
        try:
            count_result = await db.execute(
                select(AccommodationAttachment.accommodation_id, func.count(AccommodationAttachment.id))
                .where(AccommodationAttachment.accommodation_id.in_(ids))
                .group_by(AccommodationAttachment.accommodation_id)
            )
            attachment_counts = {row[0]: int(row[1] or 0) for row in count_result.all()}
        except Exception:
            attachment_counts = {}
    return [_serialize_accommodation(accommodation, attachment_counts.get(accommodation.id, 0)) for accommodation in accommodations]


@router.post("/", status_code=201)
async def create_accommodation(data: AccommodationCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    accom = Accommodation(id=new_id(), **data.model_dump())
    _safe_sync_accommodation_reminder(accom)
    db.add(accom)
    await db.commit()
    await db.refresh(accom)
    return AccommodationOut.model_validate(accom)


@router.put("/{aid}")
async def update_accommodation(
    aid: str,
    data: AccommodationUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Accommodation).where(Accommodation.id == aid))
    accom = result.scalar_one_or_none()
    if not accom:
        raise HTTPException(status_code=404, detail="Hébergement introuvable")

    payload = data.model_dump(exclude_unset=True)
    employee_id = payload.get("employee_id")
    if employee_id is not None:
        employee_result = await db.execute(select(Employee).where(Employee.id == employee_id))
        employee = employee_result.scalar_one_or_none()
        if not employee:
            raise HTTPException(status_code=404, detail="Employé introuvable")

    for field, value in payload.items():
        setattr(accom, field, value)
    _safe_sync_accommodation_reminder(accom)

    await db.commit()
    await db.refresh(accom)
    return AccommodationOut.model_validate(accom)


@router.post("/{aid}/reminder/cancel")
async def cancel_accommodation_reminder(
    aid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Accommodation).where(Accommodation.id == aid))
    accom = result.scalar_one_or_none()
    if not accom:
        raise HTTPException(status_code=404, detail="Hébergement introuvable")
    accom.reminder_enabled = False
    _safe_sync_accommodation_reminder(accom)
    await db.commit()
    await db.refresh(accom)
    return AccommodationOut.model_validate(accom)


@router.post("/{aid}/reminder/reactivate")
async def reactivate_accommodation_reminder(
    aid: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Accommodation).where(Accommodation.id == aid))
    accom = result.scalar_one_or_none()
    if not accom:
        raise HTTPException(status_code=404, detail="Hébergement introuvable")
    accom.reminder_enabled = True
    accom.reminder_sent_at = None
    accom.reminder_last_error = ""
    _safe_sync_accommodation_reminder(accom)
    await db.commit()
    await db.refresh(accom)
    return AccommodationOut.model_validate(accom)


@router.delete("/{aid}")
async def delete_accommodation(aid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Accommodation).where(Accommodation.id == aid))
    accom = result.scalar_one_or_none()
    if not accom:
        raise HTTPException(status_code=404, detail="Hébergement introuvable")
    await db.delete(accom)
    await db.commit()
    return {"message": "Hébergement supprimé"}


@router.get("/{aid}/attachments")
async def list_accommodation_attachments(aid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(AccommodationAttachment).where(AccommodationAttachment.accommodation_id == aid).order_by(AccommodationAttachment.created_at.desc()))
    return [{
        "id": a.id,
        "accommodation_id": a.accommodation_id,
        "filename": a.filename,
        "original_filename": a.original_filename,
        "file_type": a.file_type,
        "file_size": a.file_size,
        "category": a.category,
        "description": a.description,
        "uploaded_by": a.uploaded_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in result.scalars().all()]


@router.post("/{aid}/attachments")
async def upload_accommodation_attachment(
    aid: str,
    file: UploadFile = File(...),
    category: str = Form("hebergement"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    acc_result = await db.execute(select(Accommodation).where(Accommodation.id == aid))
    accom = acc_result.scalar_one_or_none()
    if not accom:
        raise HTTPException(status_code=404, detail="Hébergement introuvable")
    data = await file.read()
    ext = (file.filename.split('.')[-1].lower() if file.filename and '.' in file.filename else '').strip()
    att = AccommodationAttachment(
        accommodation_id=aid,
        filename=file.filename,
        original_filename=file.filename,
        file_type=ext or (file.content_type or 'bin'),
        file_size=len(data),
        file_data=data,
        category=category,
        description=description,
        uploaded_by=uploaded_by,
    )
    accom.pdf_name = file.filename or accom.pdf_name
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return {
        "id": att.id,
        "accommodation_id": att.accommodation_id,
        "filename": att.filename,
        "original_filename": att.original_filename,
        "file_type": att.file_type,
        "file_size": att.file_size,
        "category": att.category,
        "description": att.description,
        "uploaded_by": att.uploaded_by,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/{aid}/attachments/{att_id}")
async def get_accommodation_attachment(aid: str, att_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(AccommodationAttachment).where(AccommodationAttachment.id == att_id, AccommodationAttachment.accommodation_id == aid))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable")
    media_type = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
        "txt": "text/plain",
        "csv": "text/csv",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
    }.get(str(att.file_type).lower(), "application/octet-stream")
    return Response(
        content=att.file_data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'},
    )


@router.delete("/{aid}/attachments/{att_id}")
async def delete_accommodation_attachment(aid: str, att_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(AccommodationAttachment).where(AccommodationAttachment.id == att_id, AccommodationAttachment.accommodation_id == aid))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable")
    await db.delete(att)
    await db.commit()
    return {"message": "Pièce jointe supprimée"}
