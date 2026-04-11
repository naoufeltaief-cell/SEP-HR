"""Email service — SMTP via soins-expert-plus.com domain"""
import os
import smtplib
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from sqlalchemy.ext.asyncio import AsyncSession

from .billing_gmail_oauth import get_billing_gmail_connection, send_via_connected_billing_gmail

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = (
    os.getenv("SMTP_USER")
    or os.getenv("SMTP_USER_PAIE")
    or "paie@soins-expert-plus.com"
)
SMTP_PASS = os.getenv("SMTP_PASS") or os.getenv("SMTP_PASS_PAIE") or ""
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
BILLING_SENDER_EMAIL = os.getenv("BILLING_SENDER_EMAIL", os.getenv("GMAIL_SENDER_EMAIL", SMTP_USER))
BILLING_EMAIL_TRANSPORT = os.getenv("BILLING_EMAIL_TRANSPORT", "auto").lower()
AUTH_SENDER_EMAIL = os.getenv("AUTH_SENDER_EMAIL", "rh@soins-expert-plus.com").strip()
AUTH_SMTP_USER_RAW = os.getenv("AUTH_SMTP_USER")
AUTH_SMTP_PASS_RAW = os.getenv("AUTH_SMTP_PASS")
AUTH_SMTP_USER = AUTH_SMTP_USER_RAW or SMTP_USER
AUTH_SMTP_PASS = AUTH_SMTP_PASS_RAW or SMTP_PASS


async def _send_auth_email(
    db: AsyncSession | None,
    to: str,
    subject: str,
    html: str,
):
    if db is not None:
        try:
            connection = await get_billing_gmail_connection(db)
            if connection and connection.is_active and connection.refresh_token:
                return await send_via_connected_billing_gmail(
                    db=db,
                    to_email=to,
                    subject=subject,
                    body_html=html,
                    reply_to_email=AUTH_SENDER_EMAIL,
                )
        except Exception as gmail_exc:
            print(f"[AUTH EMAIL WARN] Gmail OAuth fallback to SMTP: {gmail_exc}")

    return await _send_email(
        to,
        subject,
        html,
        sender_email=AUTH_SENDER_EMAIL,
        smtp_user=AUTH_SMTP_USER,
        smtp_pass=AUTH_SMTP_PASS,
        reply_to_email=AUTH_SENDER_EMAIL,
    )


async def send_magic_link(email: str, token: str, name: str = "", db: AsyncSession | None = None):
    """Send magic link email for passwordless login"""
    link = f"{FRONTEND_URL}?magic_token={token}"
    subject = "Connexion — Soins Expert Plus"
    html = f"""
    <div style="font-family:system-ui;max-width:500px;margin:auto;padding:30px">
        <div style="text-align:center;margin-bottom:20px">
            <h2 style="color:#1d4ed8;margin:0">Soins Expert Plus</h2>
        </div>
        <p>Bonjour{' ' + name if name else ''},</p>
        <p>Cliquez sur le bouton ci-dessous pour vous connecter :</p>
        <div style="text-align:center;margin:30px 0">
            <a href="{link}" style="background:#1d4ed8;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">
                Se connecter
            </a>
        </div>
        <p style="font-size:13px;color:#6b7280">Ce lien expire dans 15 minutes. Si vous n'avez pas demandé cette connexion, ignorez ce courriel.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="font-size:11px;color:#9ca3af;text-align:center">Soins Expert Plus — 9437-7827 Québec Inc.</p>
    </div>
    """
    await _send_auth_email(db, email, subject, html)


async def send_welcome_email(email: str, name: str, db: AsyncSession | None = None):
    """Send welcome/onboarding email to new employee"""
    subject = "Bienvenue — Soins Expert Plus"
    html = f"""
    <div style="font-family:system-ui;max-width:500px;margin:auto;padding:30px">
        <h2 style="color:#1d4ed8">Bienvenue chez Soins Expert Plus!</h2>
        <p>Bonjour {name},</p>
        <p>Votre compte a été créé. Vous pouvez maintenant accéder au portail employé pour consulter vos horaires.</p>
        <div style="text-align:center;margin:30px 0">
            <a href="{FRONTEND_URL}" style="background:#1d4ed8;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">
                Accéder au portail
            </a>
        </div>
        <p style="font-size:13px;color:#6b7280">Si vous avez des questions, contactez-nous à rh@soins-expert-plus.com</p>
    </div>
    """
    await _send_auth_email(db, email, subject, html)


