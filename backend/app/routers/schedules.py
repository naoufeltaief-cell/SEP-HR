"""Schedule routes — CRUD with recurrence, publish, bulk operations, week approval"""
from datetime import timedelta, date as date_type, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from ..database import get_db
from ..models.models import Schedule, ScheduleApproval, new_id
from ..models.schemas import ScheduleCreate, ScheduleUpdate, ScheduleOut
from ..services.auth_service import require_admin, get_current_user

router = APIRouter()


@router.get("/")
async def list_schedules(
    start: str = Query(None, description="Start date YYYY-MM-DD"),
    end: str = Query(None, description="End date YYYY-MM-DD"),
    employee_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user)
):
    q = select(Schedule)
    if start:
        q = q.where(Schedule.date >= start)
    if end:
        q = q.where(Schedule.date <= end)
    if employee_id:
        q = q.where(Schedule.employee_id == employee_id)
    if user.role == "employee" and user.employee_id:
        q = q.where(Schedule.employee_id == user.employee_id)
        q = q.where(Schedule.status == "published")
    q = q.order_by(Schedule.date, Schedule.start)
    result = await db.execute(q)
    return [ScheduleOut.model_validate(s) for s in result.scalars().all()]


@router.post("/", status_code=201)
async def create_schedule(data: ScheduleCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    dates = _expand_dates(data)
    group_id = new_id() if len(dates) > 1 else None
    created = []
    for d in dates:
        sched = Schedule(
            id=new_id(), employee_id=data.employee_id, date=d,
            start=data.start, end=data.end, hours=data.hours, pause=data.pause,
            location=data.location, billable_rate=data.billable_rate,
            status=data.status, notes=data.notes, client_id=data.client_id,
            km=data.km, deplacement=data.deplacement, autre_dep=data.autre_dep,
            garde_hours=data.garde_hours, rappel_hours=data.rappel_hours,
            mandat_start=data.mandat_start, mandat_end=data.mandat_end,
            recurrence_group=group_id,
        )
        db.add(sched)
        created.append(sched)
    await db.commit()
    return {"created": len(created), "ids": [s.id for s in created]}


# ── STATIC routes BEFORE /{sid} ──

@router.post("/publish-all")
async def publish_all(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.status == "draft"))
    count = 0
    for sched in result.scalars().all():
        sched.status = "published"
        count += 1
    await db.commit()
    return {"published": count}


@router.post("/approve-week")
async def approve_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    week_start_str = data.get("week_start")
    approved_by = data.get("approved_by", getattr(user, "email", "admin"))
    notes = data.get("notes", "")
    if not all([employee_id, client_id, week_start_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    ws = date_type.fromisoformat(week_start_str)
    if ws.weekday() != 6:
        ws = ws - timedelta(days=(ws.weekday() + 1) % 7)
    we = ws + timedelta(days=6)
    result = await db.execute(select(ScheduleApproval).where(
        ScheduleApproval.employee_id == employee_id,
        ScheduleApproval.client_id == client_id,
        ScheduleApproval.week_start == ws,
    ))
    existing = result.scalar_one_or_none()
    if existing:
        existing.status = "approved"
        existing.approved_by = approved_by
        existing.approved_at = datetime.utcnow()
        existing.notes = notes
        await db.commit()
        await db.refresh(existing)
        return {"id": existing.id, "status": "approved", "message": "Semaine re-approuvee"}
    approval = ScheduleApproval(
        employee_id=employee_id, client_id=client_id,
        week_start=ws, week_end=we,
        approved_by=approved_by, status="approved", notes=notes,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    return {"id": approval.id, "status": "approved", "week_start": str(ws), "week_end": str(we), "message": "Semaine approuvee"}


@router.post("/revoke-week")
async def revoke_week(data: dict, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    employee_id = data.get("employee_id")
    client_id = data.get("client_id")
    ws_str = data.get("week_start")
    if not all([employee_id, client_id, ws_str]):
        raise HTTPException(400, "employee_id, client_id et week_start requis")
    result = await db.execute(select(ScheduleApproval).where(
        ScheduleApproval.employee_id == employee_id,
        ScheduleApproval.client_id == client_id,
        ScheduleApproval.week_start == date_type.fromisoformat(ws_str),
    ))
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(404, "Aucune approbation trouvee")
    approval.status = "rejected"
    await db.commit()
    return {"message": "Approbation revoquee", "status": "rejected"}


@router.get("/approvals")
async def list_approvals(
    employee_id: int = None,
    client_id: int = None,
    week_start: str = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    q = select(ScheduleApproval)
    if employee_id:
        q = q.where(ScheduleApproval.employee_id == employee_id)
    if client_id:
        q = q.where(ScheduleApproval.client_id == client_id)
    if week_start:
        q = q.where(ScheduleApproval.week_start == date_type.fromisoformat(week_start))
    result = await db.execute(q.order_by(ScheduleApproval.week_start.desc()))
    return [
        {
            "id": a.id, "employee_id": a.employee_id, "client_id": a.client_id,
            "week_start": str(a.week_start), "week_end": str(a.week_end),
            "status": a.status, "approved_by": a.approved_by,
            "approved_at": a.approved_at.isoformat() if a.approved_at else None,
            "notes": a.notes,
        }
        for a in result.scalars().all()
    ]


# ── PARAMETERIZED routes /{sid} AFTER static routes ──

@router.put("/{sid}")
async def update_schedule(sid: str, data: ScheduleUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(sched, k, v)
    await db.commit()
    await db.refresh(sched)
    return ScheduleOut.model_validate(sched)


@router.delete("/{sid}")
async def delete_schedule(sid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    await db.delete(sched)
    await db.commit()
    return {"message": "Quart supprime"}


@router.post("/{sid}/publish")
async def publish_one(sid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    sched.status = "published"
    await db.commit()
    return {"message": "Quart publie"}


def _expand_dates(data: ScheduleCreate):
    if not data.recurrence or data.recurrence == "once":
        return [data.date]
    end = data.recurrence_end or data.date + timedelta(days=6)
    dates = []
    d = data.date
    while d <= end:
        if data.recurrence == "daily":
            dates.append(d)
        elif data.recurrence == "weekdays":
            if d.weekday() < 5:
                dates.append(d)
        elif data.recurrence == "custom" and data.recurrence_days:
            py_day = (d.weekday() + 1) % 7
            if py_day in data.recurrence_days:
                dates.append(d)
        d += timedelta(days=1)
    return dates if dates else [data.date]
