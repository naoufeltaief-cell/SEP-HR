import logging
from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..services.auth_service import require_admin
from ..models.models import InvoiceAttachment
from ..models.models_invoice import (
    Invoice, CreditNote, InvoiceAuditLog, InvoiceStatus, AuditAction
)
from ..services.invoice_delivery import email_invoice_and_mark_sent
from ..services.invoice_service import change_invoice_status

router = APIRouter()
logger = logging.getLogger(__name__)

# Statuses that allow deletion
DELETABLE_STATUSES = (InvoiceStatus.DRAFT.value, InvoiceStatus.VALIDATED.value, InvoiceStatus.CANCELLED.value)


@router.post('/bulk/delete')
@router.post('/bulk-delete')
async def bulk_delete_invoices(invoice_ids: List[str], db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Delete multiple invoices (draft, validated, or cancelled)."""
    deleted, skipped = [], []
    for invoice_id in invoice_ids:
        result = await db.execute(select(Invoice).options(selectinload(Invoice.payments), selectinload(Invoice.audit_logs), selectinload(Invoice.credit_notes)).where(Invoice.id == invoice_id))
        invoice = result.scalar_one_or_none()
        if not invoice:
            skipped.append({'id': invoice_id, 'reason': 'Not found'})
            continue
        if invoice.status not in DELETABLE_STATUSES:
            skipped.append({'id': invoice_id, 'number': invoice.number, 'reason': 'Seules les factures brouillon, validées ou annulées peuvent être supprimées'})
            continue
        logger.info(f"Bulk deleting invoice {invoice.number} (status={invoice.status}) by user={getattr(user, 'email', 'unknown')}")
        att_result = await db.execute(select(InvoiceAttachment).where(InvoiceAttachment.invoice_id == invoice.id))
        for att in att_result.scalars().all():
            await db.delete(att)
        for payment in list(invoice.payments or []):
            await db.delete(payment)
        for audit in list(invoice.audit_logs or []):
            await db.delete(audit)
        for credit_note in list(invoice.credit_notes or []):
            await db.delete(credit_note)
        deleted.append({'id': invoice.id, 'number': invoice.number})
        await db.delete(invoice)
    await db.commit()
    return {'deleted': deleted, 'skipped': skipped, 'count': len(deleted)}


@router.post('/credit-notes/bulk-delete')
async def bulk_delete_credit_notes(credit_note_ids: List[str], db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    deleted, skipped = [], []
    for credit_note_id in credit_note_ids:
        result = await db.execute(select(CreditNote).where(CreditNote.id == credit_note_id))
        credit_note = result.scalar_one_or_none()
        if not credit_note:
            skipped.append({'id': credit_note_id, 'reason': 'Not found'})
            continue
        deleted.append({'id': credit_note.id, 'number': credit_note.number})
        await db.delete(credit_note)
    await db.commit()
    return {'deleted': deleted, 'skipped': skipped, 'count': len(deleted)}


@router.post('/bulk/validate')
async def bulk_validate_invoices(invoice_ids: List[str], db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Validate multiple draft invoices at once."""
    validated, skipped = [], []
    for invoice_id in invoice_ids:
        result = await db.execute(
            select(Invoice).options(
                selectinload(Invoice.payments),
                selectinload(Invoice.audit_logs),
                selectinload(Invoice.credit_notes),
            ).where(Invoice.id == invoice_id)
        )
        invoice = result.scalar_one_or_none()
        if not invoice:
            skipped.append({'id': invoice_id, 'reason': 'Not found'})
            continue
        if invoice.status != InvoiceStatus.DRAFT.value:
            skipped.append({'id': invoice_id, 'number': invoice.number, 'reason': f'Status is {invoice.status}, must be draft'})
            continue
        try:
            await change_invoice_status(db, invoice, InvoiceStatus.VALIDATED.value, getattr(user, 'email', ''))
            validated.append({'id': invoice.id, 'number': invoice.number})
        except Exception as e:
            skipped.append({'id': invoice_id, 'number': getattr(invoice, 'number', '?'), 'reason': str(e)})
    return {'validated': validated, 'skipped': skipped, 'count': len(validated)}


@router.post('/bulk/send')
async def bulk_send_invoices(invoice_ids: List[str], db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Email multiple invoices and only mark them sent after delivery."""
    sent, skipped = [], []
    for invoice_id in invoice_ids:
        result = await db.execute(
            select(Invoice).options(
                selectinload(Invoice.payments),
                selectinload(Invoice.audit_logs),
                selectinload(Invoice.credit_notes),
            ).where(Invoice.id == invoice_id)
        )
        invoice = result.scalar_one_or_none()
        if not invoice:
            skipped.append({'id': invoice_id, 'reason': 'Not found'})
            continue
        try:
            if invoice.status not in (InvoiceStatus.DRAFT.value, InvoiceStatus.VALIDATED.value):
                skipped.append({'id': invoice_id, 'number': getattr(invoice, 'number', '?'), 'reason': f'Status {invoice.status} cannot be sent'})
                continue
            delivery = await email_invoice_and_mark_sent(db, invoice, getattr(user, 'email', ''))
            sent.append({'id': invoice.id, 'number': invoice.number, 'transport': delivery.get('transport', 'unknown')})
        except Exception as e:
            skipped.append({'id': invoice_id, 'number': getattr(invoice, 'number', '?'), 'reason': str(e)})
    return {'sent': sent, 'skipped': skipped, 'count': len(sent)}


@router.post('/anomalies/bulk-delete')
async def bulk_delete_anomaly_invoices(invoice_ids: List[str], db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Delete invoices linked to anomalies (must be draft/validated/cancelled)."""
    return await bulk_delete_invoices(invoice_ids, db, user)
