"""
Soins Expert Plus — Invoice Service (Phase 1)
Business logic for invoice generation, calculations, anomalies, workflow.
"""

from datetime import date, datetime, timedelta
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, Integer
from sqlalchemy.orm import selectinload
import uuid

from ..models.models_invoice import (
    Invoice, Payment, InvoiceAuditLog, CreditNote,
    InvoiceStatus, AuditAction
)
from ..models.models import Employee, Client, Schedule, Accommodation

RATES = {
    "Infirmier(ère)": 86.23,
    "Infirmière": 86.23,
    "Infirmier": 86.23,
    "Inf. auxiliaire": 57.18,
    "Infirmière auxiliaire": 57.18,
    "PAB": 50.35,
    "Préposé aux bénéficiaires": 50.35,
}
GARDE_RATE = 86.23
KM_RATE = 0.525
MAX_KM = 750
MAX_DEPLACEMENT_HOURS = 8
TPS_RATE = 0.05
TVQ_RATE = 0.09975
TPS_NUMBER = "714564891RT0001"
TVQ_NUMBER = "1225765936TQ0001"
TAX_EXEMPT_CLIENTS = ["Centre de Santé Inuulitsivik", "Conseil Cri de la Santé", "Conseil Cri de la santé"]
COMPANY_INFO = {"name": "Soins Expert Plus", "legal": "9437-7827 Québec Inc.", "address": "Québec, Canada", "phone": "", "email": "rh@soins-expert-plus.com", "tps_number": TPS_NUMBER, "tvq_number": TVQ_NUMBER}

async def generate_invoice_number(db: AsyncSession) -> str:
    """Generate next invoice number using MAX sequence to avoid duplicates after deletions.
    Format: SEP-YYYYMM-XXXX  (e.g. SEP-202604-0009)
    """
    import logging
    logger = logging.getLogger(__name__)

    today = date.today()
    prefix = f"SEP-{today.strftime('%Y%m')}"

    # Extract the maximum sequence number from existing invoices for this month.
    # Invoice.number format: SEP-YYYYMM-XXXX  →  suffix starts at position len(prefix)+2
    suffix_start = len(prefix) + 2  # +1 for the dash, +1 because SQL SUBSTR is 1-based
    result = await db.execute(
        select(
            func.max(
                func.cast(func.substr(Invoice.number, suffix_start), Integer)
            )
        ).where(Invoice.number.like(f"{prefix}-%"))
    )
    max_seq = result.scalar()

    if max_seq is None:
        next_seq = 1
    else:
        next_seq = int(max_seq) + 1

    new_number = f"{prefix}-{next_seq:04d}"
    logger.info("Generated invoice number %s (max_seq was %s)", new_number, max_seq)
    return new_number

async def generate_credit_note_number(db: AsyncSession) -> str:
    """Generate next credit note number using MAX sequence to avoid duplicates after deletions.
    Format: CN-YYYYMM-XXXX  (e.g. CN-202604-0003)
    """
    import logging
    logger = logging.getLogger(__name__)

    today = date.today()
    prefix = f"CN-{today.strftime('%Y%m')}"

    suffix_start = len(prefix) + 2
    result = await db.execute(
        select(
            func.max(
                func.cast(func.substr(CreditNote.number, suffix_start), Integer)
            )
        ).where(CreditNote.number.like(f"{prefix}-%"))
    )
    max_seq = result.scalar()

    if max_seq is None:
        next_seq = 1
    else:
        next_seq = int(max_seq) + 1

    new_number = f"{prefix}-{next_seq:04d}"
    logger.info("Generated credit note number %s (max_seq was %s)", new_number, max_seq)
    return new_number

def is_tax_exempt(client_name: str) -> bool:
    return any(exempt.lower() in (client_name or "").lower() for exempt in TAX_EXEMPT_CLIENTS)

