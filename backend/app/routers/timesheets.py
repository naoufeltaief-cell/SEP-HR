"""Timesheet routes — submit, approve, reject"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models.models import Timesheet, TimesheetShift, new_id
from ..models.schemas import TimesheetCreate
from ..services.auth_service import require_admin, get_current_user

router = APIRouter()


@router.get("/")
async def list_timesheets(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    q = select(Timesheet).order_by(Timesheet.created_at.desc())
    if user.role == "employee" and user.employee_id:
        q = q.where(Timesheet.employee_id == user.employee_id)
    result = await db.execute(q)
    timesheets = result.scalars().all()
    out = []
    for ts in timesheets:
        shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == ts.id))
        shifts = [{"id": s.id, "schedule_id": s.schedule_id, "date": s.date.isoformat(), "hours_worked": s.hours_worked,
                    "pause": s.pause, "garde_hours": s.garde_hours, "rappel_hours": s.rappel_hours} for s in shifts_result.scalars().all()]
        out.append({"id": ts.id, "employee_id": ts.employee_id, "period_start": ts.period_start.isoformat(),
                     "period_end": ts.period_end.isoformat(), "status": ts.status, "notes": ts.notes,
                     "shifts": shifts, "created_at": ts.created_at.isoformat()})
    return out


@router.post("/", status_code=201)
async def submit_timesheet(data: TimesheetCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    ts = Timesheet(id=new_id(), employee_id=data.employee_id, period_start=data.period_start,
                   period_end=data.period_end, notes=data.notes)
    db.add(ts)
    for sh in data.shifts:
        shift = TimesheetShift(id=new_id(), timesheet_id=ts.id, schedule_id=sh.schedule_id,
                               date=sh.date, hours_worked=sh.hours_worked, pause=sh.pause,
                               garde_hours=sh.garde_hours, rappel_hours=sh.rappel_hours,
                               start_actual=sh.start_actual, end_actual=sh.end_actual)
        db.add(shift)
    await db.commit()
    return {"id": ts.id, "message": "FDT soumise"}


@router.put("/{tid}/approve")
async def approve_timesheet(tid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    ts.status = "approved"
    await db.commit()
    return {"message": "FDT approuvée"}


@router.put("/{tid}/reject")
async def reject_timesheet(tid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    ts.status = "rejected"
    await db.commit()
    return {"message": "FDT refusée"}


@router.delete("/{tid}")
async def delete_timesheet(tid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Timesheet).where(Timesheet.id == tid))
    ts = result.scalar_one_or_none()
    if not ts:
        raise HTTPException(status_code=404, detail="FDT introuvable")
    # Delete associated shifts first
    shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == tid))
    for shift in shifts_result.scalars().all():
        await db.delete(shift)
    await db.delete(ts)
    await db.commit()
    return {"message": "FDT supprimée"}
