"""Auth routes — login, register, magic link"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import User
from ..models.schemas import LoginRequest, MagicLinkRequest, RegisterRequest, TokenResponse, PasswordSetRequest
from ..services.auth_service import (
    hash_password, verify_password, create_access_token,
    generate_magic_token, get_current_user, require_admin, MAGIC_LINK_EXPIRE_MINUTES
)
from ..services.email_service import send_magic_link

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email.lower().strip()))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    if req.password:
        if not user.password_hash or not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Mot de passe incorrect")
    else:
        raise HTTPException(status_code=400, detail="Mot de passe requis ou utilisez le magic link")
    token = create_access_token({"sub": user.id, "role": user.role, "email": user.email})
    return TokenResponse(access_token=token, user={"id": user.id, "email": user.email, "name": user.name, "role": user.role, "employee_id": user.employee_id})


@router.post("/magic-link")
async def request_magic_link(req: MagicLinkRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email.lower().strip()))
    user = result.scalar_one_or_none()
    if not user:
        # Don't reveal if user exists
        return {"message": "Si ce courriel existe, un lien de connexion a été envoyé."}
    token = generate_magic_token()
    user.magic_token = token
    user.magic_token_expires = datetime.utcnow() + timedelta(minutes=MAGIC_LINK_EXPIRE_MINUTES)
    await db.commit()
    await send_magic_link(user.email, token, user.name)
    return {"message": "Si ce courriel existe, un lien de connexion a été envoyé."}


@router.post("/magic-verify", response_model=TokenResponse)
async def verify_magic_link(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.magic_token == token))
    user = result.scalar_one_or_none()
    if not user or not user.magic_token_expires or user.magic_token_expires < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Lien expiré ou invalide")
    user.magic_token = None
    user.magic_token_expires = None
    await db.commit()
    access_token = create_access_token({"sub": user.id, "role": user.role, "email": user.email})
    return TokenResponse(access_token=access_token, user={"id": user.id, "email": user.email, "name": user.name, "role": user.role, "employee_id": user.employee_id})


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email.lower().strip()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ce courriel est déjà utilisé")
    user = User(
        email=req.email.lower().strip(),
        name=req.name,
        password_hash=hash_password(req.password) if req.password else None,
        role=req.role,
        employee_id=req.employee_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": user.id, "role": user.role, "email": user.email})
    return TokenResponse(access_token=token, user={"id": user.id, "email": user.email, "name": user.name, "role": user.role, "employee_id": user.employee_id})


@router.post("/set-password")
async def set_password(req: PasswordSetRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.password_hash = hash_password(req.password)
    await db.commit()
    return {"message": "Mot de passe mis à jour"}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "employee_id": user.employee_id}
