"""
Soins Expert Plus — Invoice Router (Phase 1 Complete Rewrite)
All endpoints for invoicing, payments, credit notes, reports, anomalies, PDF.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, extract, desc
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import date, datetime, timedelta
import uuid
import io

from ..database import get_db
from ..services.auth_service import require_admin
from ..models.models import Client, Employee, InvoiceAttachment
from ..models.models_invoice import (
    Invoice, Payment, InvoiceAuditLog, CreditNote,
    InvoiceStatus, AuditAction
)
from ..models.schemas_invoice import (
    InvoiceCreate, InvoiceUpdate, InvoiceGenerateRequest,
    InvoiceStatusChange, InvoiceResponse, InvoiceListResponse,
    PaymentCreate, PaymentResponse,
    CreditNoteCreate, CreditNoteResponse,
    AnomalyItem
)
from ..services.invoice_service import (
    generate_invoice_number, generate_credit_note_number,
    recalculate_invoice, calculate_taxes, is_tax_exempt,
    generate_invoices_from_timesheets, change_invoice_status,
    add_payment, delete_payment, detect_anomalies,
    duplicate_invoice, get_client_invoice_summary,
    COMPANY_INFO
)
from ..services.invoice_pdf import generate_invoice_pdf, generate_credit_note_pdf

router = APIRouter()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# INVOICE CRUD
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.get("/")
async def list_invoices(
    status: Optional[str] = None,
    client_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """List invoices with optional filters"""
    query = select(Invoice).order_by(desc(Invoice.date), desc(Invoice.created_at))

    if status:
        query = query.where(Invoice.status == status)
    if client_id:
        query = query.where(Invoice.client_id == client_id)
    if employee_id:
        query = query.where(Invoice.employee_id == employee_id)
    if period_start:
        query = query.where(Invoice.period_start >= period_start)
    if period_end:
        query = query.where(Invoice.period_end <= period_end)
    if search:
        s = f"%{search}%"
        query = query.where(
            or_(
                Invoice.number.ilike(s),
                Invoice.client_name.ilike(s),
                Invoice.employee_name.ilike(s),
            )
        )

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/stats")
async def invoice_stats(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Dashboard stats"""
    result = await db.execute(
        select(Invoice).where(Invoice.status != InvoiceStatus.CANCELLED.value)
    )
    invoices = result.scalars().all()

    total_invoiced = sum(inv.total for inv in invoices)
    total_paid = sum(inv.amount_paid for inv in invoices)
    total_outstanding = sum(inv.balance_due for inv in invoices)
    today = date.today()
    total_overdue = sum(
        inv.balance_due for inv in invoices
        if inv.balance_due > 0 and inv.due_date and inv.due_date < today
    )

    status_counts = {}
    for inv in invoices:
        status_counts[inv.status] = status_counts.get(inv.status, 0) + 1

    return {
        "total_invoiced": round(total_invoiced, 2),
        "total_paid": round(total_paid, 2),
        "total_outstanding": round(total_outstanding, 2),
        "total_overdue": round(total_overdue, 2),
        "count": len(invoices),
        "status_counts": status_counts,
    }


