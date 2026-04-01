"""
Soins Expert Plus — FastAPI Backend
Full REST API for healthcare staffing platform
"""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from .database import engine, Base, get_db
from .routers import auth, employees, schedules, timesheets, invoices, accommodations, clients, chatbot

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
app.include_router(accommodations.router, prefix="/api/accommodations", tags=["Accommodations"])
app.include_router(clients.router, prefix="/api/clients", tags=["Clients"])
app.include_router(chatbot.router, prefix="/api/chatbot", tags=["Chatbot"])

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Soins Expert Plus API", "version": "2.2.0"}


@app.get("/api/debug/invoices")
async def debug_invoices():
    """Debug: test invoice list without auth — shows exact error if any."""
    from sqlalchemy import select, desc
    from .models.models_invoice import Invoice
    from .database import async_session
    try:
        async with async_session() as db:
            result = await db.execute(
                select(Invoice).order_by(desc(Invoice.created_at)).limit(3)
            )
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
