from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship

from ..database import Base


class ScheduleApprovalMeta(Base):
    __tablename__ = "schedule_approval_meta"

    id = Column(Integer, primary_key=True, autoincrement=True)
    approval_id = Column(Integer, ForeignKey("schedule_approvals.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    approved_hours = Column(Float, default=0)
    approved_shift_count = Column(Integer, default=0)
    week_total_hours = Column(Float, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    approval = relationship("ScheduleApproval", backref="meta")


class ScheduleApprovalAttachment(Base):
    __tablename__ = "schedule_approval_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    approval_id = Column(Integer, ForeignKey("schedule_approvals.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_size = Column(Integer, default=0)
    file_data = Column(LargeBinary, nullable=False)
    category = Column(String(50), default="autre")
    description = Column(Text, default="")
    uploaded_by = Column(String(255), default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)

    approval = relationship("ScheduleApproval", backref="attachments")
