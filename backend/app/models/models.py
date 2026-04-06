"""SQLAlchemy models — all entities for Soins Expert Plus"""
import uuid
from datetime import datetime, date, time
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Date, Time, DateTime,
    Text, ForeignKey, Enum as SAEnum, JSON, LargeBinary, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from ..database import Base
import enum


def new_id():
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    admin = "admin"
    employee = "employee"


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=new_id)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=True)  # nullable for magic-link-only users
    role = Column(String, default="employee")
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    magic_token = Column(String, nullable=True)
    magic_token_expires = Column(DateTime, nullable=True)


class BillingEmailConnection(Base):
    __tablename__ = "billing_email_connections"
    id = Column(String, primary_key=True, default=new_id)
    provider = Column(String, default="gmail", nullable=False)
    purpose = Column(String, default="billing", nullable=False, unique=True, index=True)
    email = Column(String, default="", nullable=False)
    access_token = Column(Text, default="")
    refresh_token = Column(Text, default="")
    token_expires_at = Column(DateTime, nullable=True)
    scope = Column(Text, default="")
    connected_by = Column(String, default="")
    is_active = Column(Boolean, default=True)
    last_error = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Employee(Base):
    __tablename__ = "employees"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    position = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    rate = Column(Float, default=0)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    notes = relationship("EmployeeNote", back_populates="employee", order_by="desc(EmployeeNote.created_at)")
    schedules = relationship("Schedule", back_populates="employee")


class EmployeeNote(Base):
    __tablename__ = "employee_notes"
    id = Column(String, primary_key=True, default=new_id)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    author = Column(String, default="Admin")
    employee = relationship("Employee", back_populates="notes")


class Client(Base):
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    address = Column(String, default="")
    email = Column(String, default="")
    phone = Column(String, default="")
    tax_exempt = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)


class Schedule(Base):
    __tablename__ = "schedules"
    id = Column(String, primary_key=True, default=new_id)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    start = Column(String, nullable=False)  # "07:00"
    end = Column(String, nullable=False)    # "15:00"
    hours = Column(Float, nullable=False)
    pause = Column(Float, default=0)
    location = Column(String, default="")
    billable_rate = Column(Float, default=0)
    status = Column(String, default="draft")  # draft, published
    notes = Column(Text, default="")
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    km = Column(Float, default=0)
    deplacement = Column(Float, default=0)
    autre_dep = Column(Float, default=0)
    mandat_start = Column(String, nullable=True)
    mandat_end = Column(String, nullable=True)
    garde_hours = Column(Float, default=0)
    rappel_hours = Column(Float, default=0)
    recurrence_group = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    employee = relationship("Employee", back_populates="schedules")


class Timesheet(Base):
    __tablename__ = "timesheets"
    id = Column(String, primary_key=True, default=new_id)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    status = Column(String, default="submitted")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    shifts = relationship("TimesheetShift", back_populates="timesheet", cascade="all, delete-orphan")


class TimesheetShift(Base):
    __tablename__ = "timesheet_shifts"
    id = Column(String, primary_key=True, default=new_id)
    timesheet_id = Column(String, ForeignKey("timesheets.id"), nullable=False)
    schedule_id = Column(String, ForeignKey("schedules.id"), nullable=False)
    date = Column(Date, nullable=False)
    hours_worked = Column(Float, nullable=False)
    pause = Column(Float, default=0)
    garde_hours = Column(Float, default=0)
    rappel_hours = Column(Float, default=0)
    start_actual = Column(String, nullable=True)
    end_actual = Column(String, nullable=True)
    timesheet = relationship("Timesheet", back_populates="shifts")


class Accommodation(Base):
    __tablename__ = "accommodations"
    id = Column(String, primary_key=True, default=new_id)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    total_cost = Column(Float, default=0)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    days_worked = Column(Integer, default=0)
    cost_per_day = Column(Float, default=0)
    pdf_name = Column(String, default="")
    notes = Column(Text, default="")


class AccommodationAttachment(Base):
    __tablename__ = "accommodation_attachments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    accommodation_id = Column(String, ForeignKey("accommodations.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_size = Column(Integer, default=0)
    file_data = Column(LargeBinary, nullable=False)
    category = Column(String(50), default="hebergement")
    description = Column(Text, default="")
    uploaded_by = Column(String(255), default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)


from .models_invoice import Invoice, Payment, InvoiceAuditLog, CreditNote


class ScheduleApproval(Base):
    __tablename__ = "schedule_approvals"
    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    week_start = Column(Date, nullable=False)
    week_end = Column(Date, nullable=False)
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), default="pending")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("employee_id", "client_id", "week_start", name="uq_approval_emp_client_week"),
    )
    employee = relationship("Employee", backref="schedule_approvals")
    client = relationship("Client", backref="schedule_approvals")


class InvoiceAttachment(Base):
    __tablename__ = "invoice_attachments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_size = Column(Integer, default=0)
    file_data = Column(LargeBinary, nullable=False)
    category = Column(String(50), default="autre")
    description = Column(Text, default="")
    uploaded_by = Column(String(255), default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)
    invoice = relationship("Invoice", backref="attachments")
