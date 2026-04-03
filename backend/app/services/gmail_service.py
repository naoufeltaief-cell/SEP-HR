"""
Gmail API Service — Envoi de factures via Gmail OAuth2

Utilise les tokens OAuth2 stockés dans abacusai_auth_secrets.json
pour envoyer des courriels via l'API Gmail (REST) avec pièces jointes PDF
et corps HTML formaté.
"""

import os
import json
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# Chemin vers les tokens OAuth2 Abacus AI
AUTH_SECRETS_PATH = os.getenv(
    "GMAIL_AUTH_SECRETS_PATH",
    str(Path.home() / ".config" / "abacusai_auth_secrets.json"),
)

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Adresse d'expédition affichée
SENDER_NAME = "Soins Expert Plus"
SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "paie@soins-expert-plus.com")


def _load_gmail_tokens() -> dict:
    """Charge les tokens Gmail depuis le fichier de secrets."""
    try:
        with open(AUTH_SECRETS_PATH, "r") as f:
            secrets = json.load(f)
        gmail = secrets.get("gmailuser", {}).get("secrets", {})
        access_token = gmail.get("access_token", {}).get("value", "")
        if not access_token:
            raise ValueError("Aucun access_token Gmail trouvé dans les secrets")
        return {
            "access_token": access_token,
            "client_id": gmail.get("client_id", {}).get("value", ""),
        }
    except FileNotFoundError:
        raise RuntimeError(
            f"Fichier de secrets introuvable : {AUTH_SECRETS_PATH}. "
            "Assurez-vous que le compte Gmail est connecté via Abacus AI."
        )
    except (json.JSONDecodeError, KeyError) as e:
        raise RuntimeError(f"Erreur de lecture des secrets Gmail : {e}")