def calculate_taxes(subtotal: float, include_tax: bool, client_name: str = "") -> Tuple[float, float, float]:
    if not include_tax or is_tax_exempt(client_name): return 0.0, 0.0, subtotal
    tps = round(subtotal * TPS_RATE, 2); tvq = round(subtotal * TVQ_RATE, 2); total = round(subtotal + tps + tvq, 2)
    return tps, tvq, total

def get_rate_for_title(title: str) -> float:
    for key, rate in RATES.items():
        if key.lower() in (title or "").lower(): return rate
    return RATES["Infirmier(ère)"]

def schedule_pause_to_invoice_minutes(pause_value: Any) -> float:
    try:
        pause = float(pause_value or 0)
    except (TypeError, ValueError):
        return 0.0
    if pause <= 0:
        return 0.0
    if pause <= 4:
        return round(pause * 60, 2)
    return round(pause, 2)

def invoice_pause_to_schedule_hours(pause_value: Any) -> float:
    try:
        pause = float(pause_value or 0)
    except (TypeError, ValueError):
        return 0.0
    if pause <= 0:
        return 0.0
    if pause < 4 and not pause.is_integer():
        return round(pause, 2)
    return round(pause / 60.0, 2)

def build_shift_expense_description(expense_type: str, shift_date: Any = None, schedule_notes: str = "") -> str:
    base = {
        "km": "Kilométrage",
        "deplacement": "Déplacement",
        "autre": "Autres frais",
    }.get((expense_type or "").strip().lower(), "Frais")
    note = " ".join(str(schedule_notes or "").strip().split())
    date_text = shift_date.isoformat() if hasattr(shift_date, "isoformat") else str(shift_date or "").strip()
    description = f"{base} - {note}" if note else base
    return f"{description} ({date_text})" if date_text else description

def recalculate_invoice(invoice: Invoice) -> Invoice:
    lines = invoice.lines or []; accom = invoice.accommodation_lines or []; expenses = invoice.expense_lines or []; extras = invoice.extra_lines or []
    invoice.subtotal_services = round(sum(l.get("service_amount", 0) for l in lines), 2)
    invoice.subtotal_garde = round(sum(l.get("garde_amount", 0) for l in lines), 2)
    invoice.subtotal_rappel = round(sum(l.get("rappel_amount", 0) for l in lines), 2)
    invoice.subtotal_accom = round(sum(a.get("amount", 0) for a in accom), 2)
    invoice.subtotal_deplacement = round(sum(e.get("amount", 0) for e in expenses if e.get("type") == "deplacement"), 2)
    invoice.subtotal_km = round(sum(e.get("amount", 0) for e in expenses if e.get("type") == "km"), 2)
    invoice.subtotal_autres_frais = round(sum(e.get("amount", 0) for e in expenses if e.get("type") == "autre"), 2)
    extra_total = round(sum(e.get("amount", 0) for e in extras), 2)
    invoice.subtotal = round(invoice.subtotal_services + invoice.subtotal_garde + invoice.subtotal_rappel + invoice.subtotal_accom + invoice.subtotal_deplacement + invoice.subtotal_km + invoice.subtotal_autres_frais + extra_total, 2)
    tps, tvq, total = calculate_taxes(invoice.subtotal, invoice.include_tax, invoice.client_name)
    invoice.tps = tps; invoice.tvq = tvq; invoice.total = total; invoice.balance_due = round(invoice.total - (invoice.amount_paid or 0), 2)
    return invoice

