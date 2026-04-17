from datetime import datetime
import uuid

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base


def new_payroll_id() -> str:
    return str(uuid.uuid4())


class PayrollCodeMapping(Base):
    __tablename__ = "payroll_code_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(32), default="desjardins", nullable=False, index=True)
    code = Column(String(32), nullable=False)
    label = Column(String(255), nullable=False)
    source_field = Column(String(64), default="", nullable=False)
    export_mode = Column(String(32), default="quantity", nullable=False)
    requires_week = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True, index=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("provider", "code", name="uq_payroll_code_provider_code"),
    )


class PayrollExportBatch(Base):
    __tablename__ = "payroll_export_batches"

    id = Column(String, primary_key=True, default=new_payroll_id)
    provider = Column(String(32), default="desjardins", nullable=False, index=True)
    period_start = Column(Date, nullable=False, index=True)
    period_end = Column(Date, nullable=False, index=True)
    export_format = Column(String(16), nullable=False)
    company_filter = Column(String(64), default="", nullable=False)
    regenerate = Column(Boolean, default=False)
    generated_by = Column(String(255), default="", nullable=False)
    status = Column(String(32), default="completed", nullable=False, index=True)
    line_count = Column(Integer, default=0)
    employee_count = Column(Integer, default=0)
    total_regular_hours = Column(Float, default=0)
    total_training_hours = Column(Float, default=0)
    total_overtime_hours = Column(Float, default=0)
    total_km = Column(Float, default=0)
    total_expenses = Column(Float, default=0)
    total_perdiem = Column(Float, default=0)
    total_garde_hours = Column(Float, default=0)
    total_rappel_hours = Column(Float, default=0)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    items = relationship(
        "PayrollExportItem",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="PayrollExportItem.sort_order",
    )


class PayrollExportItem(Base):
    __tablename__ = "payroll_export_items"

    id = Column(String, primary_key=True, default=new_payroll_id)
    batch_id = Column(String, ForeignKey("payroll_export_batches.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(64), nullable=False, index=True)
    source_id = Column(String(255), nullable=False, index=True)
    export_key = Column(String(255), nullable=False, index=True)
    employee_id = Column(Integer, nullable=True, index=True)
    payroll_code = Column(String(32), nullable=False, index=True)
    company = Column(String(64), default="", nullable=False)
    matricule = Column(String(64), default="", nullable=False)
    statement_number = Column(String(64), default="", nullable=False)
    transaction_type = Column(String(64), default="", nullable=False)
    week_number = Column(Integer, nullable=True)
    division = Column(String(64), default="", nullable=False)
    service = Column(String(64), default="", nullable=False)
    department = Column(String(64), default="", nullable=False)
    subdepartment = Column(String(64), default="", nullable=False)
    transaction_date = Column(Date, nullable=False)
    quantity = Column(Float, nullable=True)
    rate = Column(Float, nullable=True)
    amount = Column(Float, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("PayrollExportBatch", back_populates="items")
