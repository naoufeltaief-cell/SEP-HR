"""Client routes — CRUD"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import Client
from ..models.schemas import ClientCreate, ClientUpdate
from ..services.auth_service import require_admin

router = APIRouter()


def _serialize_client(client: Client) -> dict:
    return {
        "id": client.id,
        "name": client.name or "",
        "address": client.address or "",
        "email": client.email or "",
        "phone": client.phone or "",
        "tax_exempt": bool(client.tax_exempt),
    }


@router.get("")
@router.get("/")
async def list_clients(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Client).where(Client.is_active == True).order_by(Client.name))
    return [_serialize_client(c) for c in result.scalars().all()]


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_client(data: ClientCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    payload = data.model_dump()
    payload["name"] = (payload.get("name") or "").strip()
    payload["address"] = (payload.get("address") or "").strip()
    payload["email"] = (payload.get("email") or "").strip()
    payload["phone"] = (payload.get("phone") or "").strip()
    if not payload["name"]:
        raise HTTPException(status_code=400, detail="Le nom du client est requis")

    client = Client(**payload)
    db.add(client)
    try:
        await db.commit()
        await db.refresh(client)
    except SQLAlchemyError as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Echec de creation du client: {str(e)}")
    return _serialize_client(client)


@router.put("/{cid}")
async def update_client(cid: int, data: ClientUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Client).where(Client.id == cid))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable")
    for k, v in data.model_dump(exclude_unset=True).items():
        if isinstance(v, str):
            v = v.strip()
        setattr(client, k, v)
    if not (client.name or "").strip():
        raise HTTPException(status_code=400, detail="Le nom du client est requis")
    try:
        await db.commit()
        await db.refresh(client)
    except SQLAlchemyError as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Echec de mise a jour du client: {str(e)}")
    return _serialize_client(client)
