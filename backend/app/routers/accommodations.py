"""Accommodation routes — CRUD + attachments"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from ..database import get_db
from ..models.models import Accommodation, AccommodationAttachment, new_id
from ..models.schemas import AccommodationCreate, AccommodationOut
from ..services.auth_service import require_admin

router = APIRouter()


@router.get("")
@router.get("/")
async def list_accommodations(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Accommodation).order_by(Accommodation.start_date.desc()))
    accommodations = result.scalars().all()
    ids = [a.id for a in accommodations]
    attachment_counts = {}
    if ids:
        count_result = await db.execute(
            select(AccommodationAttachment.accommodation_id, func.count(AccommodationAttachment.id))
            .where(AccommodationAttachment.accommodation_id.in_(ids))
            .group_by(AccommodationAttachment.accommodation_id)
        )
        attachment_counts = {row[0]: int(row[1] or 0) for row in count_result.all()}
    return [
        {
            **AccommodationOut.model_validate(accommodation).model_dump(),
            "attachment_count": attachment_counts.get(accommodation.id, 0),
        }
        for accommodation in accommodations
    ]


@router.post("/", status_code=201)
async def create_accommodation(data: AccommodationCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    accom = Accommodation(id=new_id(), **data.model_dump())
    db.add(accom)
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
