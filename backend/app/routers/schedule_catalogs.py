from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.models import ScheduleCatalogItem
from ..models.schemas import (
    ScheduleCatalogItemCreate,
    ScheduleCatalogItemOut,
    ScheduleCatalogItemUpdate,
)
from ..services.auth_service import get_current_user, require_admin

router = APIRouter()

ALLOWED_KINDS = {"position", "location"}


def _normalize_kind(value: str) -> str:
    return str(value or "").strip().lower()


def _normalize_label(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_hourly_rate(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


@router.get("")
@router.get("/")
async def list_schedule_catalog_items(
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    query = select(ScheduleCatalogItem).order_by(
        ScheduleCatalogItem.kind.asc(),
        ScheduleCatalogItem.label.asc(),
    )
    normalized_kind = _normalize_kind(kind) if kind else ""
    if normalized_kind:
        if normalized_kind not in ALLOWED_KINDS:
            raise HTTPException(status_code=400, detail="Type de catalogue invalide")
        query = query.where(ScheduleCatalogItem.kind == normalized_kind)

    result = await db.execute(query)
    return [
        ScheduleCatalogItemOut.model_validate(item).model_dump()
        for item in result.scalars().all()
    ]


@router.post("/", status_code=201)
async def create_schedule_catalog_item(
    data: ScheduleCatalogItemCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    kind = _normalize_kind(data.kind)
    label = _normalize_label(data.label)

    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Type de catalogue invalide")
    if not label:
        raise HTTPException(status_code=400, detail="Libelle requis")

    existing_result = await db.execute(
        select(ScheduleCatalogItem).where(
            ScheduleCatalogItem.kind == kind,
            func.lower(ScheduleCatalogItem.label) == label.lower(),
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return ScheduleCatalogItemOut.model_validate(existing)

    item = ScheduleCatalogItem(
        kind=kind,
        label=label,
        hourly_rate=_normalize_hourly_rate(data.hourly_rate),
        created_by=getattr(user, "email", "admin"),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return ScheduleCatalogItemOut.model_validate(item)


@router.put("/{item_id}")
async def update_schedule_catalog_item(
    item_id: int,
    data: ScheduleCatalogItemUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(ScheduleCatalogItem).where(ScheduleCatalogItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Element de catalogue introuvable")

    updates = data.model_dump(exclude_unset=True)
    if "label" in updates:
        normalized_label = _normalize_label(updates["label"])
        if not normalized_label:
            raise HTTPException(status_code=400, detail="Libelle requis")
        existing_result = await db.execute(
            select(ScheduleCatalogItem).where(
                ScheduleCatalogItem.kind == item.kind,
                func.lower(ScheduleCatalogItem.label) == normalized_label.lower(),
                ScheduleCatalogItem.id != item.id,
            )
        )
        if existing_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Ce libelle existe deja")
        item.label = normalized_label

    if "hourly_rate" in updates:
        item.hourly_rate = _normalize_hourly_rate(updates["hourly_rate"])

    await db.commit()
    await db.refresh(item)
    return ScheduleCatalogItemOut.model_validate(item)
