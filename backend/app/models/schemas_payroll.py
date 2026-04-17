from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PayrollPreviewRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    company_id: Optional[str] = Field(default=None, alias="companyId")
    regenerate: bool = False


class PayrollExportRequest(PayrollPreviewRequest):
    export_format: str = Field(alias="exportFormat")


class PayrollExportBatchOut(BaseModel):
    id: str
    provider: str
    period_start: date
    period_end: date
    export_format: str
    company_filter: str
    regenerate: bool
    generated_by: str
    status: str
    line_count: int
    employee_count: int
    total_regular_hours: float
    total_training_hours: float
    total_overtime_hours: float
    total_km: float
    total_expenses: float
    total_perdiem: float
    total_garde_hours: float
    total_rappel_hours: float
    notes: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
