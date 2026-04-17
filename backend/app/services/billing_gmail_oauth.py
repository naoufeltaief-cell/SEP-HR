import base64
import mimetypes
import os
import re
from datetime import datetime, timedelta
from email import encoders
from email.mime.application import MIMEApplication
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import getaddresses
from html import unescape
from typing import Optional
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models import BillingEmailConnection
from .auth_service import ALGORITHM, SECRET_KEY

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts"

BILLING_GMAIL_CLIENT_ID = (
    os.getenv("BILLING_GMAIL_CLIENT_ID")
    or os.getenv("GOOGLE_CLIENT_ID")
    or os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    or ""
)
BILLING_GMAIL_CLIENT_SECRET = (
    os.getenv("BILLING_GMAIL_CLIENT_SECRET")
    or os.getenv("GOOGLE_CLIENT_SECRET")
    or os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
    or ""
)
BILLING_SENDER_EMAIL = os.getenv("BILLING_SENDER_EMAIL", "paie@soins-expert-plus.com").strip().lower()
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
]


def gmail_oauth_configured() -> bool:
    return bool(BILLING_GMAIL_CLIENT_ID and BILLING_GMAIL_CLIENT_SECRET)


async def get_billing_gmail_connection(db: AsyncSession) -> Optional[BillingEmailConnection]:
    result = await db.execute(
        select(BillingEmailConnection)
        .where(BillingEmailConnection.purpose == "billing")
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_billing_gmail_status(db: AsyncSession) -> dict:
    conn = await get_billing_gmail_connection(db)
    return {
        "configured": gmail_oauth_configured(),
        "connected": bool(conn and conn.is_active and conn.refresh_token),
        "provider": "gmail",
        "purpose": "billing",
        "expected_email": BILLING_SENDER_EMAIL,
        "connected_email": (conn.email if conn else "") or "",
        "connected_by": (conn.connected_by if conn else "") or "",
        "updated_at": conn.updated_at.isoformat() if conn and conn.updated_at else None,
        "last_error": (conn.last_error if conn else "") or "",
    }


def create_oauth_state(user_email: str) -> str:
    payload = {
        "type": "billing_gmail_connect",
        "user_email": user_email or "",
        "exp": datetime.utcnow() + timedelta(minutes=15),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def parse_oauth_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise RuntimeError(f"Etat OAuth invalide: {str(e)}")
    if payload.get("type") != "billing_gmail_connect":
        raise RuntimeError("Etat OAuth invalide")
    return payload


def build_google_oauth_url(redirect_uri: str, state: str) -> str:
    params = {
        "client_id": BILLING_GMAIL_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "login_hint": BILLING_SENDER_EMAIL,
    }
    if "@" in BILLING_SENDER_EMAIL:
        params["hd"] = BILLING_SENDER_EMAIL.split("@", 1)[1]
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict:
    if not gmail_oauth_configured():
        raise RuntimeError("Google OAuth non configuré sur le serveur")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": BILLING_GMAIL_CLIENT_ID,
                "client_secret": BILLING_GMAIL_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
    if response.status_code != 200:
        detail = response.text
        try:
            detail = response.json().get("error_description") or response.json().get("error") or detail
        except Exception:
            pass
        raise RuntimeError(f"Echange OAuth échoué: {detail}")
    return response.json()


async def fetch_google_account_email(access_token: str) -> str:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        raise RuntimeError(f"Impossible de lire le profil Google: {response.text}")
    data = response.json()
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise RuntimeError("Adresse courriel Google introuvable")
    return email


async def store_billing_gmail_tokens(
    db: AsyncSession,
    tokens: dict,
    account_email: str,
    connected_by: str,
) -> BillingEmailConnection:
    conn = await get_billing_gmail_connection(db)
    if not conn:
        conn = BillingEmailConnection(purpose="billing")
        db.add(conn)

    refresh_token = (tokens.get("refresh_token") or "").strip() or (conn.refresh_token or "")
    if not refresh_token:
        raise RuntimeError("Aucun refresh token Google reçu")

    expires_in = int(tokens.get("expires_in") or 3600)
    conn.provider = "gmail"
    conn.purpose = "billing"
    conn.email = account_email
    conn.access_token = (tokens.get("access_token") or "").strip()
    conn.refresh_token = refresh_token
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=max(expires_in - 60, 60))
    conn.scope = tokens.get("scope") or " ".join(GMAIL_SCOPES)
    conn.connected_by = connected_by or ""
    conn.is_active = True
    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conn)
    return conn


