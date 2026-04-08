"""Pydantic schemas for request/response validation"""
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Any
from datetime import date, datetime


# ── Auth ──
class LoginRequest(BaseModel):
    email: str
    password: Optional[str] = None

class MagicLinkRequest(BaseModel):
    email: str

class RegisterRequest(BaseModel):
    email: str
    name: str
    password: Optional[str] = None
    role: str = "employee"
    employee_id: Optional[int] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class PasswordSetRequest(BaseModel):
    password: str


# ── Employee ──
class EmployeeCreate(BaseModel):
    name: str
    position: str = ""
    phone: str = ""
    email: str = ""
    rate: float = 0
    client_id: Optional[int] = None

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    rate: Optional[float] = None
    client_id: Optional[int] = None
    is_active: Optional[bool] = None

class EmployeeOut(BaseModel):
    id: int
    name: str
    position: str
    phone: str
    email: str
    rate: float
    client_id: Optional[int]
    is_active: bool
    class Config:
        from_attributes = True

class NoteCreate(BaseModel):
    content: str
    author: str = "Admin"


# ── Client ──
class ClientCreate(BaseModel):
    name: str
    address: str = ""
    email: str = ""
    phone: str = ""
    tax_exempt: bool = False

class ClientUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    tax_exempt: Optional[bool] = None

class ClientOut(BaseModel):
    id: int
    name: str
    address: str
    email: str
    phone: str
    tax_exempt: bool
    class Config:
        from_attributes = True


# ── Schedule ──
class ScheduleCreate(BaseModel):
    employee_id: int
    date: date
    start: str
    end: str
    hours: float
    pause: float = 0
    location: str = ""
    billable_rate: float = 0
    status: str = "draft"
    notes: str = ""
    client_id: Optional[int] = None
    km: float = 0
    deplacement: float = 0
    autre_dep: float = 0
    garde_hours: float = 0
    rappel_hours: float = 0
    mandat_start: Optional[str] = None
    mandat_end: Optional[str] = None
    # Recurrence
    recurrence: Optional[str] = None  # once, weekdays, daily, custom
    recurrence_end: Optional[date] = None
    recurrence_days: Optional[List[int]] = None  # 0=Sun..6=Sat

class ScheduleUpdate(BaseModel):
    date: Optional[date] = None
    start: Optional[str] = None
    end: Optional[str] = None
    hours: Optional[float] = None
    pause: Optional[float] = None
    location: Optional[str] = None
    billable_rate: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    client_id: Optional[int] = None
    km: Optional[float] = None
    deplacement: Optional[float] = None
    autre_dep: Optional[float] = None
    garde_hours: Optional[float] = None
    rappel_hours: Optional[float] = None
    mandat_start: Optional[str] = None
    mandat_end: Optional[str] = None

class ScheduleOut(BaseModel):
    id: str
    employee_id: int
    client_id: Optional[int] = None
    date: date
    start: str
    end: str
    hours: float
    pause: float
    location: str
    billable_rate: float
    status: str
    notes: str
    km: float
    deplacement: float
    autre_dep: float
    garde_hours: float
    rappel_hours: float
    mandat_start: Optional[str]
    mandat_end: Optional[str]
    class Config:
        from_attributes = True


# ── Timesheet ──
class TimesheetShiftCreate(BaseModel):
    schedule_id: str
    date: date
    hours_worked: float
    pause: float = 0
    garde_hours: float = 0
    rappel_hours: float = 0
    start_actual: Optional[str] = None
    end_actual: Optional[str] = None

class TimesheetCreate(BaseModel):
    employee_id: int
    period_start: date
    period_end: date
    notes: str = ""
    shifts: List[TimesheetShiftCreate]

class TimesheetOut(BaseModel):
    id: str
    employee_id: int
    period_start: date
    period_end: date
    status: str
    notes: str
    shifts: List[dict]
    created_at: datetime
    class Config:
        from_attributes = True


# ── Invoice ──
class InvoiceCreate(BaseModel):
    number: str
    date: date
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    client_id: Optional[int] = None
    include_tax: bool = True
    status: str = "draft"
    notes: str = ""
    lines: List[dict] = []
    accommodation_lines: List[dict] = []
    frais_additionnels: List[dict] = []

class InvoiceUpdate(BaseModel):
    number: Optional[str] = None
    date: Optional[date] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    client_id: Optional[int] = None
    include_tax: Optional[bool] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[List[dict]] = None
    accommodation_lines: Optional[List[dict]] = None
    frais_additionnels: Optional[List[dict]] = None

class InvoiceOut(BaseModel):
    id: str
    number: str
    date: date
    period_start: Optional[date]
    period_end: Optional[date]
    client_id: Optional[int]
    client_name: str
    subtotal_services: float
    subtotal_garde: float
    subtotal_rappel: float
    subtotal_accom: float
    subtotal_frais: float
    subtotal: float
    tps: float
    tvq: float
    total: float
    include_tax: bool
    status: str
    notes: str
    lines: List[dict]
    accommodation_lines: List[dict]
    frais_additionnels: List[dict]
    created_at: datetime
    class Config:
        from_attributes = True


# ── Accommodation ──
class AccommodationCreate(BaseModel):
    employee_id: int
    total_cost: float
    start_date: date
    end_date: date
    days_worked: int = 0
    cost_per_day: float = 0
    notes: str = ""

class AccommodationUpdate(BaseModel):
    employee_id: int | None = None
    total_cost: float | None = None
    start_date: date | None = None
    end_date: date | None = None
    days_worked: int | None = None
    cost_per_day: float | None = None
    notes: str | None = None

class AccommodationOut(BaseModel):
    id: str
    employee_id: int
    total_cost: float
    start_date: date
    end_date: date
    days_worked: int
    cost_per_day: float
    notes: str
    class Config:
        from_attributes = True


# ── Chatbot ──
class ChatMessage(BaseModel):
    message: str
    history: List[dict] = []
