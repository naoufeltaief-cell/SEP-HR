from datetime import timedelta, date as date_type, datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models.models import Schedule, ScheduleApproval, Timesheet
from ..models.models_schedule_review import ScheduleApprovalMeta, ScheduleApprovalAttachment
from ..services.auth_service import require_admin, get_current_user
from ..services.timesheet_service import sync_timesheet_attachments_to_reviews
router = APIRouter()
ALLOWED_MIME = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024

def _normalize_week_start(week_start_str: str) -> date_type:
    ws = date_type.fromisoformat(week_start_str)
    if ws.weekday() != 6:
        ws = ws - timedelta(days=(ws.weekday() + 1) % 7)
    return ws

async def _get_week_stats(db: AsyncSession, employee_id: int, client_id: int, ws: date_type, we: date_type):
    result = await db.execute(select(Schedule).where(Schedule.employee_id == employee_id, Schedule.client_id == client_id, Schedule.date >= ws, Schedule.date <= we, Schedule.status != "cancelled"))
    scheds = result.scalars().all()
    total_hours = round(sum((getattr(s, "hours", 0) or 0) for s in scheds), 2)
    return scheds, total_hours, len(scheds)

async def _find_approval(db: AsyncSession, employee_id: int, client_id: int, ws: date_type):
    result = await db.execute(select(ScheduleApproval).where(ScheduleApproval.employee_id == employee_id, ScheduleApproval.client_id == client_id, ScheduleApproval.week_start == ws))
    return result.scalar_one_or_none()

async def _get_meta(db: AsyncSession, approval_id: int):
    result = await db.execute(select(ScheduleApprovalMeta).where(ScheduleApprovalMeta.approval_id == approval_id))
    return result.scalar_one_or_none()

async def _upsert_meta(db: AsyncSession, approval_id: int, approved_hours: float, approved_shift_count: int, week_total_hours: float):
    meta = await _get_meta(db, approval_id)
    if not meta:
        meta = ScheduleApprovalMeta(approval_id=approval_id, approved_hours=approved_hours, approved_shift_count=approved_shift_count, week_total_hours=week_total_hours)
        db.add(meta)
    else:
        meta.approved_hours = approved_hours
        meta.approved_shift_count = approved_shift_count
        meta.week_total_hours = week_total_hours
        meta.updated_at = datetime.utcnow()
    return meta

async def _serialize_approval(db: AsyncSession, approval: ScheduleApproval):
    meta = await _get_meta(db, approval.id)
    att_count = await db.execute(select(func.count(ScheduleApprovalAttachment.id)).where(ScheduleApprovalAttachment.approval_id == approval.id))
    return {"id": approval.id, "employee_id": approval.employee_id, "client_id": approval.client_id, "week_start": str(approval.week_start), "week_end": str(approval.week_end), "status": approval.status, "approved_by": approval.approved_by, "approved_at": approval.approved_at.isoformat() if approval.approved_at else None, "notes": approval.notes, "approved_hours": round((meta.approved_hours if meta else 0) or 0, 2), "approved_shift_count": (meta.approved_shift_count if meta else 0) or 0, "week_total_hours": round((meta.week_total_hours if meta else 0) or 0, 2), "attachment_count": att_count.scalar() or 0}

