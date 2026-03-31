"""
Soins Expert Plus — Invoice Pydantic Schemas (Phase 1)
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from enum import Enum


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class InvoiceStatusEnum(str, Enum):
    draft = "draft"
    validated = "validated"
    sent = "sent"
    partially_paid = "partially_paid"
    paid = "paid"
    cancelled = "cancelled"


class PaymentMethodEnum(str, Enum):
    cheque = "cheque"
    virement = "virement"
    eft = "eft"
    carte = "carte"
    autre = "autre"


# ──────────────────────────────────────────────
# Invoice Line Items
# ──────────────────────────────────────────────

class InvoiceServiceLine(BaseModel):
    date: str = ""
    employee: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    pause_min: float = 0
    hours: float = 0
    rate: float = 0
    service_amount: float = 0
    garde_hours: float = 0
    garde_amount: float = 0
    rappel_hours: float = 0
    rappel_amount: float = 0


class InvoiceAccommodationLine(BaseModel):
    employee: str = ""
    period: str = ""
    days: float = 0
    cost_per_day: float = 0
    amount: float = 0


class InvoiceExpenseLine(BaseModel):
    type: str = ""  # deplacement, km, autre
    description: str = ""
    quantity: float = 0
    rate: float = 0
    amount: float = 0


class InvoiceExtraLine(BaseModel):
    description: str = ""
    quantity: float = 1
    rate: float = 0
    amount: float = 0


# ──────────────────────────────────────────────
# Invoice CRUD
# ──────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    """Used for manual invoice creation"""
    client_id: Optional[int] = None
    employee_id: Optional[int] = None
    period_start: date
    period_end: date
    include_tax: bool = True
    notes: str = ""
    po_number: str = ""
    due_date: Optional[date] = None
    lines: List[InvoiceServiceLine] = []
    accommodation_lines: List[InvoiceAccommodationLine] = []
    expense_lines: List[InvoiceExpenseLine] = []
    extra_lines: List[InvoiceExtraLine] = []


class InvoiceUpdate(BaseModel):
    """Update editable fields (only in draft status)"""
    client_id: Optional[int] = None
    employee_id: Optional[int] = None
    include_tax: Optional[bool] = None
    notes: Optional[str] = None
    po_number: Optional[str] = None
    due_date: Optional[date] = None
    lines: Optional[List[InvoiceServiceLine]] = None
    accommodation_lines: Optional[List[InvoiceAccommodationLine]] = None
    expense_lines: Optional[List[InvoiceExpenseLine]] = None
    extra_lines: Optional[List[InvoiceExtraLine]] = None


class InvoiceGenerateRequest(BaseModel):
    """Generate invoices from timesheets for a period"""
    period_start: date
    period_end: date
    client_id: Optional[int] = None  # None = all clients
    employee_id: Optional[int] = None  # None = all employees


class InvoiceStatusChange(BaseModel):
    new_status: InvoiceStatusEnum
    notes: str = ""


# ──────────────────────────────────────────────
# Invoice Response
# ──────────────────────────────────────────────

class PaymentResponse(BaseModel):
    id: str
    invoice_id: str
    amount: float
    date: date
    reference: str = ""
    method: str = "virement"
    notes: str = ""
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    id: str
    invoice_id: str
    action: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    user_email: str = ""
    details: str = ""
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreditNoteResponse(BaseModel):
    id: str
    number: str
    invoice_id: Optional[str] = None
    invoice_number: str = ""
    client_id: Optional[int] = None
    client_name: str = ""
    date: date
    reason: str
    amount: float
    include_tax: bool = True
    tps: float = 0
    tvq: float = 0
    total: float = 0
    status: str = "active"
    notes: str = ""
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InvoiceResponse(BaseModel):
    id: str
    number: str
    date: date
    period_start: date
    period_end: date
    client_id: Optional[int] = None
    client_name: str = ""
    client_address: str = ""
    client_email: str = ""
    client_phone: str = ""
    employee_id: Optional[int] = None
    employee_name: str = ""
    employee_title: str = ""
    subtotal_services: float = 0
    subtotal_garde: float = 0
    subtotal_rappel: float = 0
    subtotal_accom: float = 0
    subtotal_deplacement: float = 0
    subtotal_km: float = 0
    subtotal_autres_frais: float = 0
    subtotal: float = 0
    include_tax: bool = True
    tps: float = 0
    tvq: float = 0
    total: float = 0
    amount_paid: float = 0
    balance_due: float = 0
    status: str = "draft"
    lines: list = []
    accommodation_lines: list = []
    expense_lines: list = []
    extra_lines: list = []
    notes: str = ""
    due_date: Optional[date] = None
    po_number: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    validated_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    payments: List[PaymentResponse] = []
    audit_logs: List[AuditLogResponse] = []
    credit_notes: List[CreditNoteResponse] = []

    class Config:
        from_attributes = True


class InvoiceListResponse(BaseModel):
    """Lightweight version for list views"""
    id: str
    number: str
    date: date
    period_start: date
    period_end: date
    client_name: str = ""
    employee_name: str = ""
    employee_title: str = ""
    subtotal: float = 0
    total: float = 0
    amount_paid: float = 0
    balance_due: float = 0
    status: str = "draft"
    include_tax: bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────
# Payment CRUD
# ──────────────────────────────────────────────

class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    date: date
    reference: str = ""
    method: PaymentMethodEnum = PaymentMethodEnum.virement
    notes: str = ""


# ──────────────────────────────────────────────
# Credit Note CRUD
# ──────────────────────────────────────────────

class CreditNoteCreate(BaseModel):
    invoice_id: Optional[str] = None
    client_id: Optional[int] = None
    reason: str
    amount: float = Field(..., gt=0)
    include_tax: bool = True
    notes: str = ""


# ──────────────────────────────────────────────
# Report schemas
# ──────────────────────────────────────────────

class ClientInvoiceSummary(BaseModel):
    client_id: int
    client_name: str
    total_invoiced: float = 0
    total_paid: float = 0
    total_outstanding: float = 0
    total_overdue: float = 0
    invoice_count: int = 0
    invoices: List[InvoiceListResponse] = []


class RevenueReportRow(BaseModel):
    period: str
    services: float = 0
    garde: float = 0
    rappel: float = 0
    accommodation: float = 0
    expenses: float = 0
    subtotal: float = 0
    taxes: float = 0
    total: float = 0


class AnomalyItem(BaseModel):
    invoice_id: str
    invoice_number: str
    type: str  # duplicate, excessive_hours, rate_mismatch, no_client
    description: str
    severity: str = "warning"  # warning, error
