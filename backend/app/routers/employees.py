"""Employee routes — CRUD + notes"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from ..database import get_db
from ..models.models import Employee, EmployeeNote
from ..models.schemas import EmployeeCreate, EmployeeUpdate, EmployeeOut, NoteCreate
from ..services.auth_service import require_admin, get_current_user

router = APIRouter()


@router.get("")
@router.get("/")
async def list_employees(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(
        select(Employee).where(Employee.is_active == True).order_by(Employee.name)
    )
    return [EmployeeOut.model_validate(e) for e in result.scalars().all()]


@router.get("/{eid}")
async def get_employee(eid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(
        select(Employee).options(selectinload(Employee.notes)).where(Employee.id == eid)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    return {
        **EmployeeOut.model_validate(emp).model_dump(),
        "notes": [{"id": n.id, "content": n.content, "created_at": n.created_at.isoformat(), "author": n.author} for n in emp.notes]
    }


@router.post("/", status_code=201)
async def create_employee(data: EmployeeCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    emp = Employee(**data.model_dump())
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return EmployeeOut.model_validate(emp)


@router.put("/{eid}")
async def update_employee(eid: int, data: EmployeeUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(emp, k, v)
    await db.commit()
    await db.refresh(emp)
    return EmployeeOut.model_validate(emp)


@router.delete("/{eid}")
async def deactivate_employee(eid: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    emp.is_active = False
    await db.commit()
    return {"message": "Employé désactivé"}


@router.post("/{eid}/notes", status_code=201)
async def add_note(eid: int, data: NoteCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    note = EmployeeNote(employee_id=eid, content=data.content, author=data.author)
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return {"id": note.id, "content": note.content, "created_at": note.created_at.isoformat(), "author": note.author}
