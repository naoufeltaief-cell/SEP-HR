"""Client routes — CRUD"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import Client
from ..models.schemas import ClientCreate, ClientUpdate, ClientOut
from ..services.auth_service import require_admin

router = APIRouter()


@router.get("")
@router.get("/")
async def list_clients(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Client).where(Client.is_active == True).order_by(Client.name))
    return [ClientOut.model_validate(c) for c in result.scalars().all()]


@router.post("/", status_code=201)
async def create_client(data: ClientCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    client = Client(**data.model_dump())
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return ClientOut.model_validate(client)


@router.put("/{cid}")
async def update_client(cid: int, data: ClientUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Client).where(Client.id == cid))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(client, k, v)
    await db.commit()
    await db.refresh(client)
    return ClientOut.model_validate(client)
