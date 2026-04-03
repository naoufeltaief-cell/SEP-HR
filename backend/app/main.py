"""
Soins Expert Plus — FastAPI Backend
Full REST API for healthcare staffing platform
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from .database import engine, Base
from .routers import auth, employees, schedules, schedule_reviews, timesheets, invoices, accommodations, clients, chatbot, invoices_approved, invoices_bulk

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

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
app.include_router(schedule_reviews.router, prefix="/api/schedule-reviews", tags=["Schedule Reviews"])
app.include_router(timesheets.router, prefix="/api/timesheets", tags=["Timesheets"])
# IMPORTANT: bulk router MUST be included BEFORE the main invoices router
# because routes like /bulk/validate and /bulk/send would otherwise be
# intercepted by /{invoice_id}/validate and /{invoice_id}/send
app.include_router(invoices_bulk.router, prefix="/api/invoices", tags=["Invoices Bulk"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(invoices_approved.router, prefix="/api/invoices-approved", tags=["Invoices Approved"])
app.include_router(accommodations.router, prefix="/api/accommodations", tags=["Accommodations"])
app.include_router(clients.router, prefix="/api/clients", tags=["Clients"])
app.include_router(chatbot.router, prefix="/api/chatbot", tags=["Chatbot"])

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Soins Expert Plus API", "version": "2.3.1"}


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
