"""Auth routes — login, register, magic link"""
import json
import os
from datetime import datetime, timedelta
from html import escape
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import User
from ..models.schemas import LoginRequest, MagicLinkRequest, RegisterRequest, TokenResponse, PasswordSetRequest
from ..services.auth_service import (
    ALGORITHM,
    SECRET_KEY,
    hash_password, verify_password, create_access_token,
    generate_magic_token, get_current_user, require_admin, MAGIC_LINK_EXPIRE_MINUTES
)
from ..services.email_service import send_magic_link

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
AUTH_GOOGLE_CLIENT_ID = (
    os.getenv("AUTH_GOOGLE_CLIENT_ID")
    or os.getenv("GOOGLE_CLIENT_ID")
    or os.getenv("BILLING_GMAIL_CLIENT_ID")
    or ""
)
AUTH_GOOGLE_CLIENT_SECRET = (
    os.getenv("AUTH_GOOGLE_CLIENT_SECRET")
    or os.getenv("GOOGLE_CLIENT_SECRET")
    or os.getenv("BILLING_GMAIL_CLIENT_SECRET")
    or ""
)
AUTH_GOOGLE_SCOPES = ["openid", "email", "profile"]


def auth_google_configured() -> bool:
    return bool(AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET)


def _auth_google_redirect_uri(request: Request) -> str:
    configured_base = (
        os.getenv("BACKEND_PUBLIC_URL")
        or os.getenv("RENDER_EXTERNAL_URL")
        or ""
    ).strip()
    if configured_base:
        return f"{configured_base.rstrip('/')}/api/auth/google/callback"

    forwarded_proto = (
        request.headers.get("x-forwarded-proto")
        or request.url.scheme
        or "https"
    ).split(",", 1)[0].strip()
    forwarded_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
        or ""
    ).split(",", 1)[0].strip()
    if forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}/api/auth/google/callback"

    return str(request.url_for("auth_google_callback")).replace("http://", "https://", 1)


def _create_google_oauth_state() -> str:
    payload = {
        "type": "auth_google_login",
        "exp": datetime.utcnow() + timedelta(minutes=15),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _parse_google_oauth_state(state: str) -> dict:
    payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "auth_google_login":
        raise HTTPException(status_code=400, detail="Etat OAuth Google invalide")
    return payload


def _build_google_login_url(redirect_uri: str, state: str) -> str:
    params = {
        "client_id": AUTH_GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(AUTH_GOOGLE_SCOPES),
        "access_type": "online",
        "prompt": "select_account",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def _exchange_google_code(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": AUTH_GOOGLE_CLIENT_ID,
                "client_secret": AUTH_GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
    if response.status_code != 200:
        detail = response.text
        try:
            payload = response.json()
            detail = payload.get("error_description") or payload.get("error") or detail
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Echange Google OAuth echoue: {detail}")
    return response.json()


async def _fetch_google_profile(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Impossible de lire le profil Google: {response.text}")
    return response.json()


def _google_popup_html(ok: bool, message: str, access_token: str = "", user: dict | None = None) -> HTMLResponse:
    frontend_url = (os.getenv("FRONTEND_URL") or "").rstrip("/")
    payload = {
        "type": "sep-auth-google",
        "ok": ok,
        "message": message,
        "access_token": access_token,
        "user": user or {},
    }
    color = "#1f7a1f" if ok else "#b42318"
    script = f"""
    <script>
      (function() {{
        const payload = {json.dumps(payload)};
        if (window.opener) {{
          window.opener.postMessage(payload, "*");
        }} else if ({json.dumps(bool(frontend_url))}) {{
          const params = new URLSearchParams();
          if (payload.ok) {{
            params.set("google_token", payload.access_token || "");
            params.set("google_user", JSON.stringify(payload.user || {{}}));
          }} else {{
            params.set("google_error", payload.message || "");
          }}
          window.location.href = {json.dumps(f"{frontend_url}/login")} + "?" + params.toString();
          return;
        }}
        setTimeout(function() {{
          window.close();
        }}, 1200);
      }})();
    </script>
    """
    return HTMLResponse(
        f"""
        <html><body style="font-family:Arial,sans-serif;padding:24px">
          <h2 style="margin:0 0 12px;color:{color}">{'Connexion Google OK' if ok else 'Connexion Google echouee'}</h2>
          <p style="margin:0 0 12px">{escape(message)}</p>
          <p style="font-size:12px;color:#666">Cette fenetre va se fermer automatiquement.</p>
          {script}
        </body></html>
        """
    )


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


@router.get("/google/status")
async def google_login_status():
    return {"configured": auth_google_configured()}


@router.get("/google/start")
async def google_login_start(request: Request):
    if not auth_google_configured():
        raise HTTPException(
            status_code=500,
            detail="Google OAuth non configure. Ajoutez AUTH_GOOGLE_CLIENT_ID et AUTH_GOOGLE_CLIENT_SECRET.",
        )
    state = _create_google_oauth_state()
    redirect_uri = _auth_google_redirect_uri(request)
    return {"url": _build_google_login_url(redirect_uri, state), "redirect_uri": redirect_uri}


@router.get("/google/callback", name="auth_google_callback")
async def google_login_callback(
    request: Request,
    state: str = Query(""),
    code: str = Query(""),
    error: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    if error:
        return _google_popup_html(False, f"Google a refuse la connexion: {error}")
    if not state or not code:
        return _google_popup_html(False, "Reponse OAuth Google incomplete.")

    try:
        _parse_google_oauth_state(state)
        redirect_uri = _auth_google_redirect_uri(request)
        tokens = await _exchange_google_code(code, redirect_uri)
        profile = await _fetch_google_profile(tokens.get("access_token", ""))
        email = (profile.get("email") or "").strip().lower()
        if not email:
            return _google_popup_html(False, "Adresse courriel Google introuvable.")

        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            return _google_popup_html(False, f"Aucun compte actif SEP-HR n'est associe a {email}.")

        access_token = create_access_token({"sub": user.id, "role": user.role, "email": user.email})
        user_payload = {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "employee_id": user.employee_id,
        }
        return _google_popup_html(True, f"Connexion Google reussie pour {email}.", access_token, user_payload)
    except HTTPException as exc:
        return _google_popup_html(False, exc.detail)
    except Exception as exc:
        return _google_popup_html(False, str(exc))


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
