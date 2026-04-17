from __future__ import annotations

import base64
import csv
import io
import os
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.models import Employee, Schedule, ScheduleApproval
from ..models.models_payroll import (
    PayrollCodeMapping,
    PayrollExportBatch,
    PayrollExportItem,
)
from .invoice_service import KM_RATE, is_orientation_shift

PAYROLL_PROVIDER = "desjardins"
ALLOWED_PAYROLL_CODES = {"1", "4", "43", "57", "517", "518"}
DEFAULT_PAYROLL_COMPANY = (os.getenv("PAYROLL_DEFAULT_COMPANY") or "254981").strip()
DEFAULT_PAYROLL_STATEMENT_NUMBER = "0"
DEFAULT_PAYROLL_TRANSACTION_TYPE = "G"
CSV_HEADERS = [
    "Compagnie",
    "Matricule",
    "No relevé",
    "Type transaction",
    "Code gain/déduction",
    "Quantité",
    "Taux",
    "Montant",
    "Semaine",
    "Division",
    "Service",
    "Département",
    "Sous-département",
    "Date de transaction",
]
ORIENTATION_KEYWORDS = ("orientation", "formation")
OVERTIME_KEYWORDS = (
    "temps et demi",
    "temps-et-demi",
    "time and a half",
    "time-and-a-half",
    "time and half",
    "overtime",
    "surtemps 1.5",
    "surtemps x1.5",
    "1.5x",
)
# Re-declare the export headers with explicit escapes so the generated files
# keep the exact Desjardins labels even if the source file contains older
# mojibake elsewhere in the repo.
CSV_HEADERS = [
    "Compagnie",
    "Matricule",
    "No relev\u00e9",
    "Type transaction",
    "Code gain/d\u00e9duction",
    "Quantit\u00e9",
    "Taux",
    "Montant",
    "Semaine",
    "Division",
    "Service",
    "D\u00e9partement",
    "Sous-d\u00e9partement",
    "Date de transaction",
]
DEFAULT_DESJARDINS_MAPPINGS = [
    {
        "code": "1",
        "label": "Heures régulières",
        "source_field": "regular_hours",
        "export_mode": "quantity",
        "requires_week": True,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "code": "4",
        "label": "Heures formation",
        "source_field": "training_hours",
        "export_mode": "quantity",
        "requires_week": True,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "code": "43",
        "label": "Temps et demi",
        "source_field": "overtime_hours",
        "export_mode": "quantity",
        "requires_week": True,
        "is_active": True,
        "sort_order": 30,
    },
    {
        "code": "57",
        "label": "Remboursement kilométrage",
        "source_field": "km",
        "export_mode": "quantity_rate",
        "requires_week": True,
        "is_active": True,
        "sort_order": 40,
    },
    {
        "code": "517",
        "label": "Remboursement dépenses",
        "source_field": "expenses",
        "export_mode": "amount",
        "requires_week": True,
        "is_active": True,
        "sort_order": 50,
    },
    {
        "code": "518",
        "label": "Perdiem",
        "source_field": "perdiem",
        "export_mode": "amount",
        "requires_week": True,
        "is_active": True,
        "sort_order": 60,
    },
]


@dataclass
class PayrollSourceItem:
    export_key: str
    source_type: str
    source_id: str
    employee_id: int
    company: str
    matricule: str
    statement_number: str
    transaction_type: str
    code: str
    week_number: int | None
    division: str
    service: str
    department: str
    subdepartment: str
    transaction_date: date
    quantity: float | None = None
    rate: float | None = None
    amount: float | None = None
    sort_order: int = 0


def _normalize_text(*values: Any) -> str:
    raw = " ".join(str(value or "") for value in values).lower()
    raw = unicodedata.normalize("NFKD", raw)
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9\.\-]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _clean_str(value: Any) -> str:
    return str(value or "").strip()