def _build_invoice_html_body(invoice) -> str:
    """Construit un corps HTML formaté pour la facture."""
    # Informations de base
    period = ""
    if getattr(invoice, "period_start", None) and getattr(invoice, "period_end", None):
        period = f"du {invoice.period_start} au {invoice.period_end}"

    # Lignes de service
    lines_html = ""
    for line in (getattr(invoice, "lines", None) or []):
        date_str = line.get("date", "")
        hours = line.get("hours", 0)
        rate = line.get("rate", 0)
        amount = line.get("service_amount", 0)
        garde_h = line.get("garde_hours", 0)
        garde_amt = line.get("garde_amount", 0)
        rappel_h = line.get("rappel_hours", 0)
        rappel_amt = line.get("rappel_amount", 0)
        lines_html += f"""
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee">{date_str}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">{hours:.2f}h</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">{rate:.2f}$/h</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">{amount:.2f}$</td>
        </tr>"""
        if garde_h and garde_h > 0:
            lines_html += f"""
        <tr style="color:#6C757D;font-size:12px">
            <td style="padding:4px 8px" colspan="2">&nbsp;&nbsp;↳ Garde: {garde_h:.1f}h</td>
            <td style="padding:4px 8px;text-align:right" colspan="2">{garde_amt:.2f}$</td>
        </tr>"""
        if rappel_h and rappel_h > 0:
            lines_html += f"""
        <tr style="color:#6C757D;font-size:12px">
            <td style="padding:4px 8px" colspan="2">&nbsp;&nbsp;↳ Rappel: {rappel_h:.1f}h</td>
            <td style="padding:4px 8px;text-align:right" colspan="2">{rappel_amt:.2f}$</td>
        </tr>"""

    # Lignes d'hébergement
    accom_html = ""
    accom_lines = getattr(invoice, "accommodation_lines", None) or []
    if accom_lines:
        accom_html = """
        <tr><td colspan="4" style="padding:12px 8px 4px;font-weight:600;color:#2A7B88;border-top:2px solid #2A7B88">Hébergement</td></tr>"""
        for al in accom_lines:
            days = al.get("days", 0)
            cpd = al.get("cost_per_day", 0)
            amt = al.get("amount", 0)
            accom_html += f"""
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee">{al.get('period', '')}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">{days} jours</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">{cpd:.2f}$/jour</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">{amt:.2f}$</td>
        </tr>"""

    # Lignes de frais
    expense_html = ""
    expense_lines = getattr(invoice, "expense_lines", None) or []
    if expense_lines:
        expense_html = """
        <tr><td colspan="4" style="padding:12px 8px 4px;font-weight:600;color:#2A7B88;border-top:2px solid #2A7B88">Frais</td></tr>"""
        for el in expense_lines:
            desc = el.get("description", "")
            amt = el.get("amount", 0)
            expense_html += f"""
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee" colspan="3">{desc}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">{amt:.2f}$</td>
        </tr>"""

    # Totaux
    subtotal = getattr(invoice, "subtotal", 0) or 0
    tps = getattr(invoice, "tps", 0) or 0
    tvq = getattr(invoice, "tvq", 0) or 0
    total = getattr(invoice, "total", 0) or 0
    include_tax = getattr(invoice, "include_tax", True)

    tax_section = ""
    if include_tax:
        tax_section = f"""
            <tr>
                <td style="padding:6px 0;text-align:right;color:#555">TPS (5%)</td>
                <td style="padding:6px 0;text-align:right;font-weight:500">{tps:.2f}$</td>
            </tr>
            <tr>
                <td style="padding:6px 0;text-align:right;color:#555">TVQ (9.975%)</td>
                <td style="padding:6px 0;text-align:right;font-weight:500">{tvq:.2f}$</td>
            </tr>"""

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:Arial,Helvetica,sans-serif;margin:0;padding:0;background:#f4f4f4">
        <div style="max-width:700px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
            <!-- En-tête -->
            <div style="background:#2A7B88;color:#fff;padding:30px">
                <h1 style="margin:0;font-size:24px">Soins Expert Plus</h1>
                <p style="margin:5px 0 0;font-size:14px;opacity:0.9">9437-7827 Québec Inc.</p>
            </div>

            <!-- Info facture -->
            <div style="padding:25px 30px;background:#E8F4F6;border-bottom:1px solid #d0e8ec">
                <table style="width:100%;border-collapse:collapse">
                    <tr>
                        <td style="vertical-align:top">
                            <div style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:1px">Facture</div>
                            <div style="font-size:20px;font-weight:700;color:#2A7B88">{getattr(invoice, 'number', '')}</div>
                            <div style="font-size:13px;color:#444;margin-top:4px">Période : {period}</div>
                        </td>
                        <td style="vertical-align:top;text-align:right">
                            <div style="font-size:12px;color:#555">Date : {getattr(invoice, 'date', '')}</div>
                            <div style="font-size:12px;color:#555">Échéance : {getattr(invoice, 'due_date', '') or 'Net 30'}</div>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Client -->
            <div style="padding:20px 30px;border-bottom:1px solid #eee">
                <div style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Facturé à</div>
                <div style="font-size:15px;font-weight:600;color:#333">{getattr(invoice, 'client_name', '')}</div>
                {f'<div style="font-size:13px;color:#555">{invoice.client_address}</div>' if getattr(invoice, 'client_address', '') else ''}
                {f'<div style="font-size:13px;color:#555">✉ {invoice.client_email}</div>' if getattr(invoice, 'client_email', '') else ''}
                {f'<div style="font-size:13px;color:#555">☎ {invoice.client_phone}</div>' if getattr(invoice, 'client_phone', '') else ''}
            </div>

            <!-- Employé -->
            <div style="padding:15px 30px;border-bottom:1px solid #eee;background:#fafafa">
                <span style="font-size:12px;color:#555">Professionnel : </span>
                <span style="font-size:14px;font-weight:600;color:#333">{getattr(invoice, 'employee_name', '')}</span>
                {f' — <span style="font-size:13px;color:#555">{invoice.employee_title}</span>' if getattr(invoice, 'employee_title', '') else ''}
            </div>

            <!-- Détail des services -->
            <div style="padding:20px 30px">
                <table style="width:100%;border-collapse:collapse">
                    <thead>
                        <tr style="background:#2A7B88;color:#fff">
                            <th style="padding:10px 8px;text-align:left;font-size:12px">Date</th>
                            <th style="padding:10px 8px;text-align:center;font-size:12px">Heures</th>
                            <th style="padding:10px 8px;text-align:right;font-size:12px">Taux</th>
                            <th style="padding:10px 8px;text-align:right;font-size:12px">Montant</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lines_html}
                        {accom_html}
                        {expense_html}
                    </tbody>
                </table>
            </div>

            <!-- Totaux -->
            <div style="padding:20px 30px;border-top:2px solid #2A7B88">
                <table style="width:300px;margin-left:auto;border-collapse:collapse">
                    <tr>
                        <td style="padding:6px 0;text-align:right;color:#555">Sous-total</td>
                        <td style="padding:6px 0;text-align:right;font-weight:500">{subtotal:.2f}$</td>
                    </tr>
                    {tax_section}
                    <tr style="border-top:2px solid #2A7B88">
                        <td style="padding:10px 0;text-align:right;font-weight:700;font-size:16px;color:#2A7B88">TOTAL</td>
                        <td style="padding:10px 0;text-align:right;font-weight:700;font-size:16px;color:#2A7B88">{total:.2f}$</td>
                    </tr>
                </table>
            </div>

            <!-- Pied de page -->
            <div style="padding:20px 30px;background:#f8f9fa;border-top:1px solid #eee;text-align:center;font-size:11px;color:#888">
                <p style="margin:0">Soins Expert Plus — 9437-7827 Québec Inc.</p>
                <p style="margin:4px 0 0">paie@soins-expert-plus.com</p>
            </div>
        </div>
    </body>
    </html>
    """
    return html


def _build_mime_message(
    to_email: str,
    subject: str,
    html_body: str,
    pdf_bytes: bytes,
    pdf_filename: str,
) -> str:
    """Construit un message MIME encodé en base64url pour l'API Gmail."""
    msg = MIMEMultipart("mixed")
    msg["From"] = f"{SENDER_NAME} <{SENDER_EMAIL}>"
    msg["To"] = to_email
    msg["Subject"] = subject

    # Corps HTML
    html_part = MIMEText(html_body, "html", "utf-8")
    msg.attach(html_part)

    # Pièce jointe PDF
    pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf_part.add_header("Content-Disposition", "attachment", filename=pdf_filename)
    msg.attach(pdf_part)

    # Encoder en base64url (format requis par l'API Gmail)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    return raw


