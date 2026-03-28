"""Accommodation routes — CRUD"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import Accommodation, new_id
from ..models.schemas import AccommodationCreate, AccommodationOut
from ..services.auth_service import require_admin

router = APIRouter()


@router.get("/")
async def list_accommodations(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Accommodation).order_by(Accommodation.start_date.desc()))
    return [AccommodationOut.model_validate(a) for a in result.scalars().all()]


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
