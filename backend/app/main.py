"""
Soins Expert Plus — FastAPI Backend
Full REST API for healthcare staffing platform
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import engine, Base
from .routers import auth, employees, schedules, timesheets, invoices, accommodations, clients, chatbot, invoices_approved

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(
    title="Soins Expert Plus API",
    version="1.0.0",
    description="API pour la gestion du personnel de santé — Soins Expert Plus / 9437-7827 Québec Inc.",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["Schedules"])
app.include_router(timesheets.router, prefix="/api/timesheets", tags=["Timesheets"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(invoices_approved.router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(accommodations.router, prefix="/api/accommodations", tags=["Accommodations"])
app.include_router(clients.router, prefix="/api/clients", tags=["Clients"])
app.include_router(chatbot.router, prefix="/api/chatbot", tags=["Chatbot"])

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Soins Expert Plus API", "version": "2.3.0"}


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
            sample_data = [
                {"id": s.id, "employee_id": s.employee_id, "client_id": s.client_id, "date": str(s.date), "location": s.location}
                for s in sample.scalars().all()
            ]
            return {
                "total_schedules": total_count,
                "with_client_id": with_client_count,
                "without_client_id": without_client_count,
                "sample": sample_data,
            }
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}
