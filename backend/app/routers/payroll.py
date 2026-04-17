from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas_payroll import (
    PayrollExportBatchOut,
    PayrollExportRequest,
    PayrollPreviewRequest,
)
from ..services.auth_service import require_admin
from ..services.payroll_service import (
    build_desjardins_payroll_export,
    build_desjardins_payroll_preview,
    list_recent_payroll_export_batches,
)

router = APIRouter()


@router.post("/desjardins/preview")
async def desjardins_preview(
    payload: PayrollPreviewRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    preview = await build_desjardins_payroll_preview(
        db=db,
        period_start=payload.period_start,
        period_end=payload.period_end,
        company_filter=payload.company_id or "",
        regenerate=payload.regenerate,
    )
    batches = await list_recent_payroll_export_batches(db)
    response = {
        key: value
        for key, value in preview.items()
        if key not in {"source_items"}
    }
    response["recent_batches"] = [
        PayrollExportBatchOut.model_validate(batch).model_dump()
        for batch in batches
    ]
    return response


@router.get("/desjardins/batches")
async def desjardins_batches(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    batches = await list_recent_payroll_export_batches(db)
    return [
        PayrollExportBatchOut.model_validate(batch).model_dump()
        for batch in batches
    ]


@router.post("/desjardins/export")
async def desjardins_export(
    payload: PayrollExportRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    try:
        export = await build_desjardins_payroll_export(
            db=db,
            period_start=payload.period_start,
            period_end=payload.period_end,
            export_format=payload.export_format,
            generated_by=getattr(user, "email", "") or "admin",
            company_filter=payload.company_id or "",
            regenerate=payload.regenerate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "filename": export["filename"],
        "mimeType": export["mime_type"],
        "content": export["content_base64"],
        "batchId": export["batch_id"],
        "preview": export["preview"],
    }