def _round_number(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _round_rate(value: Any) -> float:
    try:
        return round(float(value or 0), 3)
    except (TypeError, ValueError):
        return 0.0


def _decimal_str(value: float | int | None) -> str:
    if value is None:
        return ""
    numeric = round(float(value or 0), 3)
    if abs(numeric - round(numeric)) < 0.0000001:
        return str(int(round(numeric)))
    return f"{numeric:.3f}".rstrip("0").rstrip(".")


def _week_number_for_date(period_start: date, current_date: date) -> int | None:
    if not period_start or not current_date:
        return None
    delta = (current_date - period_start).days
    if delta < 0:
        return None
    return 1 if delta < 7 else 2


def _schedule_classification(schedule: Schedule) -> str:
    normalized = _normalize_text(getattr(schedule, "notes", ""), getattr(schedule, "location", ""))
    if any(keyword in normalized for keyword in OVERTIME_KEYWORDS):
        return "43"
    if is_orientation_shift(schedule) or any(keyword in normalized for keyword in ORIENTATION_KEYWORDS):
        return "4"
    return "1"


def _resolve_payroll_company(employee: Employee | None, company_context: str = "") -> str:
    return (
        _clean_str(company_context)
        or _clean_str(getattr(employee, "payroll_company", ""))
        or DEFAULT_PAYROLL_COMPANY
    )


def _collect_payroll_profile_issues(employee: Employee | None, company_context: str = "") -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not _resolve_payroll_company(employee, company_context):
        issues.append(
            {
                "field": "compagnie",
                "message": "Aucune compagnie active ou config de compagnie n'a ete trouvee.",
            }
        )
    if not _clean_str(getattr(employee, "matricule", "")):
        issues.append(
            {
                "field": "matricule",
                "message": "Le matricule est absent du profil employe.",
            }
        )
    return issues


def build_desjardins_export_row(
    *,
    employee: Employee,
    company_context: str,
    code: str,
    week_number: int | None,
    transaction_date: date | None,
    source_type: str,
    source_id: str,
    export_key: str,
    sort_order: int,
    quantity: float | None = None,
    rate: float | None = None,
    amount: float | None = None,
) -> PayrollSourceItem:
    company = _resolve_payroll_company(employee, company_context)
    matricule = _clean_str(getattr(employee, "matricule", ""))
    statement_number = _clean_str(getattr(employee, "payroll_statement_number", "")) or DEFAULT_PAYROLL_STATEMENT_NUMBER
    transaction_type = _clean_str(getattr(employee, "payroll_transaction_type", "")) or DEFAULT_PAYROLL_TRANSACTION_TYPE

    if not company:
        raise ValueError("Aucune compagnie active ou config de compagnie n'a ete trouvee.")
    if not matricule:
        raise ValueError("Le matricule est absent du profil employe.")
    if transaction_date is None:
        raise ValueError("La date de transaction est introuvable pour cette ligne de paie.")
    if week_number not in {1, 2}:
        raise ValueError("La semaine de paie est introuvable pour cette ligne exportable.")
    if code not in ALLOWED_PAYROLL_CODES:
        raise ValueError(f"Le code de paie {code} n'est pas autorise dans cette version.")

    return PayrollSourceItem(
        export_key=export_key,
        source_type=source_type,
        source_id=source_id,
        employee_id=employee.id,
        company=company,
        matricule=matricule,
        statement_number=statement_number,
        transaction_type=transaction_type,
        code=code,
        week_number=week_number,
        division=_clean_str(getattr(employee, "payroll_division", "")),
        service=_clean_str(getattr(employee, "payroll_service", "")),
        department=_clean_str(getattr(employee, "payroll_department", "")),
        subdepartment=_clean_str(getattr(employee, "payroll_subdepartment", "")),
        transaction_date=transaction_date,
        quantity=quantity,
        rate=rate,
        amount=amount,
        sort_order=sort_order,
    )


async def ensure_default_payroll_code_mappings(db: AsyncSession) -> dict[str, PayrollCodeMapping]:
    result = await db.execute(
        select(PayrollCodeMapping).where(PayrollCodeMapping.provider == PAYROLL_PROVIDER)
    )
    existing = {item.code: item for item in result.scalars().all()}
    changed = False
    for item in DEFAULT_DESJARDINS_MAPPINGS:
        current = existing.get(item["code"])
        if current:
            updated = False
            for field in ("label", "source_field", "export_mode", "requires_week", "sort_order"):
                value = item[field]
                if getattr(current, field) != value:
                    setattr(current, field, value)
                    updated = True
            if not current.is_active:
                current.is_active = True
                updated = True
            if updated:
                changed = True
        else:
            created = PayrollCodeMapping(provider=PAYROLL_PROVIDER, **item)
            db.add(created)
            existing[item["code"]] = created
            changed = True
    if changed:
        await db.flush()
    return existing


async def get_active_desjardins_mappings(db: AsyncSession) -> dict[str, PayrollCodeMapping]:
    await ensure_default_payroll_code_mappings(db)
    result = await db.execute(
        select(PayrollCodeMapping).where(
            PayrollCodeMapping.provider == PAYROLL_PROVIDER,
            PayrollCodeMapping.is_active == True,
        )
    )
    items = {
        item.code: item
        for item in result.scalars().all()
        if item.code in ALLOWED_PAYROLL_CODES
    }
    return items


async def _load_approved_context(
    db: AsyncSession,
    period_start: date,
    period_end: date,
    company_filter: str = "",
) -> tuple[list[ScheduleApproval], dict[int, Employee], dict[tuple[int, int, date, date], list[Schedule]]]:
    approvals_result = await db.execute(
        select(ScheduleApproval).where(
            ScheduleApproval.status == "approved",
            ScheduleApproval.week_start >= period_start,
            ScheduleApproval.week_end <= period_end,
        )
    )
    approvals = approvals_result.scalars().all()
    if not approvals:
        return [], {}, {}

    employee_ids = sorted({approval.employee_id for approval in approvals})
    employees_result = await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
    employees = {employee.id: employee for employee in employees_result.scalars().all()}

    filtered_approvals: list[ScheduleApproval] = [
        approval for approval in approvals if employees.get(approval.employee_id)
    ]

    if not filtered_approvals:
        return [], employees, {}

    filtered_employee_ids = sorted({approval.employee_id for approval in filtered_approvals})
    schedules_result = await db.execute(
        select(Schedule).where(
            Schedule.employee_id.in_(filtered_employee_ids),
            Schedule.date >= period_start,
            Schedule.date <= period_end,
            Schedule.status != "cancelled",
        )
    )
    schedules_by_key: dict[tuple[int, int, date, date], list[Schedule]] = defaultdict(list)
    for schedule in schedules_result.scalars().all():
        for approval in filtered_approvals:
            if (
                approval.employee_id == schedule.employee_id
                and approval.client_id == getattr(schedule, "client_id", None)
                and approval.week_start <= schedule.date <= approval.week_end
            ):
                schedules_by_key[
                    (approval.employee_id, approval.client_id, approval.week_start, approval.week_end)
                ].append(schedule)
                break

    for key in list(schedules_by_key.keys()):
        schedules_by_key[key] = sorted(schedules_by_key[key], key=lambda row: (row.date, row.start or "", row.end or ""))

    return filtered_approvals, employees, schedules_by_key


def _aggregate_rows(source_items: list[PayrollSourceItem], mappings: dict[str, PayrollCodeMapping]) -> list[dict]:
    grouped: dict[tuple, dict] = {}
    for item in sorted(
        source_items,
        key=lambda row: (
            row.company,
            row.matricule,
            row.week_number or 0,
            row.sort_order,
            row.code,
            row.division,
            row.service,
            row.department,
            row.subdepartment,
            row.rate or 0,
        ),
    ):
        mapping = mappings.get(item.code)
        if not mapping:
            continue
        key = (
            item.company,
            item.matricule,
            item.statement_number,
            item.transaction_type,
            item.code,
            item.week_number or "",
            item.division,
            item.service,
            item.department,
            item.subdepartment,
            _round_rate(item.rate) if mapping.export_mode == "quantity_rate" else None,
        )
        if key not in grouped:
            grouped[key] = {
                "Compagnie": item.company,
                "Matricule": item.matricule,
                "No relevé": item.statement_number,
                "Type transaction": item.transaction_type,
                "Code gain/déduction": item.code,
                "Quantité": 0.0 if mapping.export_mode in {"quantity", "quantity_rate"} else None,
                "Taux": _round_number(item.rate) if mapping.export_mode == "quantity_rate" else None,
                "Montant": 0.0 if mapping.export_mode == "amount" else None,
                "Semaine": item.week_number or "",
                "Division": item.division,
                "Service": item.service,
                "Département": item.department,
                "Sous-département": item.subdepartment,
                "Date de transaction": item.transaction_date.isoformat(),
                "_sort_order": item.sort_order,
            }
        row = grouped[key]
        if mapping.export_mode in {"quantity", "quantity_rate"}:
            row["Quantité"] = _round_number(row["Quantité"]) + _round_number(item.quantity)
        if mapping.export_mode == "amount":
            row["Montant"] = _round_number(row["Montant"]) + _round_number(item.amount)

    rows = list(grouped.values())
    rows.sort(
        key=lambda row: (
            row["Compagnie"],
            row["Matricule"],
            int(row["Semaine"] or 0),
            row["_sort_order"],
            row["Code gain/déduction"],
            row["Division"],
            row["Service"],
            row["Département"],
            row["Sous-département"],
        )
    )
    for row in rows:
        row.pop("_sort_order", None)
    return rows


async def _already_exported_keys(db: AsyncSession, export_keys: list[str]) -> set[str]:
    if not export_keys:
        return set()
    result = await db.execute(
        select(PayrollExportItem.export_key).where(PayrollExportItem.export_key.in_(export_keys))
    )
    return {row[0] for row in result.all() if row and row[0]}


async def build_desjardins_payroll_preview(
    db: AsyncSession,
    period_start: date,
    period_end: date,
    company_filter: str = "",
    regenerate: bool = False,
) -> dict:
    if period_end < period_start:
        raise ValueError("La fin de periode doit etre egale ou posterieure au debut de periode.")
    mappings = await get_active_desjardins_mappings(db)
    approvals, employees, schedules_by_key = await _load_approved_context(
        db,
        period_start=period_start,
        period_end=period_end,
        company_filter=company_filter,
    )

    source_items: list[PayrollSourceItem] = []
    skipped_profiles: list[dict] = []
    ignored_items: list[dict] = []
    seen_perdiem_keys: set[tuple[int, date, date]] = set()
    employee_ids_with_exportable_data: set[int] = set()
    total_garde_hours = 0.0
    total_rappel_hours = 0.0

    for approval in approvals:
        employee = employees.get(approval.employee_id)
        if not employee:
            continue
        profile_issues = _collect_payroll_profile_issues(employee, company_filter)
        if profile_issues:
            skipped_profiles.append(
                {
                    "employee_id": employee.id,
                    "employee_name": employee.name,
                    "missing_fields": [issue["field"] for issue in profile_issues],
                    "messages": [issue["message"] for issue in profile_issues],
                    "week_start": approval.week_start.isoformat(),
                    "week_end": approval.week_end.isoformat(),
                }
            )
            continue

        schedules = schedules_by_key.get(
            (approval.employee_id, approval.client_id, approval.week_start, approval.week_end),
            [],
        )
        if not schedules:
            continue

        for schedule in schedules:
            week_number = _week_number_for_date(period_start, schedule.date)
            code = _schedule_classification(schedule)
            mapping = mappings.get(code)
            if mapping:
                hours = _round_number(getattr(schedule, "hours", 0))
                if hours > 0:
                    source_items.append(
                        build_desjardins_export_row(
                            employee=employee,
                            company_context=company_filter,
                            code=code,
                            week_number=week_number,
                            transaction_date=period_end,
                            source_type="schedule",
                            source_id=str(schedule.id),
                            export_key=f"schedule:{schedule.id}:{code}",
                            quantity=hours,
                            sort_order=mapping.sort_order,
                        )
                    )
                    employee_ids_with_exportable_data.add(employee.id)

            km_value = _round_number(getattr(schedule, "km", 0))
            if km_value > 0 and "57" in mappings:
                source_items.append(
                    build_desjardins_export_row(
                        employee=employee,
                        company_context=company_filter,
                        code="57",
                        week_number=week_number,
                        transaction_date=period_end,
                        source_type="schedule_km",
                        source_id=str(schedule.id),
                        export_key=f"schedule-km:{schedule.id}:57",
                        quantity=km_value,
                        rate=_round_rate(KM_RATE),
                        sort_order=mappings["57"].sort_order,
                    )
                )
                employee_ids_with_exportable_data.add(employee.id)

            expense_value = _round_number(getattr(schedule, "autre_dep", 0))
            if expense_value > 0 and "517" in mappings:
                source_items.append(
                    build_desjardins_export_row(
                        employee=employee,
                        company_context=company_filter,
                        code="517",
                        week_number=week_number,
                        transaction_date=period_end,
                        source_type="schedule_expense",
                        source_id=str(schedule.id),
                        export_key=f"schedule-expense:{schedule.id}:517",
                        amount=expense_value,
                        sort_order=mappings["517"].sort_order,
                    )
                )
                employee_ids_with_exportable_data.add(employee.id)

            total_garde_hours += _round_number(getattr(schedule, "garde_hours", 0))
            total_rappel_hours += _round_number(getattr(schedule, "rappel_hours", 0))

        perdiem_amount = _round_number(getattr(employee, "perdiem", 0))
        perdiem_key = (employee.id, approval.week_start, approval.week_end)
        if perdiem_amount > 0 and "518" in mappings and perdiem_key not in seen_perdiem_keys:
            source_items.append(
                build_desjardins_export_row(
                    employee=employee,
                    company_context=company_filter,
                    code="518",
                    week_number=_week_number_for_date(period_start, approval.week_start),
                    transaction_date=period_end,
                    source_type="perdiem_week",
                    source_id=f"{employee.id}:{approval.week_start.isoformat()}",
                    export_key=f"perdiem-week:{employee.id}:{approval.week_start.isoformat()}:518",
                    amount=perdiem_amount,
                    sort_order=mappings["518"].sort_order,
                )
            )
            employee_ids_with_exportable_data.add(employee.id)
            seen_perdiem_keys.add(perdiem_key)

    exportable_items = source_items
    already_exported_count = 0
    if not regenerate:
        already_exported_keys = await _already_exported_keys(
            db,
            [item.export_key for item in source_items],
        )
        already_exported_count = len(already_exported_keys)
        exportable_items = [
            item for item in source_items if item.export_key not in already_exported_keys
        ]

    rows = _aggregate_rows(exportable_items, mappings)
    stats = {
        "employee_count": len({item.employee_id for item in exportable_items}),
        "total_regular_hours": round(
            sum(item.quantity or 0 for item in exportable_items if item.code == "1"),
            2,
        ),
        "total_training_hours": round(
            sum(item.quantity or 0 for item in exportable_items if item.code == "4"),
            2,
        ),
        "total_overtime_hours": round(
            sum(item.quantity or 0 for item in exportable_items if item.code == "43"),
            2,
        ),
        "total_km": round(
            sum(item.quantity or 0 for item in exportable_items if item.code == "57"),
            2,
        ),
        "total_expenses": round(
            sum(item.amount or 0 for item in exportable_items if item.code == "517"),
            2,
        ),
        "total_perdiem": round(
            sum(item.amount or 0 for item in exportable_items if item.code == "518"),
            2,
        ),
        "total_garde_hours": round(total_garde_hours, 2),
        "total_rappel_hours": round(total_rappel_hours, 2),
        "row_count": len(rows),
        "source_item_count": len(exportable_items),
        "already_exported_count": already_exported_count,
    }

    if total_garde_hours > 0:
        ignored_items.append({"field": "garde_hours", "label": "Heures de garde", "exported": False})
    if total_rappel_hours > 0:
        ignored_items.append({"field": "rappel_hours", "label": "Heures de rappel", "exported": False})

    return {
        "provider": PAYROLL_PROVIDER,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "company_filter": _clean_str(company_filter),
        "regenerate": bool(regenerate),
        "mappings": [
            {
                "code": item.code,
                "label": item.label,
                "source_field": item.source_field,
                "export_mode": item.export_mode,
                "requires_week": bool(item.requires_week),
                "is_active": bool(item.is_active),
                "sort_order": int(item.sort_order or 0),
            }
            for item in sorted(mappings.values(), key=lambda row: (row.sort_order, row.code))
        ],
        "rows": rows,
        "stats": stats,
        "skipped_profiles": skipped_profiles,
        "ignored_unmapped": ignored_items,
        "source_items": exportable_items,
        "employee_ids_with_exportable_data": sorted(employee_ids_with_exportable_data),
    }


def _rows_to_csv_bytes(rows: list[dict]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(CSV_HEADERS)
    for row in rows:
        writer.writerow(
            [
                row.get("Compagnie", ""),
                row.get("Matricule", ""),
                row.get("No relevé", ""),
                row.get("Type transaction", ""),
                row.get("Code gain/déduction", ""),
                _decimal_str(row.get("Quantité")),
                _decimal_str(row.get("Taux")),
                _decimal_str(row.get("Montant")),
                row.get("Semaine", ""),
                row.get("Division", ""),
                row.get("Service", ""),
                row.get("Département", ""),
                row.get("Sous-département", ""),
                row.get("Date de transaction", ""),
            ]
        )
    return buffer.getvalue().encode("utf-8")


def _rows_to_xlsx_bytes(rows: list[dict]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Paie"
    sheet.append(CSV_HEADERS)
    for row in rows:
        sheet.append(
            [
                row.get("Compagnie", ""),
                row.get("Matricule", ""),
                row.get("No relevé", ""),
                row.get("Type transaction", ""),
                row.get("Code gain/déduction", ""),
                float(row["Quantité"]) if row.get("Quantité") not in ("", None) else None,
                float(row["Taux"]) if row.get("Taux") not in ("", None) else None,
                float(row["Montant"]) if row.get("Montant") not in ("", None) else None,
                row.get("Semaine", ""),
                row.get("Division", ""),
                row.get("Service", ""),
                row.get("Département", ""),
                row.get("Sous-département", ""),
                row.get("Date de transaction", ""),
            ]
        )
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


async def list_recent_payroll_export_batches(
    db: AsyncSession,
    limit: int = 12,
) -> list[PayrollExportBatch]:
    result = await db.execute(
        select(PayrollExportBatch)
        .where(PayrollExportBatch.provider == PAYROLL_PROVIDER)
        .order_by(PayrollExportBatch.created_at.desc())
        .limit(max(1, min(int(limit or 12), 50)))
    )
    return result.scalars().all()


# Override the earlier row builders with stable internal keys.
# This keeps the Desjardins headers exact in the exported files while
# avoiding brittle mojibake-based field access in the preview UI.
def _aggregate_rows(source_items: list[PayrollSourceItem], mappings: dict[str, PayrollCodeMapping]) -> list[dict]:
    grouped: dict[tuple, dict] = {}
    for item in sorted(
        source_items,
        key=lambda row: (
            row.company,
            row.matricule,
            row.week_number or 0,
            row.sort_order,
            row.code,
            row.division,
            row.service,
            row.department,
            row.subdepartment,
            row.rate or 0,
        ),
    ):
        mapping = mappings.get(item.code)
        if not mapping:
            continue
        key = (
            item.company,
            item.matricule,
            item.statement_number,
            item.transaction_type,
            item.code,
            item.week_number or "",
            item.division,
            item.service,
            item.department,
            item.subdepartment,
            _round_number(item.rate) if mapping.export_mode == "quantity_rate" else None,
        )
        if key not in grouped:
            grouped[key] = {
                "company": item.company,
                "matricule": item.matricule,
                "statement_number": item.statement_number,
                "transaction_type": item.transaction_type,
                "payroll_code": item.code,
                "quantity": 0.0 if mapping.export_mode in {"quantity", "quantity_rate"} else None,
                "rate": _round_rate(item.rate) if mapping.export_mode == "quantity_rate" else None,
                "amount": 0.0 if mapping.export_mode == "amount" else None,
                "week_number": item.week_number or "",
                "division": item.division,
                "service": item.service,
                "department": item.department,
                "subdepartment": item.subdepartment,
                "transaction_date": item.transaction_date.isoformat(),
                "_sort_order": item.sort_order,
            }
        row = grouped[key]
        if mapping.export_mode in {"quantity", "quantity_rate"}:
            row["quantity"] = _round_number(row["quantity"]) + _round_number(item.quantity)
        if mapping.export_mode == "amount":
            row["amount"] = _round_number(row["amount"]) + _round_number(item.amount)

    rows = list(grouped.values())
    rows.sort(
        key=lambda row: (
            row["company"],
            row["matricule"],
            int(row["week_number"] or 0),
            row["_sort_order"],
            row["payroll_code"],
            row["division"],
            row["service"],
            row["department"],
            row["subdepartment"],
        )
    )
    for row in rows:
        row.pop("_sort_order", None)
    return rows


def _rows_to_csv_bytes(rows: list[dict]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(CSV_HEADERS)
    for row in rows:
        writer.writerow(
            [
                row.get("company", ""),
                row.get("matricule", ""),
                row.get("statement_number", ""),
                row.get("transaction_type", ""),
                row.get("payroll_code", ""),
                _decimal_str(row.get("quantity")),
                _decimal_str(row.get("rate")),
                _decimal_str(row.get("amount")),
                row.get("week_number", ""),
                row.get("division", ""),
                row.get("service", ""),
                row.get("department", ""),
                row.get("subdepartment", ""),
                row.get("transaction_date", ""),
            ]
        )
    return buffer.getvalue().encode("utf-8")


def _rows_to_xlsx_bytes(rows: list[dict]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Paie"
    sheet.append(CSV_HEADERS)
    for row in rows:
        sheet.append(
            [
                row.get("company", ""),
                row.get("matricule", ""),
                row.get("statement_number", ""),
                row.get("transaction_type", ""),
                row.get("payroll_code", ""),
                float(row["quantity"]) if row.get("quantity") not in ("", None) else None,
                float(row["rate"]) if row.get("rate") not in ("", None) else None,
                float(row["amount"]) if row.get("amount") not in ("", None) else None,
                row.get("week_number", ""),
                row.get("division", ""),
                row.get("service", ""),
                row.get("department", ""),
                row.get("subdepartment", ""),
                row.get("transaction_date", ""),
            ]
        )
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


async def build_desjardins_payroll_export(
    db: AsyncSession,
    period_start: date,
    period_end: date,
    export_format: str,
    generated_by: str = "",
    company_filter: str = "",
    regenerate: bool = False,
) -> dict:
    if period_end < period_start:
        raise ValueError("La fin de periode doit etre egale ou posterieure au debut de periode.")
    preview = await build_desjardins_payroll_preview(
        db=db,
        period_start=period_start,
        period_end=period_end,
        company_filter=company_filter,
        regenerate=regenerate,
    )
    rows = preview["rows"]
    source_items: list[PayrollSourceItem] = preview["source_items"]
    if not rows:
        raise ValueError("Aucune ligne exportable pour cette période.")

    normalized_format = str(export_format or "").strip().lower()
    if normalized_format not in {"csv", "xlsx"}:
        raise ValueError("Format d'export non supporté. Utilise csv ou xlsx.")

    if normalized_format == "csv":
        content = _rows_to_csv_bytes(rows)
        mime_type = "text/csv"
        extension = "csv"
    else:
        content = _rows_to_xlsx_bytes(rows)
        mime_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        extension = "xlsx"

    filename = f"paie_desjardins_{period_start.isoformat()}_{period_end.isoformat()}.{extension}"

    batch = PayrollExportBatch(
        provider=PAYROLL_PROVIDER,
        period_start=period_start,
        period_end=period_end,
        export_format=normalized_format,
        company_filter=_clean_str(company_filter),
        regenerate=bool(regenerate),
        generated_by=_clean_str(generated_by),
        status="completed",
        line_count=len(rows),
        employee_count=preview["stats"]["employee_count"],
        total_regular_hours=preview["stats"]["total_regular_hours"],
        total_training_hours=preview["stats"]["total_training_hours"],
        total_overtime_hours=preview["stats"]["total_overtime_hours"],
        total_km=preview["stats"]["total_km"],
        total_expenses=preview["stats"]["total_expenses"],
        total_perdiem=preview["stats"]["total_perdiem"],
        total_garde_hours=preview["stats"]["total_garde_hours"],
        total_rappel_hours=preview["stats"]["total_rappel_hours"],
        notes=(
            f"Lignes exportees: {len(rows)}. "
            f"Items source: {len(source_items)}. "
            f"Regeneration explicite: {'oui' if regenerate else 'non'}."
        ),
    )
    db.add(batch)
    await db.flush()

    for index, item in enumerate(source_items):
        db.add(
            PayrollExportItem(
                batch_id=batch.id,
                source_type=item.source_type,
                source_id=item.source_id,
                export_key=item.export_key,
                employee_id=item.employee_id,
                payroll_code=item.code,
                company=item.company,
                matricule=item.matricule,
                statement_number=item.statement_number,
                transaction_type=item.transaction_type,
                week_number=item.week_number,
                division=item.division,
                service=item.service,
                department=item.department,
                subdepartment=item.subdepartment,
                transaction_date=item.transaction_date,
                quantity=item.quantity,
                rate=item.rate,
                amount=item.amount,
                sort_order=index,
            )
        )

    await db.commit()
    await db.refresh(batch)

    return {
        "provider": PAYROLL_PROVIDER,
        "filename": filename,
        "mime_type": mime_type,
        "content_base64": base64.b64encode(content).decode("ascii"),
        "batch_id": batch.id,
        "preview": {
            key: value
            for key, value in preview.items()
            if key != "source_items"
        },
    }
