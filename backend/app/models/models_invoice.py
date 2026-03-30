"""
Soins Expert Plus — Invoice Models (Phase 1 Rewrite)
New tables: Payment, InvoiceAuditLog
Enhanced: Invoice, CreditNote
"""

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Date, DateTime, Text, JSON,
    ForeignKey, Enum as SAEnum, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
import enum
import uuid


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class InvoiceStatus(str, enum.Enum):
    DRAFT = "draft"
    VALIDATED = "validated"
    SENT = "sent"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"
    CANCELLED = "cancelled"


class PaymentMethod(str, enum.Enum):
    CHEQUE = "cheque"
    VIREMENT = "virement"
    EFT = "eft"
    CARTE = "carte"
    AUTRE = "autre"


class AuditAction(str, enum.Enum):
    CREATED = "created"
    UPDATED = "updated"
    STATUS_CHANGE = "status_change"
    PAYMENT_ADDED = "payment_added"
    PAYMENT_DELETED = "payment_deleted"
    CREDIT_NOTE_ADDED = "credit_note_added"
    EMAILED = "emailed"
    PDF_GENERATED = "pdf_generated"
    DUPLICATED = "duplicated"


# ──────────────────────────────────────────────
# Invoice (enhanced)
# ──────────────────────────────────────────────

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    number = Column(String, unique=True, nullable=False, index=True)
    date = Column(Date, nullable=False)

    # Period (Sunday → Saturday)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)

    # Client info (denormalized for PDF)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    client_name = Column(String, nullable=False)
    client_address = Column(String, default="")
    client_email = Column(String, default="")
    client_phone = Column(String, default="")

    # Employee info (1 invoice = 1 resource)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    employee_name = Column(String, default="")
    employee_title = Column(String, default="")  # Infirmier(ère), PAB, Inf. auxiliaire

    # Subtotals
    subtotal_services = Column(Float, default=0.0)
    subtotal_garde = Column(Float, default=0.0)
    subtotal_rappel = Column(Float, default=0.0)
    subtotal_accom = Column(Float, default=0.0)
    subtotal_deplacement = Column(Float, default=0.0)
    subtotal_km = Column(Float, default=0.0)
    subtotal_autres_frais = Column(Float, default=0.0)
    subtotal = Column(Float, default=0.0)

    # Taxes
    include_tax = Column(Boolean, default=True)
    tps = Column(Float, default=0.0)
    tvq = Column(Float, default=0.0)
    total = Column(Float, default=0.0)

    # Payment tracking
    amount_paid = Column(Float, default=0.0)
    balance_due = Column(Float, default=0.0)

    # Status workflow
    status = Column(String, default=InvoiceStatus.DRAFT.value, index=True)

    # Line items (JSON arrays)
    lines = Column(JSON, default=list)
    # Each line: {date, employee, location, start, end, pause_min, hours, rate, service_amount, garde_hours, garde_amount, rappel_hours, rappel_amount}
    
    accommodation_lines = Column(JSON, default=list)
    # Each line: {employee, period, days, cost_per_day, amount}
    
    expense_lines = Column(JSON, default=list)
    # Each line: {type: "deplacement"|"km"|"autre", description, quantity, rate, amount}

    extra_lines = Column(JSON, default=list)
    # Manual extra lines: {description, quantity, rate, amount}

    # Notes & metadata
    notes = Column(Text, default="")
    due_date = Column(Date, nullable=True)
    po_number = Column(String, default="")

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    validated_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    payments = relationship("Payment", back_populates="invoice", cascade="all, delete-orphan",
                            order_by="Payment.date.desc()")
    audit_logs = relationship("InvoiceAuditLog", back_populates="invoice", cascade="all, delete-orphan",
                              order_by="InvoiceAuditLog.created_at.desc()")
    credit_notes = relationship("CreditNote", back_populates="invoice", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_invoice_client_period", "client_id", "period_start", "period_end"),
        Index("ix_invoice_employee_period", "employee_id", "period_start", "period_end"),
    )


# ──────────────────────────────────────────────
# Payment
# ──────────────────────────────────────────────

class Payment(Base):
    __tablename__ = "payments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    invoice_id = Column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    date = Column(Date, nullable=False)
    reference = Column(String, default="")
    method = Column(String, default=PaymentMethod.VIREMENT.value)
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("Invoice", back_populates="payments")


# ──────────────────────────────────────────────
# Invoice Audit Log
# ──────────────────────────────────────────────

class InvoiceAuditLog(Base):
    __tablename__ = "invoice_audit_log"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    invoice_id = Column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String, nullable=False)
    old_status = Column(String, nullable=True)
    new_status = Column(String, nullable=True)
    user_id = Column(Integer, nullable=True)
    user_email = Column(String, default="")
    details = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("Invoice", back_populates="audit_logs")


# ──────────────────────────────────────────────
# Credit Note (enhanced)
# ──────────────────────────────────────────────

class CreditNote(Base):
    __tablename__ = "credit_notes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    number = Column(String, unique=True, nullable=False, index=True)
    invoice_id = Column(String, ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True)
    invoice_number = Column(String, default="")

    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    client_name = Column(String, default="")

    date = Column(Date, nullable=False)
    reason = Column(Text, nullable=False)

    # Amounts
    amount = Column(Float, nullable=False)
    include_tax = Column(Boolean, default=True)
    tps = Column(Float, default=0.0)
    tvq = Column(Float, default=0.0)
    total = Column(Float, default=0.0)

    # Status
    status = Column(String, default="active")  # active, void

    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("Invoice", back_populates="credit_notes")
