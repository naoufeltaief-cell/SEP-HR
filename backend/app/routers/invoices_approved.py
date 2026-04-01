from datetime import date, datetime
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..services.auth_service import require_admin
from ..models.models import Client, Employee, InvoiceAttachment, Schedule, Accommodation, ScheduleApproval
from ..models.models_schedule_review import ScheduleApprovalMeta, ScheduleApprovalAttachment
from ..models.models_invoice import Invoice, InvoiceAuditLog
from ..services.invoice_service import generate_invoice_number, recalculate_invoice, is_tax_exempt, get_rate_for_title, GARDE_RATE, KM_RATE, MAX_KM, MAX_DEPLACEMENT_HOURS
router = APIRouter()

@router.post("/generate-from-approved-schedules")
async def generate_invoice_from_approved_schedules(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    period_start = data.get("period_start")
    period_end = data.get("period_end")
    if not all([employee_id, client_id, period_start, period_end]):
        raise HTTPException(400, "employee_id, client_id, period_start et period_end requis")
    ps = date.fromisoformat(period_start)
    pe = date.fromisoformat(period_end)
    existing = await db.execute(select(Invoice).where(Invoice.employee_id == employee_id, Invoice.client_id == client_id, Invoice.period_start == ps, Invoice.period_end == pe, Invoice.status != "cancelled"))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Une facture existe déjà pour cet employé/client/période")
    approval_result = await db.execute(select(ScheduleApproval).where(ScheduleApproval.employee_id == employee_id, ScheduleApproval.client_id == client_id, ScheduleApproval.week_start == ps, ScheduleApproval.week_end == pe, ScheduleApproval.status == "approved"))
    approval = approval_result.scalar_one_or_none()
    if not approval:
        raise HTTPException(400, "Cette semaine doit être approuvée avant de générer une facture approuvée")
    meta_result = await db.execute(select(ScheduleApprovalMeta).where(ScheduleApprovalMeta.approval_id == approval.id))
    approval_meta = meta_result.scalar_one_or_none()
    er = await db.execute(select(Employee).where(Employee.id == employee_id))
    employee = er.scalar_one_or_none()
    if not employee:
        raise HTTPException(404, "Employé non trouvé")
    cr = await db.execute(select(Client).where(Client.id == client_id))
    client = cr.scalar_one_or_none()
    client_name = client.name if client else "Non assigné"
    scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee_id, Schedule.client_id == client_id, Schedule.date >= ps, Schedule.date <= pe, Schedule.status != "cancelled").order_by(Schedule.date))
    scheds = scheds_r.scalars().all()
    if not scheds:
        raise HTTPException(400, "Aucun quart trouvé pour cette période")
    rate = get_rate_for_title(employee.position or "Infirmier(ère)")
    include_tax = not is_tax_exempt(client_name)
    service_lines = []
    raw_total_hours = 0.0
    for s in scheds:
        hours = round((getattr(s, "hours", 0) or 0), 2)
        raw_total_hours += hours
        garde_h = getattr(s, "garde_hours", 0) or 0
        rappel_h = getattr(s, "rappel_hours", 0) or 0
        garde_billable = garde_h / 8.0 if garde_h else 0
        garde_amount = round(garde_billable * GARDE_RATE, 2)
        rappel_amount = round(rappel_h * rate, 2)
        service_lines.append({"date": s.date.isoformat() if hasattr(s.date, "isoformat") else str(s.date), "employee": employee.name or "", "location": client_name, "start": getattr(s, "start", "") or "", "end": getattr(s, "end", "") or "", "pause_min": getattr(s, "pause", 0) or 0, "hours": hours, "rate": rate, "service_amount": round(hours * rate, 2), "garde_hours": garde_h, "garde_amount": garde_amount, "rappel_hours": rappel_h, "rappel_amount": rappel_amount})
    raw_total_hours = round(raw_total_hours, 2)
    approved_hours = round((approval_meta.approved_hours if approval_meta else raw_total_hours) or raw_total_hours, 2)
    expense_lines = []
    for s in scheds:
        km_val = getattr(s, "km", 0) or 0
        if km_val:
            capped = min(float(km_val), MAX_KM)
            expense_lines.append({"type": "km", "description": f"Kilométrage ({s.date})", "quantity": capped, "rate": KM_RATE, "amount": round(capped * KM_RATE, 2)})
        depl_val = getattr(s, "deplacement", 0) or 0
        if depl_val:
            capped = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
            expense_lines.append({"type": "deplacement", "description": f"Déplacement ({s.date})", "quantity": capped, "rate": rate, "amount": round(capped * rate, 2)})
        autre_val = getattr(s, "autre_dep", 0) or 0
        if autre_val:
            expense_lines.append({"type": "autre", "description": f"Autres frais ({s.date})", "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})
    accom_r = await db.execute(select(Accommodation).where(Accommodation.employee_id == employee_id, or_(and_(Accommodation.start_date >= ps, Accommodation.start_date <= pe), and_(Accommodation.end_date >= ps, Accommodation.end_date <= pe))))
    accom_lines = []
    for a in accom_r.scalars().all():
        days = getattr(a, "days_worked", 0) or 0
        cpd = getattr(a, "cost_per_day", 0) or 0
        tc = getattr(a, "total_cost", 0) or 0
        if tc and days and not cpd:
            cpd = round(tc / days, 2)
        accom_lines.append({"employee": employee.name or "", "period": f"{ps.isoformat()} → {pe.isoformat()}", "days": days, "cost_per_day": cpd, "amount": round(days * cpd, 2) if cpd else tc})
    extra_lines = []
    if abs(approved_hours - raw_total_hours) > 0.009:
        delta_hours = round(approved_hours - raw_total_hours, 2)
        extra_lines.append({"description": f"Ajustement heures approuvées ({approved_hours:.2f}h approuvées vs {raw_total_hours:.2f}h planifiées)", "amount": round(delta_hours * rate, 2), "hours_delta": delta_hours, "rate": rate, "type": "approved_hours_adjustment"})
    invoice = Invoice(id=str(uuid.uuid4()), number=await generate_invoice_number(db), date=date.today(), period_start=ps, period_end=pe, client_id=client.id if client else None, client_name=client_name, client_address=client.address if client else "", client_email=getattr(client, "email", "") if client else "", client_phone=getattr(client, "phone", "") if client else "", employee_id=employee_id, employee_name=employee.name or "", employee_title=employee.position or "", include_tax=include_tax, status="validated", validated_at=datetime.utcnow(), lines=service_lines, accommodation_lines=accom_lines, expense_lines=expense_lines, extra_lines=extra_lines, notes=f"Facture approuvée générée depuis l'horaire validé. Heures approuvées: {approved_hours:.2f}h. Heures planifiées: {raw_total_hours:.2f}h.")
    invoice = recalculate_invoice(invoice)
    db.add(invoice)
    await db.flush()
    approval_atts_r = await db.execute(select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.approval_id == approval.id).order_by(ScheduleApprovalAttachment.created_at))
    for src in approval_atts_r.scalars().all():
        db.add(InvoiceAttachment(invoice_id=invoice.id, filename=src.filename, original_filename=src.original_filename, file_type=src.file_type, file_size=src.file_size, file_data=src.file_data, category=src.category, description=src.description, uploaded_by=src.uploaded_by))
    db.add(InvoiceAuditLog(invoice_id=invoice.id, action="created", new_status="validated", user_email=getattr(user, "email", ""), details=f"Facture approuvée générée — {employee.name} / {client_name} / {ps} → {pe} / {approved_hours:.2f}h approuvées / {raw_total_hours:.2f}h planifiées"))
    await db.commit()
    await db.refresh(invoice)
    return {"id": invoice.id, "number": invoice.number, "total": invoice.total, "status": invoice.status, "employee_name": invoice.employee_name, "client_name": invoice.client_name, "approved_hours": approved_hours, "planned_hours": raw_total_hours}