async def disconnect_billing_gmail(db: AsyncSession) -> None:
    conn = await get_billing_gmail_connection(db)
    if not conn:
        return
    conn.is_active = False
    conn.access_token = ""
    conn.refresh_token = ""
    conn.token_expires_at = None
    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()


async def _refresh_access_token(db: AsyncSession, conn: BillingEmailConnection) -> str:
    if not conn.refresh_token:
        raise RuntimeError("Refresh token Gmail absent. Reconnectez le compte de facturation.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": BILLING_GMAIL_CLIENT_ID,
                "client_secret": BILLING_GMAIL_CLIENT_SECRET,
                "refresh_token": conn.refresh_token,
                "grant_type": "refresh_token",
            },
            headers={"Accept": "application/json"},
        )
    if response.status_code != 200:
        conn.last_error = response.text
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(f"Refresh token Gmail invalide: {response.text}")
    data = response.json()
    expires_in = int(data.get("expires_in") or 3600)
    conn.access_token = (data.get("access_token") or "").strip()
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=max(expires_in - 60, 60))
    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    return conn.access_token


async def get_valid_billing_access_token(db: AsyncSession, conn: BillingEmailConnection) -> str:
    if not gmail_oauth_configured():
        raise RuntimeError("Google OAuth non configuré sur le serveur")
    if not conn or not conn.is_active or not conn.refresh_token:
        raise RuntimeError("Le compte Gmail de facturation n'est pas connecté")
    if conn.email.strip().lower() != BILLING_SENDER_EMAIL:
        raise RuntimeError(
            f"Le compte connecté est {conn.email}. Connectez {BILLING_SENDER_EMAIL}."
        )
    if conn.access_token and conn.token_expires_at and conn.token_expires_at > datetime.utcnow():
        return conn.access_token
    return await _refresh_access_token(db, conn)