async def generate_invoices_from_timesheets(db: AsyncSession, period_start: date, period_end: date, client_id: Optional[int] = None, employee_id: Optional[int] = None, user_email: str = "") -> List[Invoice]:
    query = select(Schedule).where(and_(Schedule.date >= period_start, Schedule.date <= period_end, Schedule.status != "cancelled"))
    if employee_id: query = query.where(Schedule.employee_id == employee_id)
    if client_id: query = query.where(Schedule.client_id == client_id)
    result = await db.execute(query)
    schedules = result.scalars().all()
    if not schedules: return []

    from collections import defaultdict
    pair_schedules: Dict[tuple, List] = defaultdict(list)
    for s in schedules:
        cid = s.client_id or 0
        pair_schedules[(s.employee_id, cid)].append(s)

    emp_ids = list(set(eid for eid, _ in pair_schedules.keys()))
    emp_result = await db.execute(select(Employee).where(Employee.id.in_(emp_ids)))
    employees = {e.id: e for e in emp_result.scalars().all()}
    all_client_ids = list(set(cid for _, cid in pair_schedules.keys() if cid))
    clients_map = {}
    if all_client_ids:
        client_result = await db.execute(select(Client).where(Client.id.in_(all_client_ids)))
        clients_map = {c.id: c for c in client_result.scalars().all()}

    accom_result = await db.execute(select(Accommodation).where(and_(Accommodation.employee_id.in_(emp_ids), or_(and_(Accommodation.start_date >= period_start, Accommodation.start_date <= period_end), and_(Accommodation.end_date >= period_start, Accommodation.end_date <= period_end), and_(Accommodation.start_date <= period_start, Accommodation.end_date >= period_end)))))
    accommodations = accom_result.scalars().all()
    emp_accoms: Dict[int, List] = {}
    for a in accommodations: emp_accoms.setdefault(a.employee_id, []).append(a)

    existing = await db.execute(select(Invoice).where(and_(Invoice.period_start == period_start, Invoice.period_end == period_end, Invoice.employee_id.in_(emp_ids), Invoice.status != InvoiceStatus.CANCELLED.value)))
    existing_pairs = {(inv.employee_id, inv.client_id or 0) for inv in existing.scalars().all()}
    created_invoices = []

    for (emp_id, cid), scheds in pair_schedules.items():
        try:
            if (emp_id, cid) in existing_pairs: continue
            employee = employees.get(emp_id)
            if not employee: continue
            client = clients_map.get(cid) if cid else None
            if not client and getattr(employee, 'client_id', None):
                client = await db.scalar(select(Client).where(Client.id == employee.client_id))
            client_name = client.name if client else "Non assigné"
            include_tax = not is_tax_exempt(client_name)
            rate = get_rate_for_title(employee.position or "Infirmier(ère)")
            service_lines = []
            for s in sorted(scheds, key=lambda x: x.date):
                hours = getattr(s, "hours", 0) or 0; pause = getattr(s, "pause", 0) or 0; garde_h = getattr(s, "garde_hours", 0) or 0; rappel_h = getattr(s, "rappel_hours", 0) or 0
                garde_billable = garde_h / 8.0 if garde_h else 0
                service_lines.append({"schedule_id": s.id, "date": s.date.isoformat() if hasattr(s.date, "isoformat") else str(s.date), "employee": employee.name or f"Emp #{emp_id}", "location": client_name, "start": getattr(s, "start", "") or "", "end": getattr(s, "end", "") or "", "pause_min": schedule_pause_to_invoice_minutes(pause), "hours": round(hours, 2), "rate": rate, "service_amount": round(hours * rate, 2), "garde_hours": garde_h, "garde_amount": round(garde_billable * GARDE_RATE, 2), "rappel_hours": rappel_h, "rappel_amount": round(rappel_h * rate, 2)})
            all_scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == emp_id, Schedule.status != 'cancelled'))
            all_scheds = all_scheds_r.scalars().all()
            all_worked = sorted({s.date for s in all_scheds})
            billed_worked = sorted({s.date for s in scheds})
            accom_lines = []
            for a in emp_accoms.get(emp_id, []):
                full_span_worked = [d for d in all_worked if a.start_date <= d <= a.end_date]
                billed_span_worked = [d for d in billed_worked if max(period_start, a.start_date) <= d <= min(period_end, a.end_date)]
                if not billed_span_worked: continue
                total_cost = float(getattr(a, 'total_cost', 0) or 0)
                denominator = len(full_span_worked) or int(getattr(a, 'days_worked', 0) or 0) or 1
                cost_day = round(total_cost / denominator, 2) if total_cost else float(getattr(a, 'cost_per_day', 0) or 0)
                accom_lines.append({"employee": employee.name or '', "period": f"{max(period_start, a.start_date).isoformat()} → {min(period_end, a.end_date).isoformat()}", "days": len(billed_span_worked), "cost_per_day": cost_day, "amount": round(cost_day * len(billed_span_worked), 2)})
            expense_lines = []
            for s in scheds:
                km_val = getattr(s, 'km', 0) or 0
                if km_val:
                    capped_km = min(float(km_val), MAX_KM)
                    expense_lines.append({"schedule_id": s.id, "type": "km", "description": f"Kilométrage ({s.date})", "quantity": capped_km, "rate": KM_RATE, "amount": round(capped_km * KM_RATE, 2)})
                depl_val = getattr(s, 'deplacement', 0) or 0
                if depl_val:
                    capped_depl = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
                    expense_lines.append({"schedule_id": s.id, "type": "deplacement", "description": f"Déplacement ({s.date})", "quantity": capped_depl, "rate": rate, "amount": round(capped_depl * rate, 2)})
                autre_val = getattr(s, 'autre_dep', 0) or 0
                if autre_val:
                    expense_lines.append({"schedule_id": s.id, "type": "autre", "description": f"Autres frais ({s.date})", "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})
            expense_lines = []
            for s in scheds:
                shift_notes = getattr(s, "notes", "") or ""
                km_val = getattr(s, "km", 0) or 0
                if km_val:
                    capped_km = min(float(km_val), MAX_KM)
                    expense_lines.append({"schedule_id": s.id, "type": "km", "description": build_shift_expense_description("km", s.date, shift_notes), "quantity": capped_km, "rate": KM_RATE, "amount": round(capped_km * KM_RATE, 2)})
                depl_val = getattr(s, "deplacement", 0) or 0
                if depl_val:
                    capped_depl = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
                    expense_lines.append({"schedule_id": s.id, "type": "deplacement", "description": build_shift_expense_description("deplacement", s.date, shift_notes), "quantity": capped_depl, "rate": rate, "amount": round(capped_depl * rate, 2)})
                autre_val = getattr(s, "autre_dep", 0) or 0
                if autre_val:
                    expense_lines.append({"schedule_id": s.id, "type": "autre", "description": build_shift_expense_description("autre", s.date, shift_notes), "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})

            inv_number = await generate_invoice_number(db)
            invoice = Invoice(id=str(uuid.uuid4()), number=inv_number, date=date.today(), period_start=period_start, period_end=period_end, client_id=client.id if client else None, client_name=client_name, client_address=getattr(client, 'address', '') if client else '', client_email=getattr(client, 'email', '') if client else '', client_phone=getattr(client, 'phone', '') if client else '', employee_id=emp_id, employee_name=employee.name or '', employee_title=employee.position or '', include_tax=include_tax, status=InvoiceStatus.DRAFT.value, lines=service_lines, accommodation_lines=accom_lines, expense_lines=expense_lines, extra_lines=[])
            invoice = recalculate_invoice(invoice)
            db.add(invoice)
            audit = InvoiceAuditLog(id=str(uuid.uuid4()), invoice_id=invoice.id, action=AuditAction.CREATED.value, new_status=InvoiceStatus.DRAFT.value, user_email=user_email, details=f"Generated from schedules for period {period_start} to {period_end}")
            db.add(audit)
            created_invoices.append(invoice)
        except Exception:
            continue
    await db.commit()
    return created_invoices

VALID_TRANSITIONS = {InvoiceStatus.DRAFT: [InvoiceStatus.VALIDATED, InvoiceStatus.CANCELLED], InvoiceStatus.VALIDATED: [InvoiceStatus.SENT, InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED], InvoiceStatus.SENT: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.CANCELLED], InvoiceStatus.PARTIALLY_PAID: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED], InvoiceStatus.PAID: [InvoiceStatus.SENT], InvoiceStatus.CANCELLED: [InvoiceStatus.DRAFT]}

def can_transition(current: str, target: str) -> bool:
    try: return InvoiceStatus(target) in VALID_TRANSITIONS.get(InvoiceStatus(current), [])
    except ValueError: return False

async def change_invoice_status(db: AsyncSession, invoice: Invoice, new_status: str, user_email: str = "", notes: str = "") -> Invoice:
    if not can_transition(invoice.status, new_status):
        raise ValueError(f"Cannot transition from '{invoice.status}' to '{new_status}'. Valid: {[s.value for s in VALID_TRANSITIONS.get(InvoiceStatus(invoice.status), [])]}")
    old_status = invoice.status; invoice.status = new_status; now = datetime.utcnow()
    if new_status == InvoiceStatus.VALIDATED.value: invoice.validated_at = now
    elif new_status == InvoiceStatus.SENT.value: invoice.sent_at = now
    elif new_status == InvoiceStatus.PAID.value: invoice.paid_at = now
    audit = InvoiceAuditLog(id=str(uuid.uuid4()), invoice_id=invoice.id, action=AuditAction.STATUS_CHANGE.value, old_status=old_status, new_status=new_status, user_email=user_email, details=notes)
    db.add(audit); await db.commit(); await db.refresh(invoice); return invoice

async def add_payment(db: AsyncSession, invoice: Invoice, amount: float, payment_date: date, reference: str = "", method: str = "virement", notes: str = "", user_email: str = "") -> Payment:
    if amount <= 0: raise ValueError("Payment amount must be positive")
    if amount > invoice.balance_due + 0.01: raise ValueError(f"Payment ${amount:.2f} exceeds balance due ${invoice.balance_due:.2f}")
    payment = Payment(id=str(uuid.uuid4()), invoice_id=invoice.id, amount=round(amount, 2), date=payment_date, reference=reference, method=method, notes=notes)
    db.add(payment); invoice.amount_paid = round((invoice.amount_paid or 0) + amount, 2); invoice.balance_due = round(invoice.total - (invoice.amount_paid or 0), 2)
    old_status = invoice.status
    if invoice.balance_due <= 0.01: invoice.status = InvoiceStatus.PAID.value; invoice.paid_at = datetime.utcnow(); invoice.balance_due = 0.0
    elif (invoice.amount_paid or 0) > 0 and invoice.status in (InvoiceStatus.SENT.value, InvoiceStatus.VALIDATED.value): invoice.status = InvoiceStatus.PARTIALLY_PAID.value
    audit = InvoiceAuditLog(id=str(uuid.uuid4()), invoice_id=invoice.id, action=AuditAction.PAYMENT_ADDED.value, old_status=old_status, new_status=invoice.status, user_email=user_email, details=f"Payment: ${amount:.2f} ({method}) ref: {reference}")
    db.add(audit); await db.commit(); await db.refresh(invoice); return payment

async def delete_payment(db: AsyncSession, invoice: Invoice, payment_id: str, user_email: str = "") -> Invoice:
    payment = next((p for p in invoice.payments if p.id == payment_id), None)
    if not payment: raise ValueError(f"Payment {payment_id} not found")
    amount = payment.amount; await db.delete(payment); invoice.amount_paid = round((invoice.amount_paid or 0) - amount, 2); invoice.balance_due = round(invoice.total - (invoice.amount_paid or 0), 2)
    old_status = invoice.status
    if (invoice.amount_paid or 0) <= 0: invoice.status = InvoiceStatus.SENT.value; invoice.paid_at = None
    elif invoice.balance_due > 0.01: invoice.status = InvoiceStatus.PARTIALLY_PAID.value
    audit = InvoiceAuditLog(id=str(uuid.uuid4()), invoice_id=invoice.id, action=AuditAction.PAYMENT_DELETED.value, old_status=old_status, new_status=invoice.status, user_email=user_email, details=f"Deleted payment: ${amount:.2f} (id: {payment_id})")
    db.add(audit); await db.commit(); await db.refresh(invoice); return invoice

async def detect_anomalies(db: AsyncSession) -> List[Dict]:
    anomalies = []; result = await db.execute(select(Invoice).where(Invoice.status != InvoiceStatus.CANCELLED.value)); invoices = result.scalars().all(); seen = {}
    for inv in invoices:
        key = (inv.employee_id, str(inv.period_start), str(inv.period_end))
        if key in seen: anomalies.append({"invoice_id": inv.id, "invoice_number": inv.number, "type": "duplicate", "description": f"Doublon possible: même employé ({inv.employee_name}) et période que {seen[key]}", "severity": "error"})
        else: seen[key] = inv.number
        for line in (inv.lines or []):
            hours = line.get("hours", 0)
            if hours > 16: anomalies.append({"invoice_id": inv.id, "invoice_number": inv.number, "type": "excessive_hours", "description": f"Heures excessives: {hours}h le {line.get('date', '?')} pour {inv.employee_name}", "severity": "warning"})
        expected_rate = get_rate_for_title(inv.employee_title)
        for line in (inv.lines or []):
            line_rate = line.get("rate", 0)
            if line_rate and abs(line_rate - expected_rate) > 0.01: anomalies.append({"invoice_id": inv.id, "invoice_number": inv.number, "type": "rate_mismatch", "description": f"Taux {line_rate}$/h ≠ standard {expected_rate}$/h pour {inv.employee_title}", "severity": "warning"}); break
        if not inv.client_id and inv.client_name in ("", "Non assigné"): anomalies.append({"invoice_id": inv.id, "invoice_number": inv.number, "type": "no_client", "description": f"Facture sans client assigné", "severity": "error"})
    return anomalies

async def duplicate_invoice(db: AsyncSession, source: Invoice, user_email: str = "") -> Invoice:
    new_number = await generate_invoice_number(db); new_id = str(uuid.uuid4())
    new_invoice = Invoice(id=new_id, number=new_number, date=date.today(), period_start=source.period_start, period_end=source.period_end, client_id=source.client_id, client_name=source.client_name, client_address=source.client_address, client_email=source.client_email, client_phone=source.client_phone, employee_id=source.employee_id, employee_name=source.employee_name, employee_title=source.employee_title, include_tax=source.include_tax, status=InvoiceStatus.DRAFT.value, lines=source.lines or [], accommodation_lines=source.accommodation_lines or [], expense_lines=source.expense_lines or [], extra_lines=source.extra_lines or [], notes=f"Copie de {source.number}", po_number=source.po_number, due_date=source.due_date)
    new_invoice = recalculate_invoice(new_invoice); db.add(new_invoice)
    audit = InvoiceAuditLog(id=str(uuid.uuid4()), invoice_id=new_id, action=AuditAction.DUPLICATED.value, new_status=InvoiceStatus.DRAFT.value, user_email=user_email, details=f"Duplicated from {source.number}")
    db.add(audit); await db.commit(); await db.refresh(new_invoice); return new_invoice

async def get_client_invoice_summary(db: AsyncSession, client_id: int) -> Dict:
    result = await db.execute(select(Invoice).options(selectinload(Invoice.payments)).where(and_(Invoice.client_id == client_id, Invoice.status != InvoiceStatus.CANCELLED.value)).order_by(Invoice.date.desc()))
    invoices = result.scalars().all(); total_invoiced = sum(inv.total for inv in invoices); total_paid = sum((inv.amount_paid or 0) for inv in invoices); total_outstanding = sum(inv.balance_due for inv in invoices); total_overdue = sum(inv.balance_due for inv in invoices if inv.balance_due > 0 and inv.due_date and inv.due_date < date.today())
    return {"client_id": client_id, "total_invoiced": round(total_invoiced, 2), "total_paid": round(total_paid, 2), "total_outstanding": round(total_outstanding, 2), "total_overdue": round(total_overdue, 2), "invoice_count": len(invoices), "invoices": invoices}