async def send_invoice_via_gmail(
    to_email: str,
    invoice,
    pdf_bytes: bytes,
    pdf_filename: str = "facture.pdf",
) -> dict:
    """
    Envoie une facture par courriel via l'API Gmail.

    - Corps HTML formaté avec le détail de la facture
    - PDF attaché en pièce jointe

    Args:
        to_email: adresse du destinataire
        invoice: objet Invoice (SQLAlchemy)
        pdf_bytes: contenu du PDF en bytes
        pdf_filename: nom du fichier PDF attaché

    Returns:
        dict avec le résultat de l'envoi
    """
    tokens = _load_gmail_tokens()
    access_token = tokens["access_token"]

    # Construire le sujet
    period = ""
    if getattr(invoice, "period_start", None) and getattr(invoice, "period_end", None):
        period = f" — {invoice.period_start} au {invoice.period_end}"
    subject = f"Facture {getattr(invoice, 'number', '')}{period} — Soins Expert Plus"

    # Construire le corps HTML
    html_body = _build_invoice_html_body(invoice)

    # Construire le message MIME
    raw_message = _build_mime_message(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        pdf_bytes=pdf_bytes,
        pdf_filename=pdf_filename,
    )

    # Envoyer via l'API Gmail
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GMAIL_SEND_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"raw": raw_message},
        )

        if response.status_code == 401:
            logger.error("Token Gmail expiré ou invalide. Veuillez reconnecter le compte Gmail.")
            raise RuntimeError(
                "Token Gmail expiré. Veuillez reconnecter le compte Gmail via Abacus AI."
            )

        if response.status_code != 200:
            error_detail = response.text
            logger.error(f"Erreur API Gmail ({response.status_code}): {error_detail}")
            raise RuntimeError(
                f"Erreur envoi Gmail (HTTP {response.status_code}): {error_detail}"
            )

        result = response.json()
        logger.info(
            f"[GMAIL OK] Facture {getattr(invoice, 'number', '?')} envoyée à {to_email} "
            f"(message_id={result.get('id', '?')})"
        )
        return result