def _html_to_text(value: str) -> str:
    raw = value or ""
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</p\s*>", "\n\n", raw)
    raw = re.sub(r"(?i)</div\s*>", "\n", raw)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = unescape(raw)
    raw = raw.replace("\xa0", " ")
    raw = re.sub(r"[ \t]+\n", "\n", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def _build_raw_message(
    to_email: str,
    subject: str,
    body_text: str = "",
    body_html: str = "",
    attachment_bytes: bytes = b"",
    attachment_name: str = "",
    in_reply_to: str = "",
    references: str = "",
    reply_to_email: str = "",
    cc_emails: Optional[list[str]] = None,
    bcc_emails: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> str:
    msg = MIMEMultipart("mixed")
    msg["From"] = f"Soins Expert Plus <{BILLING_SENDER_EMAIL}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    if cc_emails:
        msg["Cc"] = ", ".join(_normalize_recipient_list(cc_emails))
    if bcc_emails:
        msg["Bcc"] = ", ".join(_normalize_recipient_list(bcc_emails))
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    if reply_to_email:
        msg["Reply-To"] = reply_to_email.strip()

    text_value = (body_text or "").strip()
    html_value = (body_html or "").strip()
    if not text_value and html_value:
        text_value = _html_to_text(html_value)

    body_part = MIMEMultipart("alternative")
    if text_value or not html_value:
        body_part.attach(MIMEText(text_value, "plain", "utf-8"))
    if html_value:
        body_part.attach(MIMEText(html_value, "html", "utf-8"))
    msg.attach(body_part)
    normalized_attachments = list(attachments or [])
    if attachment_bytes:
        normalized_attachments.append(
            {
                "filename": attachment_name or "document.pdf",
                "mime_type": "application/pdf",
                "content": attachment_bytes,
            }
        )
    for attachment in normalized_attachments:
        filename = (attachment.get("filename") or "document.bin").strip() or "document.bin"
        mime_type = (attachment.get("mime_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream").strip()
        maintype, _, subtype = mime_type.partition("/")
        maintype = maintype or "application"
        subtype = subtype or "octet-stream"
        part = MIMEBase(maintype, subtype)
        part.set_payload(attachment.get("content") or b"")
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def _header_value(headers, name: str) -> str:
    target = (name or "").strip().lower()
    for header in headers or []:
        if (header.get("name") or "").strip().lower() == target:
            return header.get("value") or ""
    return ""


def _payload_has_pdf(payload: dict) -> bool:
    if not isinstance(payload, dict):
        return False
    filename = (payload.get("filename") or "").strip().lower()
    if filename.endswith(".pdf"):
        return True
    for part in payload.get("parts") or []:
        if _payload_has_pdf(part):
            return True
    return False


def _normalize_recipient_list(items) -> list[str]:
    recipients = []
    for _, email in getaddresses(items or []):
        normalized = (email or "").strip()
        if normalized and normalized not in recipients:
            recipients.append(normalized)
    return recipients


def _payload_attachment_parts(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    found = []
    filename = (payload.get("filename") or "").strip()
    mime_type = (payload.get("mimeType") or "").strip().lower()
    body = payload.get("body") or {}
    attachment_id = (body.get("attachmentId") or "").strip()
    if filename and attachment_id:
        found.append(
            {
                "filename": filename,
                "mime_type": mime_type,
                "attachment_id": attachment_id,
                "size": int(body.get("size") or 0),
            }
        )
    for part in payload.get("parts") or []:
        found.extend(_payload_attachment_parts(part))
    return found


async def list_recent_billing_gmail_messages(
    db: AsyncSession,
    max_results: int = 10,
    search: str = "",
    folder: str = "INBOX",
    unread_only: bool = False,
) -> Optional[dict]:
    conn = await get_billing_gmail_connection(db)
    if not conn or not conn.is_active or not conn.refresh_token:
        return None

    access_token = await get_valid_billing_access_token(db, conn)
    query_parts = []
    normalized_folder = (folder or "INBOX").strip().upper()
    if normalized_folder == "INBOX":
        query_parts.append("in:inbox")
    elif normalized_folder and normalized_folder != "ALL":
        query_parts.append(f"label:{normalized_folder}")
    if unread_only:
        query_parts.append("is:unread")
    if search:
        query_parts.append(str(search).strip())

    params = {"maxResults": max(1, min(int(max_results or 10), 20))}
    if query_parts:
        params["q"] = " ".join(part for part in query_parts if part)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            GMAIL_MESSAGES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )

        if response.status_code == 401:
            access_token = await _refresh_access_token(db, conn)
            response = await client.get(
                GMAIL_MESSAGES_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )

        if response.status_code == 403 and "insufficient" in response.text.lower():
            raise RuntimeError(
                "La connexion Gmail actuelle n'a pas encore la permission de lire les courriels. Clique 'Reconnecter Gmail' pour autoriser l'acces a la boite paie."
            )
        if response.status_code != 200:
            conn.last_error = response.text
            conn.updated_at = datetime.utcnow()
            await db.commit()
            raise RuntimeError(f"Lecture Gmail echouee: {response.text}")

        listing = response.json()
        messages = listing.get("messages") or []
        items = []
        for message in messages:
            msg_id = message.get("id")
            if not msg_id:
                continue
            detail = await client.get(
                f"{GMAIL_MESSAGES_URL}/{msg_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"format": "full"},
            )
            if detail.status_code != 200:
                continue
            payload = detail.json()
            headers = ((payload.get("payload") or {}).get("headers") or [])
            body_preview = (payload.get("snippet") or "").strip()
            attachment_parts = _payload_attachment_parts(payload.get("payload") or {})
            items.append(
                {
                    "id": msg_id,
                    "thread_id": payload.get("threadId", ""),
                    "from": _header_value(headers, "From"),
                    "from_email": getaddresses([_header_value(headers, "From")])[0][1] if _header_value(headers, "From") else "",
                    "subject": _header_value(headers, "Subject"),
                    "date": _header_value(headers, "Date")[:25],
                    "internet_message_id": _header_value(headers, "Message-ID"),
                    "references": _header_value(headers, "References"),
                    "body_preview": body_preview[:200],
                    "attachment_count": len(attachment_parts),
                    "attachment_names": [part.get("filename", "") for part in attachment_parts if part.get("filename")],
                    "attachment_types": [part.get("mime_type", "") for part in attachment_parts if part.get("mime_type")],
                    "has_attachments": bool(attachment_parts),
                    "has_pdf_attachment": _payload_has_pdf(payload.get("payload") or {}),
                }
            )

    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "mailbox": conn.email or BILLING_SENDER_EMAIL,
        "folder": normalized_folder,
        "transport": "gmail_oauth",
        "items": items,
    }


async def list_recent_billing_gmail_documents(
    db: AsyncSession,
    max_results: int = 10,
    search: str = "",
    unread_only: bool = False,
) -> Optional[list[dict]]:
    conn = await get_billing_gmail_connection(db)
    if not conn or not conn.is_active or not conn.refresh_token:
        return None

    access_token = await get_valid_billing_access_token(db, conn)
    query_parts = ["has:attachment"]
    if unread_only:
        query_parts.append("is:unread")
    if search:
        query_parts.append(str(search).strip())

    requested_results = max(1, min(int(max_results or 10), 200))
    documents = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        messages = []
        page_token = ""
        while len(messages) < requested_results:
            params = {
                "maxResults": min(100, requested_results - len(messages)),
                "q": " ".join(query_parts),
            }
            if page_token:
                params["pageToken"] = page_token
            response = await client.get(
                GMAIL_MESSAGES_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            if response.status_code == 401:
                access_token = await _refresh_access_token(db, conn)
                response = await client.get(
                    GMAIL_MESSAGES_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
            if response.status_code != 200:
                conn.last_error = response.text
                conn.updated_at = datetime.utcnow()
                await db.commit()
                raise RuntimeError(f"Lecture Gmail echouee: {response.text}")

            listing = response.json()
            batch = listing.get("messages") or []
            if not batch:
                break
            messages.extend(batch)
            page_token = str(listing.get("nextPageToken") or "").strip()
            if not page_token:
                break

        messages = messages[:requested_results]
        for message in messages:
            msg_id = message.get("id")
            if not msg_id:
                continue
            response = await client.get(
                f"{GMAIL_MESSAGES_URL}/{msg_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"format": "full"},
            )
            if response.status_code != 200:
                continue
            payload = response.json()
            headers = ((payload.get("payload") or {}).get("headers") or [])
            attachment_parts = _payload_attachment_parts(payload.get("payload") or {})
            if not attachment_parts:
                continue
            for part in attachment_parts:
                attachment_response = await client.get(
                    f"{GMAIL_MESSAGES_URL}/{msg_id}/attachments/{part['attachment_id']}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if attachment_response.status_code != 200:
                    continue
                attachment_data = attachment_response.json()
                encoded = attachment_data.get("data") or ""
                if not encoded:
                    continue
                try:
                    file_bytes = base64.urlsafe_b64decode(encoded.encode("ascii"))
                except Exception:
                    continue
                documents.append(
                    {
                        "message_id": msg_id,
                        "thread_id": payload.get("threadId", ""),
                        "from": _header_value(headers, "From"),
                        "from_email": getaddresses([_header_value(headers, "From")])[0][1] if _header_value(headers, "From") else "",
                        "subject": _header_value(headers, "Subject"),
                        "date": _header_value(headers, "Date"),
                        "body_preview": (payload.get("snippet") or "").strip()[:500],
                        "filename": part["filename"],
                        "mime_type": part["mime_type"],
                        "file_size": len(file_bytes),
                        "file_data": file_bytes,
                        "internet_message_id": _header_value(headers, "Message-ID"),
                        "references": _header_value(headers, "References"),
                    }
                )

    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    return documents


async def send_via_connected_billing_gmail(
    db: AsyncSession,
    to_email: str,
    subject: str,
    body_text: str = "",
    body_html: str = "",
    attachment_bytes: bytes = b"",
    attachment_name: str = "",
    thread_id: str = "",
    in_reply_to: str = "",
    references: str = "",
    reply_to_email: str = "",
    cc_emails: Optional[list[str]] = None,
    bcc_emails: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> Optional[dict]:
    conn = await get_billing_gmail_connection(db)
    if not conn or not conn.is_active or not conn.refresh_token:
        return None

    access_token = await get_valid_billing_access_token(db, conn)
    raw = _build_raw_message(
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        attachment_bytes=attachment_bytes,
        attachment_name=attachment_name,
        in_reply_to=in_reply_to,
        references=references,
        reply_to_email=reply_to_email,
        cc_emails=cc_emails,
        bcc_emails=bcc_emails,
        attachments=attachments,
    )
    payload = {"raw": raw}
    if thread_id:
        payload["threadId"] = thread_id

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GMAIL_SEND_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if response.status_code == 401:
        access_token = await _refresh_access_token(db, conn)
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GMAIL_SEND_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

    if response.status_code != 200:
        conn.last_error = response.text
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(f"Envoi Gmail échoué: {response.text}")

    result = response.json()
    message_id = (result.get("id") or "").strip()
    thread_id_value = (result.get("threadId") or "").strip()
    if not message_id:
        conn.last_error = "Reponse Gmail sans identifiant de message"
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(
            "Gmail a repondu sans identifiant de message. L'envoi n'a pas ete confirme."
        )

    async def _fetch_message_details(token: str):
        async with httpx.AsyncClient(timeout=30.0) as verify_client:
            return await verify_client.get(
                f"{GMAIL_MESSAGES_URL}/{message_id}",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "format": "metadata",
                    "metadataHeaders": ["To", "From", "Subject", "Date", "Message-ID"],
                },
            )

    verify_response = await _fetch_message_details(access_token)
    if verify_response.status_code == 401:
        access_token = await _refresh_access_token(db, conn)
        verify_response = await _fetch_message_details(access_token)

    if verify_response.status_code != 200:
        conn.last_error = (
            f"Message Gmail accepte mais verification impossible "
            f"(HTTP {verify_response.status_code}): {verify_response.text}"
        )
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(
            "Gmail a accepte le message, mais la verification dans la boite Envoyes a echoue."
        )

    verification = verify_response.json()
    label_ids = [str(label).strip().upper() for label in (verification.get("labelIds") or []) if str(label).strip()]
    payload_headers = ((verification.get("payload") or {}).get("headers") or [])
    verified_to = _header_value(payload_headers, "To")
    verified_subject = _header_value(payload_headers, "Subject")
    internet_message_id = _header_value(payload_headers, "Message-ID")

    normalized_recipients = {value.lower() for value in _normalize_recipient_list([verified_to])}
    expected_to = (to_email or "").strip().lower()
    if expected_to and expected_to not in normalized_recipients:
        conn.last_error = (
            f"Verification Gmail incoherente: destinataire attendu={to_email}, "
            f"trouve={verified_to}"
        )
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(
            "Le message Gmail a ete cree, mais le destinataire verifie ne correspond pas a la facture."
        )

    if "SENT" not in label_ids:
        conn.last_error = (
            f"Message Gmail {message_id} introuvable dans Envoyes. Labels detectes: {label_ids}"
        )
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(
            "Le message Gmail a ete accepte, mais aucune trace n'a ete confirmee dans les courriels envoyes."
        )

    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "transport": "gmail_oauth",
        "from_email": BILLING_SENDER_EMAIL,
        "account_email": conn.email,
        "message_id": message_id,
        "thread_id": thread_id_value or (verification.get("threadId") or ""),
        "internet_message_id": internet_message_id,
        "verified_to": verified_to,
        "verified_subject": verified_subject,
        "verified_labels": label_ids,
    }


async def create_billing_gmail_draft(
    db: AsyncSession,
    to_email: str,
    subject: str,
    body_text: str = "",
    body_html: str = "",
    thread_id: str = "",
    in_reply_to: str = "",
    references: str = "",
    reply_to_email: str = "",
    cc_emails: Optional[list[str]] = None,
    bcc_emails: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> Optional[dict]:
    conn = await get_billing_gmail_connection(db)
    if not conn or not conn.is_active or not conn.refresh_token:
        return None

    access_token = await get_valid_billing_access_token(db, conn)
    raw = _build_raw_message(
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        in_reply_to=in_reply_to,
        references=references,
        reply_to_email=reply_to_email,
        cc_emails=cc_emails,
        bcc_emails=bcc_emails,
        attachments=attachments,
    )
    payload = {"message": {"raw": raw}}
    if thread_id:
        payload["message"]["threadId"] = thread_id

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GMAIL_DRAFTS_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if response.status_code == 401:
        access_token = await _refresh_access_token(db, conn)
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GMAIL_DRAFTS_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

    if response.status_code == 403 and (
        "insufficient" in response.text.lower()
        or "permission" in response.text.lower()
        or "scope" in response.text.lower()
    ):
        conn.last_error = response.text
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(
            "La connexion Gmail actuelle n'a pas encore la permission de creer des brouillons. Clique 'Reconnecter Gmail' pour autoriser l'acces aux brouillons Gmail."
        )

    if response.status_code != 200:
        conn.last_error = response.text
        conn.updated_at = datetime.utcnow()
        await db.commit()
        raise RuntimeError(f"Creation du brouillon Gmail echouee: {response.text}")

    conn.last_error = ""
    conn.updated_at = datetime.utcnow()
    await db.commit()
    result = response.json()
    message = result.get("message") or {}
    return {
        "transport": "gmail_oauth",
        "from_email": BILLING_SENDER_EMAIL,
        "account_email": conn.email,
        "draft_id": result.get("id", ""),
        "message_id": message.get("id", ""),
        "thread_id": message.get("threadId", thread_id or ""),
    }
