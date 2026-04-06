import json
import os
from html import escape
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.auth_service import require_admin
from ..services.billing_gmail_oauth import (
    BILLING_SENDER_EMAIL,
    build_google_oauth_url,
    create_oauth_state,
    disconnect_billing_gmail,
    exchange_code_for_tokens,
    fetch_google_account_email,
    get_billing_gmail_status,
    gmail_oauth_configured,
    parse_oauth_state,
    send_via_connected_billing_gmail,
    store_billing_gmail_tokens,
)
from ..services.email_service import test_billing_email_connection

router = APIRouter()


def _billing_redirect_uri(request: Request) -> str:
    configured_base = (
        os.getenv("BACKEND_PUBLIC_URL")
        or os.getenv("RENDER_EXTERNAL_URL")
        or ""
    ).strip()
    if configured_base:
        return f"{configured_base.rstrip('/')}/api/billing-email/callback"

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
        return f"{forwarded_proto}://{forwarded_host}/api/billing-email/callback"

    return str(request.url_for("billing_email_callback")).replace("http://", "https://", 1)


def _popup_html(ok: bool, message: str) -> HTMLResponse:
    payload = {"type": "sep-billing-gmail-oauth", "ok": ok, "message": message}
    safe_message = escape(message)
    script = f"""
    <script>
      (function() {{
        const payload = {json.dumps(payload)};
        if (window.opener) {{
          window.opener.postMessage(payload, "*");
        }}
        setTimeout(function() {{
          window.close();
        }}, 1200);
      }})();
    </script>
    """
    color = "#1f7a1f" if ok else "#b42318"
    return HTMLResponse(
        f"""
        <html><body style="font-family:Arial,sans-serif;padding:24px">
          <h2 style="margin:0 0 12px;color:{color}">{'Connexion Gmail OK' if ok else 'Connexion Gmail échouée'}</h2>
          <p style="margin:0 0 12px">{safe_message}</p>
          <p style="font-size:12px;color:#666">Cette fenêtre va se fermer automatiquement.</p>
          {script}
        </body></html>
        """
    )


@router.get("/status")
async def billing_email_status(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    return await get_billing_gmail_status(db)


@router.get("/connect")
async def billing_email_connect(
    request: Request,
    user=Depends(require_admin),
):
    if not gmail_oauth_configured():
        raise HTTPException(
            500,
            "Google OAuth non configuré. Ajoutez BILLING_GMAIL_CLIENT_ID et BILLING_GMAIL_CLIENT_SECRET.",
        )
    state = create_oauth_state(getattr(user, "email", ""))
    redirect_uri = _billing_redirect_uri(request)
    return {"url": build_google_oauth_url(redirect_uri, state), "redirect_uri": redirect_uri}


@router.get("/callback", name="billing_email_callback")
async def billing_email_callback(
    request: Request,
    state: str = Query(""),
    code: str = Query(""),
    error: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    if error:
        return _popup_html(False, f"Google a refusé la connexion: {error}")
    if not state or not code:
        return _popup_html(False, "Réponse OAuth incomplète.")
    try:
        payload = parse_oauth_state(state)
        redirect_uri = _billing_redirect_uri(request)
        tokens = await exchange_code_for_tokens(code, redirect_uri)
        account_email = await fetch_google_account_email(tokens.get("access_token", ""))
        if account_email.lower() != BILLING_SENDER_EMAIL.lower():
            return _popup_html(
                False,
                f"Vous avez connecté {account_email}. Connectez plutôt {BILLING_SENDER_EMAIL}.",
            )
        await store_billing_gmail_tokens(
            db,
            tokens=tokens,
            account_email=account_email,
            connected_by=payload.get("user_email", ""),
        )
        return _popup_html(True, f"Le compte {account_email} est maintenant connecté pour la facturation.")
    except Exception as e:
        return _popup_html(False, str(e))


@router.delete("/disconnect")
async def billing_email_disconnect(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    await disconnect_billing_gmail(db)
    return {"message": "Connexion Gmail de facturation supprimée."}


@router.post("/test")
async def billing_email_test(
    payload: Optional[dict] = Body(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    to_email = ""
    if isinstance(payload, dict):
        to_email = (payload.get("to_email") or "").strip()
    if not to_email:
        to_email = (getattr(user, "email", "") or "").strip()
    if not to_email:
        raise HTTPException(400, "Aucune adresse de test fournie")

    try:
        delivery = await send_via_connected_billing_gmail(
            db,
            to_email=to_email,
            subject="Test courriel facturation - Soins Expert Plus",
            body_text=(
                "Ceci est un test du compte Gmail de facturation.\n\n"
                f"Le compte attendu est {BILLING_SENDER_EMAIL}."
            ),
        )
        if not delivery:
            delivery = await test_billing_email_connection(to_email)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Test courriel echoue: {str(e)}")

    return {
        **delivery,
        "message": (
            f"Test courriel OK. Envoye de {delivery.get('from_email', BILLING_SENDER_EMAIL)} "
            f"vers {to_email} via {delivery.get('transport', 'unknown')}."
        ),
    }