async def send_employee_portal_invitation(
    email: str,
    token: str,
    name: str = "",
    expires_hours: int = 72,
    db: AsyncSession | None = None,
):
    """Send employee portal invitation with a magic sign-in link."""
    link = f"{FRONTEND_URL}?magic_token={token}"
    subject = "Acces au portail employe — Soins Expert Plus"
    html = f"""
    <div style="font-family:system-ui;max-width:560px;margin:auto;padding:30px">
        <div style="text-align:center;margin-bottom:20px">
            <h2 style="color:#1d4ed8;margin:0">Soins Expert Plus</h2>
            <p style="color:#6b7280;margin-top:8px">Portail employe</p>
        </div>
        <p>Bonjour{' ' + name if name else ''},</p>
        <p>Votre acces au portail employe est pret. Vous pourrez y consulter votre horaire publie.</p>
        <div style="text-align:center;margin:30px 0">
            <a href="{link}" style="background:#1d4ed8;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">
                Acceder a mon portail
            </a>
        </div>
        <p style="font-size:13px;color:#6b7280">
            Ce lien de connexion est valide pendant {expires_hours} heure(s). Aucun mot de passe temporaire n'est envoye.
        </p>
        <p style="font-size:13px;color:#6b7280">
            Si le lien expire, vous pourrez toujours utiliser l'option de connexion par courriel sur la page d'accueil.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="font-size:11px;color:#9ca3af;text-align:center">Soins Expert Plus — 9437-7827 Quebec Inc.</p>
    </div>
    """
    await _send_auth_email(db, email, subject, html)


async def _send_email(
    to: str,
    subject: str,
    html: str,
    bcc_emails=None,
    sender_email: str | None = None,
    smtp_user: str | None = None,
    smtp_pass: str | None = None,
    reply_to_email: str | None = None,
    attachments: list[dict] | None = None,
):
    """Send an email via SMTP"""
    sender = (sender_email or BILLING_SENDER_EMAIL or SMTP_USER).strip()
    login_user = (smtp_user or SMTP_USER).strip()
    login_pass = smtp_pass if smtp_pass is not None else SMTP_PASS
    auth_sender_requested = bool(sender_email) and sender.lower() == AUTH_SENDER_EMAIL.lower()

    if auth_sender_requested and sender.lower() != login_user.lower() and not (AUTH_SMTP_USER_RAW and AUTH_SMTP_PASS_RAW):
        raise RuntimeError(
            f"Configuration SMTP manquante pour envoyer depuis {sender}. "
            f"Ajoutez AUTH_SMTP_USER et AUTH_SMTP_PASS pour cette boite courriel."
        )

    if not login_pass:
        raise RuntimeError(
            f"Aucun mot de passe SMTP configure pour l'envoi des courriels. "
            f"Expediteur: {sender}. Compte SMTP: {login_user or 'non configure'}."
        )

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = f"Soins Expert Plus <{sender}>"
    msg["To"] = to
    if reply_to_email:
        msg["Reply-To"] = reply_to_email.strip()
    body_part = MIMEMultipart("alternative")
    body_part.attach(MIMEText(html, "html"))
    msg.attach(body_part)
    for attachment in attachments or []:
        filename = (attachment.get("filename") or "document.bin").strip() or "document.bin"
        mime_type = (attachment.get("mime_type") or "application/octet-stream").strip()
        maintype, _, subtype = mime_type.partition("/")
        maintype = maintype or "application"
        subtype = subtype or "octet-stream"
        part = MIMEBase(maintype, subtype)
        part.set_payload(attachment.get("content") or b"")
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)
    recipients = [to]
    if bcc_emails:
        recipients.extend([email for email in bcc_emails if email])

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(login_user, login_pass)
            server.send_message(msg, to_addrs=recipients)
        print(f"[EMAIL OK] Sent to {to}: {subject}")
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to}: {e}")
        raise RuntimeError(
            f"Echec de l'envoi du courriel vers {to}. "
            f"Expediteur: {sender}. Compte SMTP: {login_user}. Erreur: {e}"
        ) from e


