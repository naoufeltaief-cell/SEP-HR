from datetime import datetime
from typing import Dict

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models_invoice import AuditAction, Invoice, InvoiceAuditLog, InvoiceStatus
from .billing_gmail_oauth import send_via_connected_billing_gmail
from .email_service import send_email_with_attachment
from .invoice_pdf import generate_invoice_pdf


async def email_invoice_and_mark_sent(
    db: AsyncSession,
    invoice: Invoice,
    user_email: str = "",
) -> Dict[str, str]:
    """Email an invoice and update status only after successful delivery."""
    if invoice.status not in (
        InvoiceStatus.DRAFT.value,
        InvoiceStatus.VALIDATED.value,
        InvoiceStatus.SENT.value,
    ):
        raise ValueError(f"Status {invoice.status} cannot be emailed")
    if not invoice.client_email:
        raise ValueError("Le client n'a pas d'adresse courriel")

    pdf_buffer = generate_invoice_pdf(invoice)
    subject = f"Facture {invoice.number} - Soins Expert Plus"
    body = (
        "Bonjour,\n\n"
        f"Veuillez trouver ci-jointe la facture {invoice.number}.\n\n"
        "Merci,\n"
        "Soins Expert Plus"
    )
    pdf_bytes = pdf_buffer.getvalue()
    pdf_name = f"facture_{invoice.number}.pdf"

    delivery = await send_via_connected_billing_gmail(
        db,
        to_email=invoice.client_email,
        subject=subject,
        body_text=body,
        attachment_bytes=pdf_bytes,
        attachment_name=pdf_name,
    )
    if not delivery:
        delivery = await send_email_with_attachment(
            to_email=invoice.client_email,
            subject=subject,
            body=body,
            attachment=pdf_bytes,
            attachment_name=pdf_name,
        )

    if invoice.status == InvoiceStatus.DRAFT.value:
        invoice.status = InvoiceStatus.VALIDATED.value
        invoice.validated_at = datetime.utcnow()
    if invoice.status in (InvoiceStatus.DRAFT.value, InvoiceStatus.VALIDATED.value):
        invoice.status = InvoiceStatus.SENT.value
        invoice.sent_at = datetime.utcnow()

    db.add(InvoiceAuditLog(
        invoice_id=invoice.id,
        action=AuditAction.EMAILED.value,
        user_email=user_email,
        details=(
            f"Envoye a {invoice.client_email} via {delivery.get('transport', 'unknown')} "
            f"depuis {delivery.get('from_email', '')}"
        ),
    ))
    await db.commit()
    await db.refresh(invoice)
    return delivery
