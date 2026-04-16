"""Employee routes - CRUD + notes + documents"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models.models import (
    Employee,
    EmployeeDocument,
    EmployeeNote,
    SharedEmployeeDocument,
    User,
)
from ..models.schemas import (
    EmployeeCreate,
    EmployeeDocumentOut,
    EmployeeOut,
    EmployeeUpdate,
    NoteCreate,
    SharedEmployeeDocumentOut,
)
from ..services.auth_service import generate_magic_token, get_current_user, require_admin
from ..services.email_service import send_employee_portal_invitation

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
PORTAL_INVITE_EXPIRE_HOURS = 72


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _serialize_employment_status(employee: Employee) -> dict:
    deactivated_at = getattr(employee, "deactivated_at", None)
    reactivated_at = getattr(employee, "reactivated_at", None)
    status = "active"
    if not bool(employee.is_active):
        status = "inactive"
    elif reactivated_at and (not deactivated_at or reactivated_at >= deactivated_at):
        status = "reactivated"
    return {
        "status": status,
        "is_active": bool(employee.is_active),
        "deactivated_at": deactivated_at.isoformat() if deactivated_at else None,
        "reactivated_at": reactivated_at.isoformat() if reactivated_at else None,
    }


def _apply_employee_activation_state(emp: Employee, is_active: bool | None):
    if is_active is None:
        return
    was_active = bool(emp.is_active)
    next_active = bool(is_active)
    if was_active == next_active:
        return
    emp.is_active = next_active
    if next_active:
        emp.reactivated_at = datetime.utcnow()
    else:
        emp.deactivated_at = datetime.utcnow()


def _parse_form_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on", "oui"}


def _serialize_portal_access(portal_user: User | None) -> dict:
    if not portal_user:
        return {
            "enabled": False,
            "email": "",
            "user_id": None,
            "invitation_pending": False,
            "password_enabled": False,
        }
    return {
        "enabled": True,
        "email": portal_user.email or "",
        "user_id": portal_user.id,
        "invitation_pending": bool(
            (
                portal_user.password_token
                and portal_user.password_token_expires
                and portal_user.password_token_expires >= datetime.utcnow()
            )
            or (
                portal_user.magic_token
                and portal_user.magic_token_expires
                and portal_user.magic_token_expires >= datetime.utcnow()
            )
        ),
        "password_enabled": bool(portal_user.password_hash),
    }


async def _find_portal_user(db: AsyncSession, employee_id: int) -> User | None:
    result = await db.execute(select(User).where(User.employee_id == employee_id))
    return result.scalar_one_or_none()


async def _provision_employee_portal_access(
    db: AsyncSession,
    employee: Employee,
    invite: bool = False,
):
    email = _normalize_email(getattr(employee, "email", ""))
    if not email:
        return {
            "portal_user": None,
            "created": False,
            "updated": False,
            "invited": False,
            "invite_token": None,
        }

    linked_user = await _find_portal_user(db, employee.id)
    email_result = await db.execute(select(User).where(User.email == email))
    email_user = email_result.scalar_one_or_none()

    if email_user and email_user.role == "admin" and email_user.employee_id != employee.id:
        raise HTTPException(
            status_code=400,
            detail="Ce courriel est deja utilise par un compte administrateur",
        )

    portal_user = linked_user
    created = False
    updated = False

    if portal_user:
        if email_user and email_user.id != portal_user.id:
            raise HTTPException(
                status_code=400,
                detail="Ce courriel est deja rattache a un autre compte employe",
            )
    elif email_user:
        if email_user.employee_id not in (None, employee.id):
            raise HTTPException(
                status_code=400,
                detail="Ce courriel est deja rattache a un autre employe",
            )
        portal_user = email_user
        if portal_user.employee_id != employee.id:
            portal_user.employee_id = employee.id
            updated = True
    else:
        portal_user = User(
            email=email,
            name=employee.name,
            role="employee",
            employee_id=employee.id,
            is_active=bool(employee.is_active),
        )
        db.add(portal_user)
        await db.flush()
        created = True

    if portal_user.email != email:
        portal_user.email = email
        updated = True
    if portal_user.name != employee.name:
        portal_user.name = employee.name
        updated = True
    if portal_user.employee_id != employee.id:
        portal_user.employee_id = employee.id
        updated = True
    if portal_user.role != "employee":
        portal_user.role = "employee"
        updated = True
    if portal_user.is_active != bool(employee.is_active):
        portal_user.is_active = bool(employee.is_active)
        updated = True

    invite_token = None
    invite_purpose = "setup"
    if invite:
        invite_token = generate_magic_token()
        invite_purpose = "setup" if not portal_user.password_hash else "reset"
        portal_user.password_token = invite_token
        portal_user.password_token_expires = datetime.utcnow() + timedelta(
            hours=PORTAL_INVITE_EXPIRE_HOURS
        )
        portal_user.password_token_purpose = invite_purpose

    return {
        "portal_user": portal_user,
        "created": created,
        "updated": updated,
        "invited": bool(invite_token),
        "invite_token": invite_token,
        "invite_purpose": invite_purpose,
    }


def _ensure_employee_access(user, employee: Employee):
    if getattr(user, "role", "") == "admin":
        return
    if getattr(user, "employee_id", None) and getattr(user, "employee_id", None) == employee.id:
        return
    raise HTTPException(status_code=403, detail="Acces refuse a ce dossier employe")


async def _ensure_shared_document_access(db: AsyncSession, user):
    if getattr(user, "role", "") == "admin":
        return
    employee_id = getattr(user, "employee_id", None)
    if not employee_id:
        raise HTTPException(status_code=403, detail="Acces refuse aux documents partages")
    employee_result = await db.execute(select(Employee).where(Employee.id == employee_id))
    employee = employee_result.scalar_one_or_none()
    if not employee or not bool(getattr(employee, "is_active", False)):
        raise HTTPException(status_code=403, detail="Acces refuse aux documents partages")


async def _read_upload_payload(file: UploadFile) -> tuple[bytes, str, str]:
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
    return data, content_type, ext


def _document_media_type(file_type: str | None) -> str:
    return {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(str(file_type or "").lower(), "application/octet-stream")


async def _send_portal_invite_or_capture_error(
    db: AsyncSession,
    email: str,
    invite_token: str | None,
    name: str,
    purpose: str = "setup",
) -> str | None:
    if not invite_token:
        return None
    try:
        await send_employee_portal_invitation(
            email,
            invite_token,
            name,
            expires_hours=PORTAL_INVITE_EXPIRE_HOURS,
            purpose=purpose,
            db=db,
        )
        return None
    except Exception as exc:
        return str(exc)


@router.get("")
@router.get("/")
async def list_employees(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    query = select(Employee)
    if getattr(user, "role", "") != "admin" and not include_inactive:
        query = query.where(Employee.is_active == True)
    elif getattr(user, "role", "") == "admin" and not include_inactive:
        query = query.where(Employee.is_active == True)
    query = query.order_by(Employee.is_active.desc(), Employee.name)
    if getattr(user, "role", "") == "employee":
        if getattr(user, "employee_id", None):
            query = query.where(Employee.id == user.employee_id)
        else:
            return []
    result = await db.execute(query)
    employees = result.scalars().all()
    employee_ids = [employee.id for employee in employees]
    portal_by_employee = {}
    if employee_ids:
        portal_result = await db.execute(select(User).where(User.employee_id.in_(employee_ids)))
        portal_by_employee = {
            portal_user.employee_id: portal_user
            for portal_user in portal_result.scalars().all()
            if portal_user.employee_id is not None
        }
    return [
        {
            **EmployeeOut.model_validate(employee).model_dump(),
            "portal_access": _serialize_portal_access(portal_by_employee.get(employee.id)),
            "employment_status": _serialize_employment_status(employee),
        }
        for employee in employees
    ]


@router.get("/shared-documents")
async def list_shared_employee_documents(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await _ensure_shared_document_access(db, user)
    result = await db.execute(
        select(SharedEmployeeDocument).order_by(SharedEmployeeDocument.created_at.desc())
    )
    return [
        SharedEmployeeDocumentOut.model_validate(document).model_dump()
        for document in result.scalars().all()
    ]


@router.post("/shared-documents", status_code=201)
async def upload_shared_employee_document(
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    data, content_type, ext = await _read_upload_payload(file)
    document = SharedEmployeeDocument(
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
    return SharedEmployeeDocumentOut.model_validate(document)


@router.get("/shared-documents/{doc_id}")
async def get_shared_employee_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await _ensure_shared_document_access(db, user)
    result = await db.execute(
        select(SharedEmployeeDocument).where(SharedEmployeeDocument.id == doc_id)
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document partage introuvable")
    return Response(
        content=document.file_data,
        media_type=_document_media_type(document.file_type),
        headers={
            "Content-Disposition": f'attachment; filename="{document.original_filename}"'
        },
    )


@router.delete("/shared-documents/{doc_id}")
async def delete_shared_employee_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(SharedEmployeeDocument).where(SharedEmployeeDocument.id == doc_id)
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document partage introuvable")
    await db.delete(document)
    await db.commit()
    return {"message": "Document partage supprime"}


@router.put("/shared-documents/{doc_id}/replace")
async def replace_shared_employee_document(
    doc_id: int,
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str = Form(""),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(
        select(SharedEmployeeDocument).where(SharedEmployeeDocument.id == doc_id)
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document partage introuvable")

    data, content_type, ext = await _read_upload_payload(file)
    document.filename = file.filename or document.filename
    document.original_filename = file.filename or document.original_filename
    document.file_type = ext or (content_type or document.file_type or "bin")
    document.file_size = len(data)
    document.file_data = data
    document.category = category
    document.description = description
    document.uploaded_by = uploaded_by or getattr(user, "email", "admin")
    document.created_at = datetime.utcnow()
    await db.commit()
    await db.refresh(document)
    return SharedEmployeeDocumentOut.model_validate(document)


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
    portal_user = await _find_portal_user(db, emp.id)
    return {
        **EmployeeOut.model_validate(emp).model_dump(),
        "portal_access": _serialize_portal_access(portal_user),
        "employment_status": _serialize_employment_status(emp),
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
    _apply_employee_activation_state(emp, emp.is_active)
    db.add(emp)
    await db.flush()
    await db.refresh(emp)
    should_invite = bool(_normalize_email(emp.email))
    provision = await _provision_employee_portal_access(
        db,
        emp,
        invite=should_invite,
    )
    await db.commit()
    await db.refresh(emp)
    portal_invite_error = await _send_portal_invite_or_capture_error(
        db,
        emp.email,
        provision["invite_token"],
        emp.name,
        provision.get("invite_purpose", "setup"),
    )
    return {
        **EmployeeOut.model_validate(emp).model_dump(),
        "portal_access": _serialize_portal_access(provision["portal_user"]),
        "employment_status": _serialize_employment_status(emp),
        "portal_user_created": provision["created"],
        "portal_invited": bool(provision["invited"] and not portal_invite_error),
        "portal_invite_error": portal_invite_error,
    }


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
    previous_email = _normalize_email(emp.email)
    updates = data.model_dump(exclude_unset=True)
    next_is_active = updates.pop("is_active", None)
    for key, value in updates.items():
        setattr(emp, key, value)
    _apply_employee_activation_state(emp, next_is_active)
    next_email = _normalize_email(emp.email)
    should_invite = bool(next_email) and next_email != previous_email
    provision = await _provision_employee_portal_access(
        db,
        emp,
        invite=should_invite,
    )
    await db.commit()
    await db.refresh(emp)
    portal_invite_error = await _send_portal_invite_or_capture_error(
        db,
        emp.email,
        provision["invite_token"],
        emp.name,
        provision.get("invite_purpose", "setup"),
    )
    return {
        **EmployeeOut.model_validate(emp).model_dump(),
        "portal_access": _serialize_portal_access(provision["portal_user"]),
        "employment_status": _serialize_employment_status(emp),
        "portal_user_created": provision["created"],
        "portal_invited": bool(provision["invited"] and not portal_invite_error),
        "portal_invite_error": portal_invite_error,
    }


@router.post("/{eid}/deactivate")
async def deactivate_employee_explicit(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)
):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    _apply_employee_activation_state(emp, False)
    portal_user = await _find_portal_user(db, emp.id)
    if portal_user:
        portal_user.is_active = False
    await db.commit()
    return {"message": "Employe desactive", "employment_status": _serialize_employment_status(emp)}


@router.post("/{eid}/reactivate")
async def reactivate_employee(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)
):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    _apply_employee_activation_state(emp, True)
    portal_user = await _find_portal_user(db, emp.id)
    if portal_user:
        portal_user.is_active = True
    await db.commit()
    return {"message": "Employe reactive", "employment_status": _serialize_employment_status(emp)}


@router.delete("/{eid}")
async def deactivate_employee(
    eid: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)
):
    return await deactivate_employee_explicit(eid=eid, db=db, user=user)


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


@router.post("/{eid}/invite-access")
async def invite_employee_access(
    eid: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    if not _normalize_email(emp.email):
        raise HTTPException(status_code=400, detail="Le courriel de l'employe est requis")

    provision = await _provision_employee_portal_access(db, emp, invite=True)
    await db.commit()
    portal_invite_error = await _send_portal_invite_or_capture_error(
        db,
        emp.email,
        provision["invite_token"],
        emp.name,
        provision.get("invite_purpose", "setup"),
    )
    if portal_invite_error:
        raise HTTPException(status_code=502, detail=portal_invite_error)
    return {
        "message": "Invitation employee envoyee",
        "portal_access": _serialize_portal_access(provision["portal_user"]),
        "portal_user_created": provision["created"],
        "portal_invited": provision["invited"],
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
    documents = result.scalars().all()
    if getattr(user, "role", "") == "employee":
        documents = [doc for doc in documents if bool(getattr(doc, "visible_to_employee", False))]
    return [
        EmployeeDocumentOut.model_validate(doc).model_dump()
        for doc in documents
    ]


@router.post("/{eid}/documents", status_code=201)
async def upload_employee_document(
    eid: int,
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str = Form(""),
    visible_to_employee: str = Form("false"),
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
        visible_to_employee=_parse_form_bool(visible_to_employee, False),
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
    if getattr(user, "role", "") == "employee" and not bool(getattr(document, "visible_to_employee", False)):
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


@router.put("/{eid}/documents/{doc_id}/replace")
async def replace_employee_document(
    eid: int,
    doc_id: int,
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str = Form(""),
    visible_to_employee: str = Form("false"),
    uploaded_by: str = Form("admin"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    emp_result = await db.execute(select(Employee).where(Employee.id == eid))
    emp = emp_result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employe introuvable")

    result = await db.execute(
        select(EmployeeDocument).where(
            EmployeeDocument.id == doc_id,
            EmployeeDocument.employee_id == eid,
        )
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document introuvable")

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
    document.filename = file.filename or document.filename
    document.original_filename = file.filename or document.original_filename
    document.file_type = ext or (content_type or document.file_type or "bin")
    document.file_size = len(data)
    document.file_data = data
    document.category = category
    document.description = description
    document.visible_to_employee = _parse_form_bool(visible_to_employee, bool(getattr(document, "visible_to_employee", False)))
    document.uploaded_by = uploaded_by or getattr(user, "email", "admin")
    document.created_at = datetime.utcnow()
    await db.commit()
    await db.refresh(document)
    return EmployeeDocumentOut.model_validate(document)