async def send_email_with_attachment(
    to_email: str,
    subject: str,
    body: str,
    attachment: bytes,
    attachment_name: str = "document.pdf"
):
    """Send email with PDF attachment — utilise Gmail API OAuth2 en priorité, SMTP en fallback"""
    # Essayer d'abord via Gmail API OAuth2
    try:
        if BILLING_EMAIL_TRANSPORT == "smtp":
            raise RuntimeError("SMTP preferred transport")
        from .gmail_service import _load_gmail_tokens
        import httpx
        import base64

        tokens = _load_gmail_tokens()
        access_token = tokens["access_token"]

        # Construire le message MIME avec le corps en texte
        from email.mime.text import MIMEText as _MIMEText
        from email.mime.multipart import MIMEMultipart as _MIMEMultipart
        from email.mime.application import MIMEApplication as _MIMEApplication

        msg = _MIMEMultipart("mixed")
        msg["From"] = f"Soins Expert Plus <{BILLING_SENDER_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(_MIMEText(body, "plain", "utf-8"))

        pdf_part = _MIMEApplication(attachment, _subtype="pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=attachment_name)
        msg.attach(pdf_part)

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={"raw": raw},
            )
            if response.status_code == 200:
                print(f"[GMAIL OK] Sent to {to_email}: {subject} with {attachment_name}")
                return {
                    "transport": "gmail_api",
                    "from_email": BILLING_SENDER_EMAIL,
                }
            else:
                print(f"[GMAIL WARN] Gmail API returned {response.status_code}, falling back to SMTP")
    except Exception as e:
        print(f"[GMAIL WARN] Gmail API failed ({e}), falling back to SMTP")

    # Fallback SMTP
    if not SMTP_PASS:
        print(f"[EMAIL SKIP] No SMTP_PASS set and Gmail API failed. Would send to {to_email}: {subject} with attachment {attachment_name}")
        raise RuntimeError("No SMTP_PASS configured and Gmail API delivery failed")

    msg = MIMEMultipart()
    msg["From"] = f"Soins Expert Plus <{BILLING_SENDER_EMAIL}>"
    msg["To"] = to_email
    msg["Subject"] = subject

    msg.attach(MIMEText(body, "plain"))

    pdf_attachment = MIMEApplication(attachment, _subtype="pdf")
    pdf_attachment.add_header("Content-Disposition", "attachment", filename=attachment_name)
    msg.attach(pdf_attachment)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print(f"[EMAIL OK] Sent to {to_email}: {subject} with {attachment_name}")
        return {
            "transport": "smtp",
            "from_email": BILLING_SENDER_EMAIL,
        }
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to_email}: {e}")
        raise


async def test_billing_email_connection(to_email: str):
    """Test the billing SMTP connection by sending a small email."""
    to_email = (to_email or "").strip()
    if not to_email:
        raise ValueError("Aucune adresse de destination pour le test")
    if not SMTP_USER:
        raise RuntimeError("SMTP_USER manquant")
    if not SMTP_PASS:
        raise RuntimeError("SMTP_PASS manquant")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Test courriel facturation - Soins Expert Plus"
    msg["From"] = f"Soins Expert Plus <{BILLING_SENDER_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(
        (
            "Ceci est un test de connexion SMTP pour la facturation.\n\n"
            f"Expediteur configure: {BILLING_SENDER_EMAIL}\n"
            f"Compte SMTP: {SMTP_USER}\n"
            f"Transport configure: {BILLING_EMAIL_TRANSPORT}\n"
            f"Date: {datetime.utcnow().isoformat()}Z"
        ),
        "plain",
        "utf-8",
    ))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)

    return {
        "ok": True,
        "smtp_host": SMTP_HOST,
        "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER,
        "sender_email": BILLING_SENDER_EMAIL,
        "transport": BILLING_EMAIL_TRANSPORT,
        "to_email": to_email,
    }
