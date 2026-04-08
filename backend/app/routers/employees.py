"""Employee routes - CRUD + notes + documents"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models.models import Employee, EmployeeDocument, EmployeeNote
from ..models.schemas import (
    EmployeeCreate,
    EmployeeDocumentOut,
    EmployeeOut,
    EmployeeUpdate,
    NoteCreate,
)
from ..services.auth_service import get_current_user, require_admin

router = APIRouter()

ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/heic",
    "image/heif",
}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _ensure_employee_access(user, employee: Employee):
    if getattr(user, "role", "") == "admin":
        return
    if getattr(user, "employee_id", None) and getattr(user, "employee_id", None) == employee.id:
        return
    raise HTTPException(status_code=403, detail="Acces refuse a ce dossier employe")


@router.get("")
@router.get("/")
async def list_employees(
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    result = await db.execute(
        select(Employee).where(Employee.is_active == True).order_by(Employee.name)
    )
    return [EmployeeOut.model_validate(e) for e in result.scalars().all()]


@router.get("/{eid}")
async def get_employee(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    result = await db.execute(
        select(Employee).options(selectinload(Employee.notes)).where(Employee.id == eid)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    _ensure_employee_access(user, emp)
    return {
        **EmployeeOut.model_validate(emp).model_dump(),
        "notes": [
            {
                "id": n.id,
                "content": n.content,
                "created_at": n.created_at.isoformat(),
                "author": n.author,
            }
            for n in emp.notes
        ],
    }


@router.post("/", status_code=201)
async def create_employee(
    data: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    emp = Employee(**data.model_dump())
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return EmployeeOut.model_validate(emp)


@router.put("/{eid}")
async def update_employee(
    eid: int,
    data: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(emp, key, value)
    await db.commit()
    await db.refresh(emp)
    return EmployeeOut.model_validate(emp)


@router.delete("/{eid}")
async def deactivate_employee(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)
):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    emp.is_active = False
    await db.commit()
    return {"message": "Employe desactive"}


@router.post("/{eid}/notes", status_code=201)
async def add_note(
    eid: int,
    data: NoteCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    note = EmployeeNote(employee_id=eid, content=data.content, author=data.author)
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return {
        "id": note.id,
        "content": note.content,
        "created_at": note.created_at.isoformat(),
        "author": note.author,
    }


@router.get("/{eid}/documents")
async def list_employee_documents(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    emp_result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = emp_result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    _ensure_employee_access(user, emp)

    result = await db.execute(
        select(EmployeeDocument)
        .where(EmployeeDocument.employee_id == eid)
        .order_by(EmployeeDocument.created_at.desc())
    )
    return [
        EmployeeDocumentOut.model_validate(doc).model_dump()
        for doc in result.scalars().all()
    ]


@router.post("/{eid}/documents", status_code=201)
async def upload_employee_document(
    eid: int,
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    emp_result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = emp_result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")

    content_type = file.content_type or ""
    if content_type and content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"Type non supporte: {content_type}")
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (max 10 MB)")

    ext = (
        file.filename.split(".")[-1].lower()
        if file.filename and "." in file.filename
        else ""
    ).strip()
    document = EmployeeDocument(
        employee_id=eid,
        filename=file.filename or "document",
        original_filename=file.filename or "document",
        file_type=ext or (content_type or "bin"),
        file_size=len(data),
        file_data=data,
        category=category,
        description=description,
        uploaded_by=uploaded_by or getattr(user, "email", "admin"),
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return EmployeeDocumentOut.model_validate(document)


@router.get("/{eid}/documents/{doc_id}")
async def get_employee_document(
    eid: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    emp_result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = emp_result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    _ensure_employee_access(user, emp)

    result = await db.execute(
        select(EmployeeDocument).where(
            EmployeeDocument.id == doc_id,
            EmployeeDocument.employee_id == eid,
        )
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document introuvable")

    media_type = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(str(document.file_type).lower(), "application/octet-stream")
    return Response(
        content=document.file_data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{document.original_filename}"'
        },
    )


@router.delete("/{eid}/documents/{doc_id}")
async def delete_employee_document(
    eid: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(EmployeeDocument).where(
            EmployeeDocument.id == doc_id,
            EmployeeDocument.employee_id == eid,
        )
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document introuvable")
    await db.delete(document)
    await db.commit()
    return {"message": "Document supprime"}
