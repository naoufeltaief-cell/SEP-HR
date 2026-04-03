"""Email service — SMTP via soins-expert-plus.com domain"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "rh@soins-expert-plus.com")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


async def send_magic_link(email: str, token: str, name: str = ""):
    """Send magic link email for passwordless login"""
    link = f"{FRONTEND_URL}/auth/magic?token={token}"
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
    await _send_email(email, subject, html)


async def send_welcome_email(email: str, name: str):
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
    await _send_email(email, subject, html)


async def _send_email(to: str, subject: str, html: str):
    """Send an email via SMTP"""
    if not SMTP_PASS:
        print(f"[EMAIL SKIP] No SMTP_PASS set. Would send to {to}: {subject}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Soins Expert Plus <{SMTP_USER}>"
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print(f"[EMAIL OK] Sent to {to}: {subject}")
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to}: {e}")


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
        from .gmail_service import send_invoice_via_gmail, _load_gmail_tokens, _build_mime_message
        import httpx
        import base64

        tokens = _load_gmail_tokens()
        access_token = tokens["access_token"]

        # Construire le message MIME avec le corps en texte
        from email.mime.text import MIMEText as _MIMEText
        from email.mime.multipart import MIMEMultipart as _MIMEMultipart
        from email.mime.application import MIMEApplication as _MIMEApplication

        msg = _MIMEMultipart("mixed")
        msg["From"] = f"Soins Expert Plus <paie@soins-expert-plus.com>"
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
                return
            else:
                print(f"[GMAIL WARN] Gmail API returned {response.status_code}, falling back to SMTP")
    except Exception as e:
        print(f"[GMAIL WARN] Gmail API failed ({e}), falling back to SMTP")

    # Fallback SMTP
    if not SMTP_PASS:
        print(f"[EMAIL SKIP] No SMTP_PASS set and Gmail API failed. Would send to {to_email}: {subject} with attachment {attachment_name}")
        return

    msg = MIMEMultipart()
    msg["From"] = f"Soins Expert Plus <{SMTP_USER}>"
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
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to_email}: {e}")
        raise