@router.get("/next-number")
async def next_invoice_number(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Get next invoice number (backward compat)"""
    number = await generate_invoice_number(db)
    return {"number": number}


@router.get("/anomalies/check")
async def check_anomalies(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Run anomaly detection on all active invoices"""
    return await detect_anomalies(db)


@router.get("/credit-notes/all")
async def list_credit_notes(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(CreditNote).order_by(desc(CreditNote.date)))
    return result.scalars().all()


@router.get("/reports/by-client")
async def report_by_client(
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Revenue report grouped by client"""
    query = select(Invoice).where(Invoice.status != InvoiceStatus.CANCELLED.value)
    if period_start:
        query = query.where(Invoice.period_start >= period_start)
    if period_end:
        query = query.where(Invoice.period_end <= period_end)

    result = await db.execute(query)
    invoices = result.scalars().all()

    clients = {}
    for inv in invoices:
        cid = inv.client_id or 0
        if cid not in clients:
            clients[cid] = {
                "client_id": cid,
                "client_name": inv.client_name,
                "total_invoiced": 0, "total_paid": 0,
                "total_outstanding": 0, "total_overdue": 0,
                "invoice_count": 0, "invoices": [],
            }
        c = clients[cid]
        c["total_invoiced"] += inv.total
        c["total_paid"] += inv.amount_paid
        c["total_outstanding"] += inv.balance_due
        if inv.balance_due > 0 and inv.due_date and inv.due_date < date.today():
            c["total_overdue"] += inv.balance_due
        c["invoice_count"] += 1
        c["invoices"].append({
            "id": inv.id, "number": inv.number,
            "date": inv.date.isoformat() if inv.date else "",
            "employee_name": inv.employee_name,
            "total": inv.total, "amount_paid": inv.amount_paid,
            "balance_due": inv.balance_due, "status": inv.status,
        })

    for c in clients.values():
        for k in ["total_invoiced", "total_paid", "total_outstanding", "total_overdue"]:
            c[k] = round(c[k], 2)

    return sorted(clients.values(), key=lambda x: x["total_invoiced"], reverse=True)


@router.get("/reports/by-period")
async def report_by_period(
    year: int = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Monthly revenue breakdown"""
    if not year:
        year = date.today().year

    query = select(Invoice).where(
        and_(
            Invoice.status != InvoiceStatus.CANCELLED.value,
            extract("year", Invoice.date) == year,
        )
    )
    result = await db.execute(query)
    invoices = result.scalars().all()

    months = {}
    for inv in invoices:
        month_key = inv.date.strftime("%Y-%m") if inv.date else "unknown"
        if month_key not in months:
            months[month_key] = {
                "period": month_key,
                "services": 0, "garde": 0, "rappel": 0,
                "accommodation": 0, "expenses": 0,
                "subtotal": 0, "taxes": 0, "total": 0,
            }
        m = months[month_key]
        m["services"] += inv.subtotal_services
        m["garde"] += inv.subtotal_garde
        m["rappel"] += inv.subtotal_rappel
        m["accommodation"] += inv.subtotal_accom
        m["expenses"] += (inv.subtotal_deplacement + inv.subtotal_km + inv.subtotal_autres_frais)
        m["subtotal"] += inv.subtotal
        m["taxes"] += (inv.tps + inv.tvq)
        m["total"] += inv.total

    for m in months.values():
        for k in m:
            if isinstance(m[k], float):
                m[k] = round(m[k], 2)

    return sorted(months.values(), key=lambda x: x["period"])


@router.get("/reports/by-employee")
async def report_by_employee(
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Revenue report grouped by employee"""
    query = select(Invoice).where(Invoice.status != InvoiceStatus.CANCELLED.value)
    if period_start:
        query = query.where(Invoice.period_start >= period_start)
    if period_end:
        query = query.where(Invoice.period_end <= period_end)

    result = await db.execute(query)
    invoices = result.scalars().all()

    employees = {}
    for inv in invoices:
        eid = inv.employee_id or 0
        if eid not in employees:
            employees[eid] = {
                "employee_id": eid, "employee_name": inv.employee_name,
                "employee_title": inv.employee_title,
                "total_invoiced": 0, "total_hours": 0,
                "invoice_count": 0, "invoices": [],
            }
        e = employees[eid]
        e["total_invoiced"] += inv.total
        e["total_hours"] += sum(l.get("hours", 0) for l in (inv.lines or []))
        e["invoice_count"] += 1
        e["invoices"].append({
            "id": inv.id, "number": inv.number,
            "client_name": inv.client_name, "total": inv.total,
            "status": inv.status,
            "period": f"{inv.period_start} → {inv.period_end}",
        })

    for e in employees.values():
        e["total_invoiced"] = round(e["total_invoiced"], 2)
        e["total_hours"] = round(e["total_hours"], 2)

    return sorted(employees.values(), key=lambda x: x["total_invoiced"], reverse=True)


@router.get("/reports/client/{client_id}")
async def client_detail_report(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Detailed client view"""
    summary = await get_client_invoice_summary(db, client_id)
    inv_list = []
    for inv in summary["invoices"]:
        inv_list.append({
            "id": inv.id, "number": inv.number,
            "date": inv.date.isoformat() if inv.date else "",
            "period_start": inv.period_start.isoformat() if inv.period_start else "",
            "period_end": inv.period_end.isoformat() if inv.period_end else "",
            "employee_name": inv.employee_name, "employee_title": inv.employee_title,
            "total": inv.total, "amount_paid": inv.amount_paid,
            "balance_due": inv.balance_due, "status": inv.status,
            "payments": [
                {"id": p.id, "amount": p.amount, "date": p.date.isoformat() if p.date else "", "reference": p.reference, "method": p.method}
                for p in (inv.payments or [])
            ],
        })
    summary["invoices"] = inv_list
    return summary


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SINGLE INVOICE (after all fixed paths above!)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.get("/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Get full invoice with payments, audit logs, credit notes"""
    result = await db.execute(
        select(Invoice)
        .options(
            selectinload(Invoice.payments),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.credit_notes),
        )
        .where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    return invoice


@router.post("/", status_code=201)
async def create_invoice(
    data: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Create a single invoice manually"""
    client_name = "Non assigné"
    client_address = client_email = client_phone = ""
    if data.client_id:
        cr = await db.execute(select(Client).where(Client.id == data.client_id))
        client = cr.scalar_one_or_none()
        if client:
            client_name = client.name
            client_address = getattr(client, "address", "")
            client_email = getattr(client, "email", "")
            client_phone = getattr(client, "phone", "")

    employee_name = employee_title = ""
    if data.employee_id:
        er = await db.execute(select(Employee).where(Employee.id == data.employee_id))
        emp = er.scalar_one_or_none()
        if emp:
            employee_name = emp.name or ""
            employee_title = getattr(emp, "position", "") or ""

    include_tax = data.include_tax and not is_tax_exempt(client_name)
    number = await generate_invoice_number(db)

    invoice = Invoice(
        number=number, date=date.today(),
        period_start=data.period_start, period_end=data.period_end,
        client_id=data.client_id, client_name=client_name,
        client_address=client_address, client_email=client_email, client_phone=client_phone,
        employee_id=data.employee_id, employee_name=employee_name, employee_title=employee_title,
        include_tax=include_tax, status=InvoiceStatus.DRAFT.value,
        lines=[l.model_dump() for l in data.lines],
        accommodation_lines=[l.model_dump() for l in data.accommodation_lines],
        expense_lines=[l.model_dump() for l in data.expense_lines],
        extra_lines=[l.model_dump() for l in data.extra_lines],
        notes=data.notes, po_number=data.po_number, due_date=data.due_date,
    )
    invoice = recalculate_invoice(invoice)
    db.add(invoice)

    audit = InvoiceAuditLog(
        invoice_id=invoice.id, action=AuditAction.CREATED.value,
        new_status=InvoiceStatus.DRAFT.value,
        user_email=getattr(user, "email", ""), details="Manual creation",
    )
    db.add(audit)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.put("/{invoice_id}")
async def update_invoice(
    invoice_id: str,
    data: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Update invoice (only if draft)"""
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != InvoiceStatus.DRAFT.value:
        raise HTTPException(400, "Can only edit draft invoices")

    update_data = data.model_dump(exclude_unset=True)

    if "client_id" in update_data and update_data["client_id"]:
        cr = await db.execute(select(Client).where(Client.id == update_data["client_id"]))
        client = cr.scalar_one_or_none()
        if client:
            invoice.client_id = client.id
            invoice.client_name = client.name
            invoice.client_address = getattr(client, "address", "")
            invoice.client_email = getattr(client, "email", "")
            invoice.client_phone = getattr(client, "phone", "")
            invoice.include_tax = not is_tax_exempt(client.name)

    if "employee_id" in update_data and update_data["employee_id"]:
        er = await db.execute(select(Employee).where(Employee.id == update_data["employee_id"]))
        emp = er.scalar_one_or_none()
        if emp:
            invoice.employee_id = emp.id
            invoice.employee_name = emp.name or ""
            invoice.employee_title = getattr(emp, "position", "") or ""

    for field in ["include_tax", "notes", "po_number", "due_date"]:
        if field in update_data:
            setattr(invoice, field, update_data[field])

    if "lines" in update_data and update_data["lines"] is not None:
        invoice.lines = [l.model_dump() if hasattr(l, "model_dump") else l for l in update_data["lines"]]
    if "accommodation_lines" in update_data and update_data["accommodation_lines"] is not None:
        invoice.accommodation_lines = [l.model_dump() if hasattr(l, "model_dump") else l for l in update_data["accommodation_lines"]]
    if "expense_lines" in update_data and update_data["expense_lines"] is not None:
        invoice.expense_lines = [l.model_dump() if hasattr(l, "model_dump") else l for l in update_data["expense_lines"]]
    if "extra_lines" in update_data and update_data["extra_lines"] is not None:
        invoice.extra_lines = [l.model_dump() if hasattr(l, "model_dump") else l for l in update_data["extra_lines"]]

    invoice = recalculate_invoice(invoice)

    audit = InvoiceAuditLog(
        invoice_id=invoice.id, action=AuditAction.UPDATED.value,
        user_email=getattr(user, "email", ""),
        details=f"Fields updated: {', '.join(update_data.keys())}",
    )
    db.add(audit)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}")
async def delete_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Delete invoice (only if draft)"""
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != InvoiceStatus.DRAFT.value:
        raise HTTPException(400, "Can only delete draft invoices")
    await db.delete(invoice)
    await db.commit()
    return {"message": f"Facture {invoice.number} supprimée"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GENERATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/generate")
async def generate_invoices(
    data: InvoiceGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Generate draft invoices from timesheets (1 per employee per client)"""
    invoices = await generate_invoices_from_timesheets(
        db=db, period_start=data.period_start, period_end=data.period_end,
        client_id=data.client_id, user_email=getattr(user, "email", ""),
    )
    return invoices


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STATUS WORKFLOW
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/{invoice_id}/status")
async def update_status(
    invoice_id: str,
    data: InvoiceStatusChange,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(
            selectinload(Invoice.payments),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.credit_notes),
        ).where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    try:
        invoice = await change_invoice_status(
            db, invoice, data.new_status.value,
            getattr(user, "email", ""), data.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return invoice


@router.post("/{invoice_id}/validate")
async def validate_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(
            selectinload(Invoice.payments),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.credit_notes),
        ).where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    try:
        return await change_invoice_status(
            db, invoice, InvoiceStatus.VALIDATED.value,
            getattr(user, "email", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{invoice_id}/send")
async def send_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(
            selectinload(Invoice.payments),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.credit_notes),
        ).where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status == InvoiceStatus.DRAFT.value:
        invoice = await change_invoice_status(
            db, invoice, InvoiceStatus.VALIDATED.value,
            getattr(user, "email", ""),
        )
    try:
        invoice = await change_invoice_status(
            db, invoice, InvoiceStatus.SENT.value,
            getattr(user, "email", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return invoice


@router.post("/{invoice_id}/mark-paid")
async def mark_paid(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(
            selectinload(Invoice.payments),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.credit_notes),
        ).where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.balance_due > 0:
        await add_payment(
            db=db, invoice=invoice,
            amount=invoice.balance_due,
            payment_date=date.today(),
            reference="Full payment",
            user_email=getattr(user, "email", ""),
        )
    await db.refresh(invoice)
    return invoice


# Backward compat: PUT /paid and /unpaid and /cancel
@router.put("/{invoice_id}/paid")
async def mark_paid_compat(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    return await mark_paid(invoice_id, db, user)


@router.put("/{invoice_id}/unpaid")
async def mark_unpaid(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Facture introuvable")
    inv.status = "sent"
    await db.commit()
    return {"message": "Facture marquée impayée"}


@router.put("/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Facture introuvable")
    inv.status = "cancelled"
    await db.commit()
    return {"message": f"Facture {inv.number} annulée"}


@router.post("/{invoice_id}/duplicate")
async def duplicate_invoice_endpoint(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    new_inv = await duplicate_invoice(db, invoice, getattr(user, "email", ""))
    return new_inv


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PAYMENTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/{invoice_id}/payments")
async def create_payment(
    invoice_id: str,
    data: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(selectinload(Invoice.payments))
        .where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status in (InvoiceStatus.DRAFT.value, InvoiceStatus.CANCELLED.value):
        raise HTTPException(400, "Cannot add payment to draft or cancelled invoice")
    try:
        payment = await add_payment(
            db=db, invoice=invoice,
            amount=data.amount, payment_date=data.date,
            reference=data.reference, method=data.method.value,
            notes=data.notes, user_email=getattr(user, "email", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return payment


@router.get("/{invoice_id}/payments")
async def list_payments(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Payment).where(Payment.invoice_id == invoice_id)
        .order_by(desc(Payment.date))
    )
    return result.scalars().all()


@router.delete("/{invoice_id}/payments/{payment_id}")
async def remove_payment(
    invoice_id: str,
    payment_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(Invoice).options(selectinload(Invoice.payments))
        .where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    try:
        await delete_payment(db, invoice, payment_id, getattr(user, "email", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"message": "Payment deleted"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CREDIT NOTES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/credit-notes")
async def create_credit_note(
    data: CreditNoteCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    client_name = ""
    invoice_number = ""

    if data.invoice_id:
        inv_r = await db.execute(select(Invoice).where(Invoice.id == data.invoice_id))
        inv = inv_r.scalar_one_or_none()
        if inv:
            client_name = inv.client_name
            invoice_number = inv.number
            if not data.client_id:
                data.client_id = inv.client_id

    if data.client_id and not client_name:
        cr = await db.execute(select(Client).where(Client.id == data.client_id))
        cl = cr.scalar_one_or_none()
        if cl:
            client_name = cl.name

    tps, tvq, total = calculate_taxes(data.amount, data.include_tax, client_name)
    number = await generate_credit_note_number(db)

    cn = CreditNote(
        number=number, invoice_id=data.invoice_id, invoice_number=invoice_number,
        client_id=data.client_id, client_name=client_name,
        date=date.today(), reason=data.reason, amount=data.amount,
        include_tax=data.include_tax, tps=tps, tvq=tvq, total=total, notes=data.notes,
    )
    db.add(cn)

    if data.invoice_id:
        audit = InvoiceAuditLog(
            invoice_id=data.invoice_id,
            action=AuditAction.CREDIT_NOTE_ADDED.value,
            user_email=getattr(user, "email", ""),
            details=f"Credit note {number}: {data.reason} — ${data.amount:.2f}",
        )
        db.add(audit)

    await db.commit()
    await db.refresh(cn)
    return cn


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PDF GENERATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.get("/{invoice_id}/pdf")
async def get_invoice_pdf(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")

    pdf_buffer = generate_invoice_pdf(invoice)

    audit = InvoiceAuditLog(
        invoice_id=invoice.id,
        action=AuditAction.PDF_GENERATED.value,
        user_email=getattr(user, "email", ""),
    )
    db.add(audit)
    await db.commit()

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=facture_{invoice.number}.pdf"},
    )


@router.get("/credit-notes/{cn_id}/pdf")
async def get_credit_note_pdf(
    cn_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(CreditNote).where(CreditNote.id == cn_id))
    cn = result.scalar_one_or_none()
    if not cn:
        raise HTTPException(404, "Credit note not found")
    pdf_buffer = generate_credit_note_pdf(cn)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=credit_note_{cn.number}.pdf"},
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# EMAIL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/{invoice_id}/email")
async def email_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if not invoice.client_email:
        raise HTTPException(400, "Client has no email address")

    pdf_buffer = generate_invoice_pdf(invoice)

    try:
        from ..services.email_service import send_email_with_attachment
        await send_email_with_attachment(
            to_email=invoice.client_email,
            subject=f"Facture {invoice.number} — Soins Expert Plus",
            body=(
                f"Bonjour,\n\n"
                f"Veuillez trouver ci-joint la facture {invoice.number} "
                f"pour la période du {invoice.period_start} au {invoice.period_end}.\n\n"
                f"Montant total: ${invoice.total:,.2f}\n\n"
                f"Merci de votre confiance.\n\n"
                f"Soins Expert Plus\n{COMPANY_INFO['email']}"
            ),
            attachment=pdf_buffer.getvalue(),
            attachment_name=f"facture_{invoice.number}.pdf",
        )
    except ImportError:
        raise HTTPException(
            500,
            "Email service not configured — add send_email_with_attachment to email_service.py",
        )
    except Exception as e:
        raise HTTPException(500, f"Email failed: {str(e)}")

    if invoice.status in (InvoiceStatus.VALIDATED.value, InvoiceStatus.DRAFT.value):
        if invoice.status == InvoiceStatus.DRAFT.value:
            invoice.status = InvoiceStatus.VALIDATED.value
            invoice.validated_at = datetime.utcnow()
        invoice.status = InvoiceStatus.SENT.value
        invoice.sent_at = datetime.utcnow()

    audit = InvoiceAuditLog(
        invoice_id=invoice.id,
        action=AuditAction.EMAILED.value,
        user_email=getattr(user, "email", ""),
        details=f"Emailed to {invoice.client_email}",
    )
    db.add(audit)
    await db.commit()

    return {"message": f"Invoice emailed to {invoice.client_email}"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AUDIT LOG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.get("/{invoice_id}/audit-log")
async def get_audit_log(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(InvoiceAuditLog)
        .where(InvoiceAuditLog.invoice_id == invoice_id)
        .order_by(desc(InvoiceAuditLog.created_at))
    )
    return result.scalars().all()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BULK ACTIONS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@router.post("/bulk/validate")
async def bulk_validate(
    invoice_ids: List[str],
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    success, errors = [], []
    for inv_id in invoice_ids:
        r = await db.execute(select(Invoice).where(Invoice.id == inv_id))
        inv = r.scalar_one_or_none()
        if not inv:
            errors.append({"id": inv_id, "error": "Not found"})
            continue
        try:
            await change_invoice_status(
                db, inv, InvoiceStatus.VALIDATED.value,
                getattr(user, "email", ""),
            )
            success.append(inv_id)
        except ValueError as e:
            errors.append({"id": inv_id, "error": str(e)})
    return {"validated": success, "errors": errors}


@router.post("/bulk/send")
async def bulk_send(
    invoice_ids: List[str],
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    success, errors = [], []
    for inv_id in invoice_ids:
        r = await db.execute(select(Invoice).where(Invoice.id == inv_id))
        inv = r.scalar_one_or_none()
        if not inv:
            errors.append({"id": inv_id, "error": "Not found"})
            continue
        try:
            if inv.status == InvoiceStatus.DRAFT.value:
                await change_invoice_status(
                    db, inv, InvoiceStatus.VALIDATED.value,
                    getattr(user, "email", ""),
                )
            await change_invoice_status(
                db, inv, InvoiceStatus.SENT.value,
                getattr(user, "email", ""),
            )
            success.append(inv_id)
        except ValueError as e:
            errors.append({"id": inv_id, "error": str(e)})
    return {"sent": success, "errors": errors}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# INVOICE ATTACHMENTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALLOWED_MIME = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/{invoice_id}/attachments")
async def upload_attachment(
    invoice_id: str,
    file: UploadFile = File(...),
    category: str = Form("autre"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Upload une pièce jointe à une facture."""
    r = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Facture non trouvée")

    content_type = file.content_type or ""
    ext = ALLOWED_MIME.get(content_type)
    if not ext:
        raise HTTPException(400, f"Type non supporté: {content_type}. Acceptés: PDF, JPG, PNG, GIF")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "Fichier trop volumineux (max 10 MB)")

    stored_name = f"{uuid.uuid4().hex}.{ext}"
    att = InvoiceAttachment(
        invoice_id=invoice_id,
        filename=stored_name,
        original_filename=file.filename or "sans_nom",
        file_type=ext,
        file_size=len(data),
        file_data=data,
        category=category,
        description=description,
        uploaded_by=uploaded_by,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return {
        "id": att.id, "filename": att.original_filename,
        "file_type": att.file_type, "file_size": att.file_size,
        "category": att.category, "description": att.description,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/{invoice_id}/attachments")
async def list_attachments(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Lister les pièces jointes d'une facture."""
    result = await db.execute(
        select(InvoiceAttachment)
        .where(InvoiceAttachment.invoice_id == invoice_id)
        .order_by(InvoiceAttachment.created_at.desc())
    )
    return [
        {
            "id": a.id, "filename": a.original_filename,
            "file_type": a.file_type, "file_size": a.file_size,
            "category": a.category, "description": a.description,
            "uploaded_by": a.uploaded_by,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in result.scalars().all()
    ]


@router.get("/{invoice_id}/attachments/{att_id}")
async def download_attachment(
    invoice_id: str,
    att_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Télécharger une pièce jointe."""
    result = await db.execute(
        select(InvoiceAttachment).where(
            InvoiceAttachment.id == att_id,
            InvoiceAttachment.invoice_id == invoice_id,
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Pièce jointe non trouvée")

    mime_map = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png", "gif": "image/gif"}
    media = mime_map.get(att.file_type, "application/octet-stream")
    return Response(
        content=att.file_data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'},
    )


@router.delete("/{invoice_id}/attachments/{att_id}")
async def delete_attachment(
    invoice_id: str,
    att_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Supprimer une pièce jointe."""
    result = await db.execute(
        select(InvoiceAttachment).where(
            InvoiceAttachment.id == att_id,
            InvoiceAttachment.invoice_id == invoice_id,
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Pièce jointe non trouvée")
    await db.delete(att)
    await db.commit()
    return {"message": "Pièce jointe supprimée"}


@router.get("/{invoice_id}/pdf-with-attachments")
async def pdf_with_attachments(
    invoice_id: str,
    include_attachments: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """Générer le PDF de la facture avec pièces jointes combinées."""
    r = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Facture non trouvée")

    # Generate base invoice PDF
    pdf_bytes = generate_invoice_pdf(inv)

    if not include_attachments:
        return StreamingResponse(
            io.BytesIO(pdf_bytes), media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="facture_{inv.number}.pdf"'},
        )

    # Get attachments
    att_result = await db.execute(
        select(InvoiceAttachment)
        .where(InvoiceAttachment.invoice_id == invoice_id)
        .order_by(InvoiceAttachment.created_at)
    )
    attachments = att_result.scalars().all()

    if not attachments:
        return StreamingResponse(
            io.BytesIO(pdf_bytes), media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="facture_{inv.number}.pdf"'},
        )

    # Merge PDFs and convert images
    try:
        from PyPDF2 import PdfMerger, PdfReader
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as rl_canvas

        merger = PdfMerger()
        merger.append(io.BytesIO(pdf_bytes))

        for att in attachments:
            if att.file_type == "pdf":
                merger.append(io.BytesIO(att.file_data))
            elif att.file_type in ("jpg", "png", "gif"):
                # Convert image to PDF page
                img_pdf = io.BytesIO()
                c = rl_canvas.Canvas(img_pdf, pagesize=letter)
                from reportlab.lib.utils import ImageReader
                img = ImageReader(io.BytesIO(att.file_data))
                iw, ih = img.getSize()
                pw, ph = letter
                # Scale to fit page with margins
                margin = 36
                max_w, max_h = pw - 2 * margin, ph - 2 * margin
                scale = min(max_w / iw, max_h / ih, 1.0)
                dw, dh = iw * scale, ih * scale
                x = (pw - dw) / 2
                y = (ph - dh) / 2
                c.drawImage(img, x, y, dw, dh)
                c.save()
                img_pdf.seek(0)
                merger.append(img_pdf)

        output = io.BytesIO()
        merger.write(output)
        merger.close()
        output.seek(0)
        combined = output.getvalue()
    except ImportError:
        # PyPDF2 not installed, return base PDF
        combined = pdf_bytes

    return StreamingResponse(
        io.BytesIO(combined), media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="facture_{inv.number}_complet.pdf"'},
    )
