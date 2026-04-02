from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.auth_service import require_admin
from ..models.models_invoice import Invoice, CreditNote, InvoiceStatus

router = APIRouter()


@router.post('/bulk-delete')
async def bulk_delete_invoices(
    invoice_ids: List[str],
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    deleted, skipped = [], []
    for invoice_id in invoice_ids:
        result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
        invoice = result.scalar_one_or_none()
        if not invoice:
            skipped.append({'id': invoice_id, 'reason': 'Not found'})
            continue
        if invoice.status not in (InvoiceStatus.DRAFT.value, InvoiceStatus.CANCELLED.value):
            skipped.append({'id': invoice_id, 'number': invoice.number, 'reason': 'Seules les factures brouillon/annulées peuvent être supprimées'})
            continue
        deleted.append({'id': invoice.id, 'number': invoice.number})
        await db.delete(invoice)
    await db.commit()
    return {'deleted': deleted, 'skipped': skipped, 'count': len(deleted)}


@router.post('/credit-notes/bulk-delete')
async def bulk_delete_credit_notes(
    credit_note_ids: List[str],
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
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
