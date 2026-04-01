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
    return {"status": "ok", "service": "Soins Expert Plus API", "version": "2.1.0-serialize-fix"}


@app.get("/api/debug/version")
async def debug_version():
    """Endpoint to verify which code version is deployed"""
    from .routers.invoices import _serialize_invoice
    return {
        "version": "2.1.0",
        "serialize_fix": True,
        "has_serialize_invoice": callable(_serialize_invoice),
    }
