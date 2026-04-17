"""
Soins Expert Plus — FastAPI Backend
Full REST API for healthcare staffing platform
"""
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
from sqlalchemy import text

from .database import engine, Base
from .models import models_payroll  # noqa: F401
from .services.automation_service import automation_loop, cancel_automation_task
from .routers import auth, employees, schedules, schedule_reviews, schedule_catalogs, timesheets, invoices, accommodations, clients, chatbot, invoices_approved, invoices_bulk, billing_email, payroll

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS matricule VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS perdiem DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP"))
        await conn.execute(text("UPDATE employees SET matricule = '' WHERE matricule IS NULL"))
        await conn.execute(text("UPDATE employees SET salary = 0 WHERE salary IS NULL"))
        await conn.execute(text("UPDATE employees SET perdiem = 0 WHERE perdiem IS NULL"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_company VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_statement_number VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_transaction_type VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_division VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_service VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_department VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_subdepartment VARCHAR DEFAULT ''"))
        await conn.execute(text("UPDATE employees SET payroll_company = '' WHERE payroll_company IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_statement_number = '' WHERE payroll_statement_number IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_transaction_type = '' WHERE payroll_transaction_type IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_division = '' WHERE payroll_division IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_service = '' WHERE payroll_service IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_department = '' WHERE payroll_department IS NULL"))
        await conn.execute(text("UPDATE employees SET payroll_subdepartment = '' WHERE payroll_subdepartment IS NULL"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_employees_matricule ON employees (matricule)"))
        await conn.execute(text("ALTER TABLE schedule_catalog_items ADD COLUMN IF NOT EXISTS hourly_rate DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE schedule_catalog_items ADD COLUMN IF NOT EXISTS billable_rate DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("UPDATE schedule_catalog_items SET hourly_rate = 0 WHERE hourly_rate IS NULL"))
        await conn.execute(text("UPDATE schedule_catalog_items SET billable_rate = 0 WHERE billable_rate IS NULL"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_token VARCHAR"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_token_expires TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_token_purpose VARCHAR"))
        await conn.execute(text("ALTER TABLE timesheet_shifts ADD COLUMN IF NOT EXISTS km DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE timesheet_shifts ADD COLUMN IF NOT EXISTS deplacement DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE timesheet_shifts ADD COLUMN IF NOT EXISTS autre_dep DOUBLE PRECISION DEFAULT 0"))
        await conn.execute(text("ALTER TABLE timesheet_shifts ADD COLUMN IF NOT EXISTS location VARCHAR DEFAULT ''"))
        await conn.execute(text("ALTER TABLE timesheet_shifts ALTER COLUMN schedule_id DROP NOT NULL"))
        await conn.execute(text("UPDATE timesheet_shifts SET km = 0 WHERE km IS NULL"))
        await conn.execute(text("UPDATE timesheet_shifts SET deplacement = 0 WHERE deplacement IS NULL"))
        await conn.execute(text("UPDATE timesheet_shifts SET autre_dep = 0 WHERE autre_dep IS NULL"))
        await conn.execute(text("UPDATE timesheet_shifts SET location = '' WHERE location IS NULL"))
        await conn.execute(text("ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS visible_to_employee BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("UPDATE employee_documents SET visible_to_employee = FALSE WHERE visible_to_employee IS NULL"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_status VARCHAR DEFAULT 'scheduled'"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_scheduled_for DATE"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_cancelled_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS reminder_last_error TEXT DEFAULT ''"))
        await conn.execute(text("UPDATE accommodations SET reminder_enabled = TRUE WHERE reminder_enabled IS NULL"))
        await conn.execute(text("UPDATE accommodations SET reminder_status = 'scheduled' WHERE reminder_status IS NULL"))
        await conn.execute(text("UPDATE accommodations SET reminder_last_error = '' WHERE reminder_last_error IS NULL"))
    task = asyncio.create_task(automation_loop())
    try:
        yield
    finally:
        await cancel_automation_task(task)

app = FastAPI(
    title="Soins Expert Plus API",
    version="1.0.0",
    description="API pour la gestion du personnel de santé — Soins Expert Plus / 9437-7827 Québec Inc.",
    lifespan=lifespan,
    redirect_slashes=False,
)

cors_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in cors_env.split(",") if o.strip()]
# Always include known frontend URLs
_known_origins = [
    "https://soins-expert-frontend.onrender.com",
    "https://soins-expert-plus.com",
    "http://localhost:5173",
    "http://localhost:3000",
]
for origin in _known_origins:
    if origin not in allowed_origins:
        allowed_origins.append(origin)
if not allowed_origins:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["Schedules"])
app.include_router(schedule_catalogs.router, prefix="/api/schedule-catalogs", tags=["Schedule Catalogs"])
app.include_router(schedule_reviews.router, prefix="/api/schedule-reviews", tags=["Schedule Reviews"])
app.include_router(timesheets.router, prefix="/api/timesheets", tags=["Timesheets"])
app.include_router(billing_email.router, prefix="/api/billing-email", tags=["Billing Email"])
# IMPORTANT: bulk router MUST be included BEFORE the main invoices router
# because routes like /bulk/validate and /bulk/send would otherwise be
# intercepted by /{invoice_id}/validate and /{invoice_id}/send
app.include_router(invoices_bulk.router, prefix="/api/invoices", tags=["Invoices Bulk"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(invoices_approved.router, prefix="/api/invoices-approved", tags=["Invoices Approved"])
app.include_router(payroll.router, prefix="/api/payroll", tags=["Payroll"])
app.include_router(accommodations.router, prefix="/api/accommodations", tags=["Accommodations"])
app.include_router(clients.router, prefix="/api/clients", tags=["Clients"])
app.include_router(chatbot.router, prefix="/api/chatbot", tags=["Chatbot"])

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Soins Expert Plus API", "version": "2.4.0"}


@app.get("/api/debug/invoices")
async def debug_invoices():
    from sqlalchemy import select, desc
    from .models.models_invoice import Invoice
    from .database import async_session
    try:
        async with async_session() as db:
            result = await db.execute(select(Invoice).order_by(desc(Invoice.created_at)).limit(3))
            invoices = result.scalars().all()
            serialized = []
            for inv in invoices:
                try:
                    serialized.append({
                        "id": inv.id,
                        "number": getattr(inv, "number", "?"),
                        "total": getattr(inv, "total", 0),
                        "status": getattr(inv, "status", "?"),
                        "client_name": getattr(inv, "client_name", "?"),
                        "employee_name": getattr(inv, "employee_name", "?"),
                    })
                except Exception as e2:
                    serialized.append({"error": str(e2), "type": type(e2).__name__})
            return {"ok": True, "count": len(invoices), "invoices": serialized}
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e), "type": type(e).__name__, "trace": traceback.format_exc()}


@app.get("/api/debug/schedules")
async def debug_schedules():
    from sqlalchemy import select, func
    from .models.models import Schedule
    from .database import async_session
    try:
        async with async_session() as db:
            total = await db.execute(select(func.count(Schedule.id)))
            total_count = total.scalar()
            with_client = await db.execute(select(func.count(Schedule.id)).where(Schedule.client_id != None))
            with_client_count = with_client.scalar()
            without_client = await db.execute(select(func.count(Schedule.id)).where(Schedule.client_id == None))
            without_client_count = without_client.scalar()
            sample = await db.execute(select(Schedule).limit(5))
            sample_data = [{"id": s.id, "employee_id": s.employee_id, "client_id": s.client_id, "date": str(s.date), "location": s.location} for s in sample.scalars().all()]
            return {"total_schedules": total_count, "with_client_id": with_client_count, "without_client_id": without_client_count, "sample": sample_data}
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}