@router.get("/")
async def list_reviews(employee_id: int = None, client_id: int = None, week_start: str = None, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    q = select(ScheduleApproval)
    if employee_id:
        q = q.where(ScheduleApproval.employee_id == employee_id)
    if client_id:
        q = q.where(ScheduleApproval.client_id == client_id)
    if week_start:
        q = q.where(ScheduleApproval.week_start == _normalize_week_start(week_start))
    result = await db.execute(q.order_by(ScheduleApproval.week_start.desc()))
    approvals = result.scalars().all()
    return [await _serialize_approval(db, approval) for approval in approvals]

@router.post("/review-week")
async def review_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    week_start_str = data.get("week_start")
    notes = data.get("notes", "")
    if not all([employee_id, client_id, week_start_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    ws = _normalize_week_start(week_start_str)
    we = ws + timedelta(days=6)
    _, raw_total_hours, shift_count = await _get_week_stats(db, employee_id, client_id, ws, we)
    approved_hours = float(data.get("approved_hours", raw_total_hours) or 0)
    approval = await _find_approval(db, employee_id, client_id, ws)
    if not approval:
        approval = ScheduleApproval(employee_id=employee_id, client_id=client_id, week_start=ws, week_end=we, approved_by=getattr(user, "email", "admin"), status="pending", notes=notes)
        db.add(approval)
        await db.flush()
    else:
        approval.week_end = we
        approval.notes = notes
        approval.status = "pending" if approval.status != "approved" else approval.status
    await _upsert_meta(db, approval.id, approved_hours, shift_count, raw_total_hours)
    timesheet_result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id == employee_id,
            Timesheet.period_start == ws,
            Timesheet.period_end == we,
        )
    )
    timesheet = timesheet_result.scalar_one_or_none()
    if timesheet:
        await sync_timesheet_attachments_to_reviews(db, timesheet, approval=approval)
    await db.commit()
    await db.refresh(approval)
    return await _serialize_approval(db, approval)

@router.post("/approve-week")
async def approve_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    week_start_str = data.get("week_start")
    approved_by = data.get("approved_by", getattr(user, "email", "admin"))
    notes = data.get("notes", "")
    if not all([employee_id, client_id, week_start_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    ws = _normalize_week_start(week_start_str)
    we = ws + timedelta(days=6)
    _, raw_total_hours, shift_count = await _get_week_stats(db, employee_id, client_id, ws, we)
    approved_hours = float(data.get("approved_hours", raw_total_hours) or 0)
    approval = await _find_approval(db, employee_id, client_id, ws)
    if not approval:
        approval = ScheduleApproval(employee_id=employee_id, client_id=client_id, week_start=ws, week_end=we, approved_by=approved_by, approved_at=datetime.utcnow(), status="approved", notes=notes)
        db.add(approval)
        await db.flush()
    else:
        approval.status = "approved"
        approval.approved_by = approved_by
        approval.approved_at = datetime.utcnow()
        approval.week_end = we
        approval.notes = notes
    await _upsert_meta(db, approval.id, approved_hours, shift_count, raw_total_hours)
    timesheet_result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id == employee_id,
            Timesheet.period_start == ws,
            Timesheet.period_end == we,
        )
    )
    timesheet = timesheet_result.scalar_one_or_none()
    if timesheet:
        await sync_timesheet_attachments_to_reviews(db, timesheet, approval=approval)
    await db.commit()
    await db.refresh(approval)
    serialized = await _serialize_approval(db, approval)
    serialized["message"] = "Semaine approuvée"
    return serialized

@router.post("/revoke-week")
async def revoke_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    ws_str = data.get("week_start")
    if not all([employee_id, client_id, ws_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    approval = await _find_approval(db, employee_id, client_id, _normalize_week_start(ws_str))
    if not approval:
        raise HTTPException(404, "Aucune approbation trouvée")
    approval.status = "rejected"
    await db.commit()
    return {"message": "Approbation révoquée", "status": "rejected"}

@router.post("/{approval_id}/attachments")
async def upload_attachment(approval_id: int, file: UploadFile = File(...), category: str = Form("autre"), description: str = Form(""), uploaded_by: str = Form("admin"), db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    approval_result = await db.execute(select(ScheduleApproval).where(ScheduleApproval.id == approval_id))
    approval = approval_result.scalar_one_or_none()
    if not approval:
        raise HTTPException(404, "Révision hebdomadaire non trouvée")
    content_type = file.content_type or ""
    ext = ALLOWED_MIME.get(content_type)
    if not ext:
        raise HTTPException(400, f"Type non supporté: {content_type}")
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "Fichier trop volumineux (max 10 MB)")
    import uuid
    att = ScheduleApprovalAttachment(approval_id=approval_id, filename=f"{uuid.uuid4().hex}.{ext}", original_filename=file.filename or "sans_nom", file_type=ext, file_size=len(data), file_data=data, category=category, description=description, uploaded_by=uploaded_by)
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return {"id": att.id, "filename": att.original_filename, "file_type": att.file_type, "file_size": att.file_size, "category": att.category, "description": att.description, "created_at": att.created_at.isoformat() if att.created_at else None}

@router.get("/{approval_id}/attachments")
async def list_attachments(approval_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.approval_id == approval_id).order_by(ScheduleApprovalAttachment.created_at.desc()))
    return [{"id": a.id, "filename": a.original_filename, "file_type": a.file_type, "file_size": a.file_size, "category": a.category, "description": a.description, "uploaded_by": a.uploaded_by, "created_at": a.created_at.isoformat() if a.created_at else None} for a in result.scalars().all()]

@router.get("/{approval_id}/attachments/{att_id}")
async def download_attachment(approval_id: int, att_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.id == att_id, ScheduleApprovalAttachment.approval_id == approval_id))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Pièce jointe non trouvée")
    mime_map = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png", "gif": "image/gif"}
    media = mime_map.get(att.file_type, "application/octet-stream")
    return Response(content=att.file_data, media_type=media, headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'})

@router.delete("/{approval_id}/attachments/{att_id}")
async def delete_attachment(approval_id: int, att_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.id == att_id, ScheduleApprovalAttachment.approval_id == approval_id))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Pièce jointe non trouvée")
    await db.delete(att)
    await db.commit()
    return {"message": "Pièce jointe supprimée"}
