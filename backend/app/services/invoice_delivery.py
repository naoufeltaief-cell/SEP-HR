from datetime import datetime
from html import escape
from typing import Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models import InvoiceAttachment
from ..models.models_invoice import AuditAction, Invoice, InvoiceAuditLog, InvoiceStatus
from .email_service import send_email_message
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
    pdf_bytes = pdf_buffer.getvalue()
    pdf_name = f"facture_{invoice.number}.pdf"
    attachments_result = await db.execute(
        select(InvoiceAttachment)
        .where(InvoiceAttachment.invoice_id == invoice.id)
        .order_by(InvoiceAttachment.created_at)
    )
    invoice_attachments = attachments_result.scalars().all()
    attachment_names = [
        item.original_filename or item.filename or "document"
        for item in invoice_attachments
    ]
    body_text = (
        "Bonjour,\n\n"
        f"Veuillez trouver ci-jointe la facture {invoice.number} pour la p\u00e9riode "
        f"du {invoice.period_start.isoformat()} au {invoice.period_end.isoformat()}.\n"
    )
    if attachment_names:
        body_text += (
            "\nPi\u00e8ces jointes incluses :\n- "
            + "\n- ".join(attachment_names)
            + "\n"
        )
    body_text += "\nMerci,\nSoins Expert Plus"
    attachment_list_html = ""
    if attachment_names:
        attachment_list_html = (
            "<p><strong>Pi\u00e8ces jointes incluses :</strong></p>"
            "<ul>"
            + "".join(f"<li>{escape(name)}</li>" for name in attachment_names)
            + "</ul>"
        )
    body_html = f"""
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;max-width:700px;margin:0 auto;padding:24px">
      <p>Bonjour,</p>
      <p>
        Veuillez trouver ci-joint la facture <strong>{escape(invoice.number)}</strong>
        pour la p\u00e9riode du <strong>{escape(invoice.period_start.isoformat())}</strong>
        au <strong>{escape(invoice.period_end.isoformat())}</strong>.
      </p>
      {attachment_list_html}
      <p>Merci,</p>
      <p>Soins Expert Plus</p>
    </div>
    """
    attachments = [
        {
            "filename": pdf_name,
            "mime_type": "application/pdf",
            "content": pdf_bytes,
        }
    ]
    for attachment in invoice_attachments:
        attachments.append(
            {
                "filename": attachment.original_filename or attachment.filename or "document",
                "mime_type": {
                    "pdf": "application/pdf",
                    "jpg": "image/jpeg",
                    "jpeg": "image/jpeg",
                    "png": "image/png",
                    "gif": "image/gif",
                    "txt": "text/plain",
                    "csv": "text/csv",
                    "doc": "application/msword",
                    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "xls": "application/vnd.ms-excel",
                    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                }.get(str(attachment.file_type or "").lower(), "application/octet-stream"),
                "content": attachment.file_data or b"",
            }
        )

    delivery = await send_email_message(
        to_email=invoice.client_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        attachments=attachments,
        db=db,
        prefer_billing_gmail=True,
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
            f"depuis {delivery.get('from_email', '')} "
            f"avec {len(attachments)} piece(s) jointe(s)"
        ),
    ))
    await db.commit()
    await db.refresh(invoice)
    return delivery
