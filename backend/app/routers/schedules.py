"""Schedule routes — CRUD with recurrence, publish, bulk operations"""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from ..database import get_db
from ..models.models import Schedule, new_id
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
    # If employee portal, restrict to their own
    if user.role == "employee" and user.employee_id:
        q = q.where(Schedule.employee_id == user.employee_id)
        q = q.where(Schedule.status == "published")
    q = q.order_by(Schedule.date, Schedule.start)
    result = await db.execute(q)
    return [ScheduleOut.model_validate(s) for s in result.scalars().all()]


@router.post("/", status_code=201)
async def create_schedule(data: ScheduleCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    """Create schedule(s) — supports recurrence"""
    dates = _expand_dates(data)
    group_id = new_id() if len(dates) > 1 else None
    created = []
    for d in dates:
        sched = Schedule(
            id=new_id(),
            employee_id=data.employee_id,
            date=d,
            start=data.start,
            end=data.end,
            hours=data.hours,
            pause=data.pause,
            location=data.location,
            billable_rate=data.billable_rate,
            status=data.status,
            notes=data.notes,
            client_id=data.client_id,
            km=data.km,
            deplacement=data.deplacement,
            autre_dep=data.autre_dep,
            mandat_start=data.mandat_start,
            mandat_end=data.mandat_end,
            recurrence_group=group_id,
        )
        db.add(sched)
        created.append(sched)
    await db.commit()
    return {"created": len(created), "ids": [s.id for s in created]}


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
    return {"message": "Quart supprimé"}


@router.post("/publish-all")
async def publish_all(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.status == "draft"))
    count = 0
    for sched in result.scalars().all():
        sched.status = "published"
        count += 1
    await db.commit()
    return {"published": count}


@router.post("/{sid}/publish")
async def publish_one(sid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Schedule).where(Schedule.id == sid))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Quart introuvable")
    sched.status = "published"
    await db.commit()
    return {"message": "Quart publié"}


def _expand_dates(data: ScheduleCreate):
    """Expand recurrence into list of dates"""
    if not data.recurrence or data.recurrence == "once":
        return [data.date]
    end = data.recurrence_end or data.date + timedelta(days=6)
    dates = []
    d = data.date
    while d <= end:
        if data.recurrence == "daily":
            dates.append(d)
        elif data.recurrence == "weekdays":
            if d.weekday() < 5:  # Mon-Fri
                dates.append(d)
        elif data.recurrence == "custom" and data.recurrence_days:
            # recurrence_days: 0=Sun, 1=Mon...6=Sat (JS convention)
            py_day = (d.weekday() + 1) % 7  # convert Python weekday to JS
            if py_day in data.recurrence_days:
                dates.append(d)
        d += timedelta(days=1)
    return dates if dates else [data.date]
