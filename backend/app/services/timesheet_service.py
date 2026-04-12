from __future__ import annotations

import base64
from collections import defaultdict
from email.utils import parseaddr, parsedate_to_datetime
from io import BytesIO
import json
import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from PyPDF2 import PdfReader
try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - optional at runtime until dependency is installed
    fitz = None

from ..models.models import (
    Accommodation,
    AccommodationAttachment,
    Client,
    Employee,
    InvoiceAttachment,
    Schedule,
    ScheduleApproval,
    Timesheet,
    TimesheetAttachment,
    TimesheetShift,
    new_id,
)
from ..models.models_invoice import Invoice, InvoiceStatus
from ..models.models_schedule_review import ScheduleApprovalAttachment

_FRENCH_MONTHS = {
    "janvier": 1,
    "fevrier": 2,
    "février": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "août": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
    "décembre": 12,
}
_MONTH_LABELS = {
    1: "Janvier",
    2: "Février",
    3: "Mars",
    4: "Avril",
    5: "Mai",
    6: "Juin",
    7: "Juillet",
    8: "Août",
    9: "Septembre",
    10: "Octobre",
    11: "Novembre",
    12: "Décembre",
}
_ATTACHMENT_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "gif", "heic", "heif"}
_ORIENTATION_KEYWORDS = ("orientation", "formation")
_TIMESHEET_KEYWORDS = (
    "fdt",
    "feuille de temps",
    "feuille temps",
    "timesheet",
    "time sheet",
    "feuille de route",
    "feuille route",
)
_TIMESHEET_NEGATIVE_FILENAME_KEYWORDS = (
    "logo",
    "signature",
    "outlook",
    "header",
    "footer",
    "banner",
    "facebook",
    "instagram",
)
_GENERIC_CAMERA_NAME_RE = re.compile(r"^(?:img|image|photo|scan)[\-_ ]?\d+", flags=re.IGNORECASE)
_ACCOMMODATION_KEYWORDS = (
    "hebergement",
    "hébergement",
    "hotel",
    "hôtel",
    "motel",
    "auberge",
    "airbnb",
    "booking",
    "logement",
    "accommodation",
    "reservation",
    "réservation",
    "facture hotel",
    "facture hébergement",
)
_ACCOMMODATION_NEGATIVE_FILENAME_KEYWORDS = (
    "logo",
    "signature",
    "outlook",
    "header",
    "footer",
    "banner",
    "facebook",
    "instagram",
)
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
TIMESHEET_ATTACHMENT_MODEL = (
    os.getenv("TIMESHEET_ATTACHMENT_MODEL")
    or os.getenv("OPENAI_MODEL")
    or "gpt-5.4-mini"
).strip()
TIMESHEET_ATTACHMENT_REASONING_EFFORT = (
    os.getenv("TIMESHEET_ATTACHMENT_REASONING_EFFORT")
    or os.getenv("OPENAI_REASONING_EFFORT")
    or "medium"
).strip().lower()
_VISION_ATTACHMENT_EXTENSIONS = {"jpg", "jpeg", "png", "gif"}


def _norm(value: str) -> str:
    raw = unicodedata.normalize("NFKD", (value or "").strip().lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9@.\- ]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _attachment_extension(filename: str = "", content_type: str = "") -> str:
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].strip().lower()
        if ext in _ATTACHMENT_EXTENSIONS:
            return ext
    content = (content_type or "").strip().lower()
    if content == "application/pdf":
        return "pdf"
    if content in {"image/jpeg", "image/jpg"}:
        return "jpg"
    if content == "image/png":
        return "png"
    if content == "image/gif":
        return "gif"
    if content in {"image/heic", "image/heif"}:
        return "heic"
    return "bin"


def _safe_parse_message_date(value: str) -> Optional[date]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).date()
    except Exception:
        return None


def normalize_time_str(value: str) -> str:
    raw = str(value or "").strip()
    match = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?$", raw)
    if not match:
        return ""
    hours = int(match.group(1))
    minutes = match.group(2)
    if hours < 0 or hours > 23:
        return ""
    return f"{hours:02d}:{minutes}"


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    month_index = (year * 12 + (month - 1)) + delta
    shifted_year, shifted_month_index = divmod(month_index, 12)
    return shifted_year, shifted_month_index + 1


def _infer_week_period_from_day_range(
    start_day: int,
    end_day: int,
    reference_date: Optional[date] = None,
) -> Optional[tuple[date, date]]:
    if end_day < start_day or (end_day - start_day) != 6:
        return None
    ref = reference_date or date.today()
    candidates = []
    for month_delta in range(-3, 2):
        year_value, month_value = _shift_month(ref.year, ref.month, month_delta)
        try:
            start_date = date(year_value, month_value, start_day)
            end_date = date(year_value, month_value, end_day)
        except ValueError:
            continue
        if end_date < start_date:
            continue
        distance = abs((ref - end_date).days)
        future_penalty = 0 if end_date <= ref else 21
        candidates.append((future_penalty + distance, abs((ref - start_date).days), start_date, end_date))
    if not candidates:
        return None
    _, _, start_date, end_date = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
    return start_date, end_date


def _extract_openai_text(data: dict) -> str:
    if data.get("output_text"):
        return str(data.get("output_text") or "").strip()
    texts = []
    for item in data.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                texts.append(str(content.get("text") or ""))
    return "\n".join(part for part in texts if part).strip()


def _parse_json_object(raw: str) -> dict:
    text = str(raw or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _extract_pdf_text_preview(file_data: bytes, max_chars: int = 2400) -> str:
    if not file_data:
        return ""
    try:
        reader = PdfReader(BytesIO(file_data))
    except Exception:
        return ""
    chunks = []
    for page in reader.pages[:2]:
        try:
            text = (page.extract_text() or "").strip()
        except Exception:
            text = ""
        if text:
            chunks.append(text)
        if sum(len(chunk) for chunk in chunks) >= max_chars:
            break
    return "\n".join(chunks)[:max_chars].strip()


def _render_pdf_first_page_png(file_data: bytes, zoom: float = 2.0) -> bytes:
    if not file_data or fitz is None:
        return b""
    try:
        doc = fitz.open(stream=file_data, filetype="pdf")
        if doc.page_count <= 0:
            return b""
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
    except Exception:
        return b""


def _normalized_reasoning_effort() -> str:
    effort = (TIMESHEET_ATTACHMENT_REASONING_EFFORT or "medium").strip().lower()
    return effort if effort in {"none", "low", "medium", "high", "xhigh"} else "medium"


def _supports_reasoning(model_name: str) -> bool:
    model = (model_name or "").strip().lower()
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


def _format_openai_api_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            payload = exc.response.json()
        except Exception:
            payload = None
        message = (
            payload.get("error", {}).get("message")
            if isinstance(payload, dict)
            else exc.response.text
        )
        clean = str(message or "").strip()
        return clean or f"Erreur API OpenAI ({exc.response.status_code})"
    return str(exc or "").strip() or "Erreur API OpenAI"


def extract_document_text_preview(filename: str = "", mime_type: str = "", file_data: bytes = b"") -> str:
    ext = _attachment_extension(filename, mime_type)
    if ext == "pdf":
        return _extract_pdf_text_preview(file_data)
    return ""


def analyze_timesheet_document(
    document: dict,
    employee: Optional[Employee] = None,
    extracted_text: str = "",
) -> dict:
    filename = str(document.get("filename") or "").strip()
    subject = str(document.get("subject") or "").strip()
    body_preview = str(document.get("body_preview") or "").strip()
    mime_type = str(document.get("mime_type") or "").strip().lower()
    file_size = int(document.get("file_size") or 0)
    normalized_filename = _norm(filename)
    normalized_subject = _norm(subject)
    normalized_body = _norm(body_preview)
    normalized_text = _norm(extracted_text)
    combined = " ".join(
        value for value in [normalized_filename, normalized_subject, normalized_body, normalized_text] if value
    )
    ext = _attachment_extension(filename, mime_type)

    score = 0.0
    reasons = []

    if any(keyword in normalized_filename for keyword in _TIMESHEET_KEYWORDS):
        score += 0.55
        reasons.append("nom de fichier FDT")
    if any(keyword in normalized_subject for keyword in _TIMESHEET_KEYWORDS):
        score += 0.24
        reasons.append("objet du courriel FDT")
    if any(keyword in normalized_body for keyword in _TIMESHEET_KEYWORDS):
        score += 0.18
        reasons.append("contenu du courriel FDT")
    if any(keyword in normalized_text for keyword in _TIMESHEET_KEYWORDS):
        score += 0.24
        reasons.append("texte du document FDT")

    if employee:
        employee_name = _norm(getattr(employee, "name", "") or "")
        employee_tokens = [token for token in employee_name.split() if token]
        if employee_name and employee_name in combined:
            score += 0.18
            reasons.append("nom employe detecte")
        elif employee_tokens:
            overlap = sum(1 for token in employee_tokens if token in combined)
            if overlap >= 2:
                score += 0.14
                reasons.append("prenom/nom employe detectes")
            elif overlap == 1:
                score += 0.06

    if ext == "pdf":
        score += 0.10
    elif ext in {"jpg", "jpeg", "heic"} and file_size >= 120_000:
        score += 0.08
    elif ext == "png" and file_size >= 180_000:
        score += 0.04

    has_period = extract_period_from_text(
        " ".join(part for part in [subject, body_preview, filename, extracted_text] if part),
        reference_date=_safe_parse_message_date(document.get("date", "")),
    )
    if has_period:
        score += 0.10
        reasons.append("periode detectee")

    lowered_filename = filename.strip().lower()
    if any(keyword in lowered_filename for keyword in _TIMESHEET_NEGATIVE_FILENAME_KEYWORDS):
        score -= 0.40
        reasons.append("piece jointe decor ou signature")
    if ext in {"png", "gif"} and file_size < 120_000 and not any(
        keyword in normalized_filename for keyword in _TIMESHEET_KEYWORDS
    ):
        score -= 0.20
    if file_size and file_size < 20_000:
        score -= 0.18
    base_name = lowered_filename.rsplit(".", 1)[0]
    if _GENERIC_CAMERA_NAME_RE.match(base_name) and not any(
        keyword in combined for keyword in _TIMESHEET_KEYWORDS
    ):
        score -= 0.14

    score = round(max(0.0, min(score, 1.0)), 2)
    likely = score >= 0.42
    strong = score >= 0.65

    return {
        "score": score,
        "likely": likely,
        "strong": strong,
        "reasons": reasons,
        "period_detected": bool(has_period),
        "document_text_preview": extracted_text[:500].strip(),
    }


def _extract_currency_amount(text: str) -> float:
    raw = str(text or "")
    if not raw:
        return 0.0

    candidates = []
    labeled_patterns = [
        r"(?:grand\s+total|total|montant|amount\s+due|balance\s+due|total\s+due)[^0-9]{0,20}(\d[\d\s,.]{1,18})\s*\$?",
        r"\$\s*(\d[\d\s,.]{1,18})",
        r"(\d[\d\s,.]{1,18})\s*\$",
    ]
    for pattern in labeled_patterns:
        for value in re.findall(pattern, raw, flags=re.IGNORECASE):
            cleaned = str(value).replace(" ", "").replace(",", ".")
            if cleaned.count(".") > 1:
                head, tail = cleaned.rsplit(".", 1)
                cleaned = head.replace(".", "") + "." + tail
            try:
                amount = float(cleaned)
            except ValueError:
                continue
            if 0 < amount <= 10000:
                candidates.append(amount)
    return round(max(candidates), 2) if candidates else 0.0


def analyze_accommodation_document(
    document: dict,
    employee: Optional[Employee] = None,
    extracted_text: str = "",
) -> dict:
    filename = str(document.get("filename") or "").strip()
    subject = str(document.get("subject") or "").strip()
    body_preview = str(document.get("body_preview") or "").strip()
    mime_type = str(document.get("mime_type") or "").strip().lower()
    file_size = int(document.get("file_size") or 0)
    normalized_filename = _norm(filename)
    normalized_subject = _norm(subject)
    normalized_body = _norm(body_preview)
    normalized_text = _norm(extracted_text)
    combined = " ".join(
        value for value in [normalized_filename, normalized_subject, normalized_body, normalized_text] if value
    )
    ext = _attachment_extension(filename, mime_type)

    score = 0.0
    reasons = []

    if any(keyword in normalized_filename for keyword in _ACCOMMODATION_KEYWORDS):
        score += 0.48
        reasons.append("nom de fichier hebergement")
    if any(keyword in normalized_subject for keyword in _ACCOMMODATION_KEYWORDS):
        score += 0.26
        reasons.append("objet hebergement")
    if any(keyword in normalized_body for keyword in _ACCOMMODATION_KEYWORDS):
        score += 0.14
        reasons.append("contenu courriel hebergement")
    if any(keyword in normalized_text for keyword in _ACCOMMODATION_KEYWORDS):
        score += 0.22
        reasons.append("texte document hebergement")

    if any(keyword in combined for keyword in _TIMESHEET_KEYWORDS):
        score -= 0.22
        reasons.append("ressemble davantage a une FDT")

    if employee:
        employee_name = _norm(getattr(employee, "name", "") or "")
        employee_tokens = [token for token in employee_name.split() if token]
        if employee_name and employee_name in combined:
            score += 0.14
            reasons.append("nom employe detecte")
        elif employee_tokens:
            overlap = sum(1 for token in employee_tokens if token in combined)
            if overlap >= 2:
                score += 0.11
                reasons.append("prenom/nom employe detectes")
            elif overlap == 1:
                score += 0.04

    amount_detected = _extract_currency_amount(" ".join(part for part in [subject, body_preview, extracted_text, filename] if part))
    if amount_detected > 0:
        score += 0.10
        reasons.append("montant detecte")

    has_period = extract_period_from_text(
        " ".join(part for part in [subject, body_preview, filename, extracted_text] if part),
        reference_date=_safe_parse_message_date(document.get("date", "")),
    )
    if has_period:
        score += 0.08
        reasons.append("periode detectee")

    if ext == "pdf":
        score += 0.08
    elif ext in {"jpg", "jpeg", "heic", "heif"} and file_size >= 120_000:
        score += 0.06
    elif ext == "png" and file_size >= 150_000:
        score += 0.04

    lowered_filename = filename.strip().lower()
    if any(keyword in lowered_filename for keyword in _ACCOMMODATION_NEGATIVE_FILENAME_KEYWORDS):
        score -= 0.22
        reasons.append("piece jointe decor ou signature")
    if ext in {"png", "gif"} and file_size < 120_000 and not any(
        keyword in normalized_filename for keyword in _ACCOMMODATION_KEYWORDS
    ):
        score -= 0.20
    if file_size and file_size < 20_000:
        score -= 0.18

    score = round(max(0.0, min(score, 1.0)), 2)
    likely = score >= 0.38
    strong = score >= 0.62

    return {
        "score": score,
        "likely": likely,
        "strong": strong,
        "reasons": reasons,
        "period_detected": bool(has_period),
        "amount_detected": amount_detected,
        "document_text_preview": extracted_text[:500].strip(),
    }


def completed_billing_period(reference_date: Optional[date] = None) -> tuple[date, date]:
    ref = reference_date or date.today()
    completed_day = ref - timedelta(days=1)
    days_since_sunday = (completed_day.weekday() + 1) % 7
    period_start = completed_day - timedelta(days=days_since_sunday)
    return period_start, period_start + timedelta(days=6)


def format_french_period(period_start: date, period_end: date) -> str:
    start_month = _MONTH_LABELS.get(period_start.month, period_start.strftime("%B"))
    end_month = _MONTH_LABELS.get(period_end.month, period_end.strftime("%B"))
    if period_start.month == period_end.month and period_start.year == period_end.year:
        return f"du {period_start.day} au {period_end.day} {end_month}"
    if period_start.year == period_end.year:
        return f"du {period_start.day} {start_month} au {period_end.day} {end_month}"
    return f"du {period_start.day} {start_month} {period_start.year} au {period_end.day} {end_month} {period_end.year}"


def extract_period_from_text(text: str, reference_date: Optional[date] = None) -> Optional[tuple[date, date]]:
    raw = str(text or "").strip()
    if not raw:
        return None

    for start_text, end_text in re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b.*?\b(20\d{2}-\d{2}-\d{2})\b", raw, flags=re.IGNORECASE | re.DOTALL):
        try:
            start_date = date.fromisoformat(start_text)
            end_date = date.fromisoformat(end_text)
            if end_date >= start_date:
                return start_date, end_date
        except ValueError:
            continue

    lowered = raw.lower()
    month_pattern = "|".join(sorted((re.escape(name) for name in _FRENCH_MONTHS.keys()), key=len, reverse=True))
    range_pattern = re.compile(
        rf"(?:du\s+)?(\d{{1,2}})\s*(?:au|\-|a)\s*(\d{{1,2}})\s+({month_pattern})(?:\s+(20\d{{2}}))?",
        flags=re.IGNORECASE,
    )
    for start_day, end_day, month_name, year_value in range_pattern.findall(lowered):
        month_number = _FRENCH_MONTHS.get(month_name.lower())
        if not month_number:
            continue
        year_number = int(year_value or (reference_date or date.today()).year)
        try:
            start_date = date(year_number, month_number, int(start_day))
            end_date = date(year_number, month_number, int(end_day))
        except ValueError:
            continue
        if end_date >= start_date:
            return start_date, end_date

    cross_month_pattern = re.compile(
        rf"(?:du\s+)?(\d{{1,2}})\s+({month_pattern})(?:\s+(20\d{{2}}))?\s*(?:au|\-|a)\s*(\d{{1,2}})\s+({month_pattern})(?:\s+(20\d{{2}}))?",
        flags=re.IGNORECASE,
    )
    for start_day, start_month_name, start_year_value, end_day, end_month_name, end_year_value in cross_month_pattern.findall(lowered):
        start_month_number = _FRENCH_MONTHS.get(start_month_name.lower())
        end_month_number = _FRENCH_MONTHS.get(end_month_name.lower())
        if not start_month_number or not end_month_number:
            continue
        base_year = int(start_year_value or end_year_value or (reference_date or date.today()).year)
        end_year = int(end_year_value or base_year)
        start_year = int(start_year_value or (end_year - 1 if end_month_number < start_month_number and not start_year_value else end_year))
        try:
            start_date = date(start_year, start_month_number, int(start_day))
            end_date = date(end_year, end_month_number, int(end_day))
        except ValueError:
            continue
        if end_date >= start_date:
            return start_date, end_date

    compact_range_pattern = re.compile(r"(?<![:/\d])(\d{1,2})\s*[-_]\s*(\d{1,2})(?![:/\d])")
    for start_day, end_day in compact_range_pattern.findall(lowered):
        inferred = _infer_week_period_from_day_range(
            int(start_day),
            int(end_day),
            reference_date=reference_date,
        )
        if inferred:
            return inferred

    return None


def _mime_type_for_ai_review(filename: str = "", content_type: str = "") -> str:
    ext = _attachment_extension(filename, content_type)
    if ext in {"jpg", "jpeg"}:
        return "image/jpeg"
    if ext == "png":
        return "image/png"
    if ext == "gif":
        return "image/gif"
    return (content_type or "").strip() or "application/octet-stream"


def _should_use_ai_attachment_review(
    document: dict,
    analysis: dict,
    employee: Optional[Employee],
) -> bool:
    if not OPENAI_API_KEY:
        return False
    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    if ext not in _VISION_ATTACHMENT_EXTENSIONS:
        return False
    file_size = int(document.get("file_size") or len(document.get("file_data", b"") or b"") or 0)
    if file_size <= 0 or file_size > 6_000_000:
        return False
    normalized_filename = _norm(document.get("filename", ""))
    has_explicit_timesheet_keyword = any(keyword in normalized_filename for keyword in _TIMESHEET_KEYWORDS)
    camera_named = bool(_GENERIC_CAMERA_NAME_RE.match((str(document.get("filename") or "").rsplit(".", 1)[0]).strip()))
    score = float(analysis.get("score") or 0)
    if analysis.get("strong") and has_explicit_timesheet_keyword and employee:
        return False
    if not employee:
        return score >= 0.12
    if camera_named:
        return score >= 0.12
    return 0.18 <= score <= 0.82


def _should_use_ai_accommodation_review(
    document: dict,
    analysis: dict,
    employee: Optional[Employee],
    extracted_text: str = "",
) -> bool:
    if not OPENAI_API_KEY:
        return False
    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    if ext not in _VISION_ATTACHMENT_EXTENSIONS and ext != "pdf":
        return False
    if ext == "pdf" and not extracted_text.strip():
        return False
    file_size = int(document.get("file_size") or len(document.get("file_data", b"") or b"") or 0)
    if file_size <= 0 or file_size > 8_000_000:
        return False
    score = float(analysis.get("score") or 0)
    if analysis.get("strong") and employee:
        return False
    return 0.12 <= score <= 0.86


async def inspect_attachment_with_openai(
    document: dict,
    employee_hint: str = "",
    raise_on_error: bool = False,
) -> dict:
    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    if (ext not in _VISION_ATTACHMENT_EXTENSIONS and ext != "pdf") or not OPENAI_API_KEY:
        return {}

    file_data = document.get("file_data", b"") or b""
    if not file_data:
        return {}

    image_bytes = file_data
    mime_type = _mime_type_for_ai_review(document.get("filename", ""), document.get("mime_type", ""))
    if ext == "pdf":
        image_bytes = _render_pdf_first_page_png(file_data)
        mime_type = "image/png"
    if not image_bytes:
        return {}
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    context_text = (
        "Courriel de facturation a examiner.\n"
        f"Expediteur: {document.get('from', '')}\n"
        f"Objet: {document.get('subject', '')}\n"
        f"Apercu du message: {document.get('body_preview', '')}\n"
        f"Nom du fichier: {document.get('filename', '')}\n"
        f"Employe attendu si connu: {employee_hint or 'inconnu'}\n\n"
        "Determine si cette piece jointe est une vraie feuille de temps employee/FDT. "
        "Ignore les logos, signatures isolees, captures d'ecran, photos sans rapport et documents administratifs non FDT. "
        "Reponds en JSON compact uniquement avec les cles: "
        "is_timesheet, confidence, employee_name_seen, period_text_seen, is_signed, notes."
    )
    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": "Tu aides un commis de facturation a trier les pieces jointes recues par courriel. Sois prudent et n'identifie comme FDT que les vrais documents de feuille de temps.",
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": context_text},
                    {"type": "input_image", "image_url": data_url, "detail": "high"},
                ],
            }
        ],
        "max_output_tokens": 220,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        payload["reasoning"] = {"effort": _normalized_reasoning_effort()}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            parsed = _parse_json_object(_extract_openai_text(response.json()))
    except Exception as exc:
        if raise_on_error:
            raise RuntimeError(_format_openai_api_error(exc)) from exc
        return {}

    confidence_raw = parsed.get("confidence", 0)
    try:
        confidence = max(0.0, min(float(confidence_raw), 1.0))
    except (TypeError, ValueError):
        confidence = 0.0

    is_signed = parsed.get("is_signed")
    if isinstance(is_signed, str):
        lowered = is_signed.strip().lower()
        if lowered in {"true", "oui", "yes"}:
            is_signed = True
        elif lowered in {"false", "non", "no"}:
            is_signed = False
        else:
            is_signed = None
    elif not isinstance(is_signed, bool):
        is_signed = None

    is_timesheet = parsed.get("is_timesheet")
    if isinstance(is_timesheet, str):
        is_timesheet = is_timesheet.strip().lower() in {"true", "oui", "yes"}
    elif not isinstance(is_timesheet, bool):
        is_timesheet = None

    return {
        "used": True,
        "is_timesheet": is_timesheet,
        "confidence": round(confidence, 2),
        "employee_name_seen": str(parsed.get("employee_name_seen") or "").strip(),
        "period_text_seen": str(parsed.get("period_text_seen") or "").strip(),
        "is_signed": is_signed,
        "notes": str(parsed.get("notes") or "").strip(),
    }


async def inspect_accommodation_document_with_openai(
    document: dict,
    employee_hint: str = "",
    extracted_text: str = "",
) -> dict:
    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    if not OPENAI_API_KEY or (ext not in _VISION_ATTACHMENT_EXTENSIONS and ext != "pdf"):
        return {}

    file_data = document.get("file_data", b"") or b""
    if not file_data:
        return {}

    context_text = (
        "Courriel de facturation a examiner.\n"
        f"Expediteur: {document.get('from', '')}\n"
        f"Objet: {document.get('subject', '')}\n"
        f"Apercu du message: {document.get('body_preview', '')}\n"
        f"Nom du fichier: {document.get('filename', '')}\n"
        f"Employe attendu si connu: {employee_hint or 'inconnu'}\n\n"
        "Determine si cette piece jointe est une facture d'hebergement, une facture d'hotel ou un justificatif d'hebergement. "
        "Ignore les FDT, logos, signatures isolees et documents administratifs sans rapport. "
        "Reponds en JSON compact uniquement avec les cles: "
        "is_accommodation, confidence, employee_name_seen, period_text_seen, total_cost, vendor_name, notes."
    )
    if ext in _VISION_ATTACHMENT_EXTENSIONS:
        mime_type = _mime_type_for_ai_review(document.get("filename", ""), document.get("mime_type", ""))
        data_url = f"data:{mime_type};base64,{base64.b64encode(file_data).decode('ascii')}"
        content = [
            {"type": "input_text", "text": context_text},
            {"type": "input_image", "image_url": data_url, "detail": "high"},
        ]
    else:
        preview_text = extracted_text or extract_document_text_preview(
            document.get("filename", ""),
            document.get("mime_type", ""),
            file_data,
        )
        if not preview_text:
            return {}
        content = [
            {"type": "input_text", "text": f"{context_text}\n\nTexte extrait du document:\n{preview_text[:6000]}"},
        ]

    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": "Tu aides un commis de facturation a trier les pieces jointes recues par courriel. Sois prudent et n'identifie comme hebergement que les vrais justificatifs ou factures de logement.",
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": 280,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        payload["reasoning"] = {"effort": _normalized_reasoning_effort()}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            parsed = _parse_json_object(_extract_openai_text(response.json()))
    except Exception:
        return {}

    confidence_raw = parsed.get("confidence", 0)
    try:
        confidence = max(0.0, min(float(confidence_raw), 1.0))
    except (TypeError, ValueError):
        confidence = 0.0

    is_accommodation = parsed.get("is_accommodation")
    if isinstance(is_accommodation, str):
        is_accommodation = is_accommodation.strip().lower() in {"true", "oui", "yes"}
    elif not isinstance(is_accommodation, bool):
        is_accommodation = None

    total_cost_raw = parsed.get("total_cost", 0)
    try:
        total_cost = round(max(float(total_cost_raw or 0), 0.0), 2)
    except (TypeError, ValueError):
        total_cost = 0.0

    return {
        "used": True,
        "is_accommodation": is_accommodation,
        "confidence": round(confidence, 2),
        "employee_name_seen": str(parsed.get("employee_name_seen") or "").strip(),
        "period_text_seen": str(parsed.get("period_text_seen") or "").strip(),
        "total_cost": total_cost,
        "vendor_name": str(parsed.get("vendor_name") or "").strip(),
        "notes": str(parsed.get("notes") or "").strip(),
    }


def merge_ai_attachment_analysis(analysis: dict, ai_review: dict) -> dict:
    if not ai_review:
        return analysis

    score = float(analysis.get("score") or 0)
    reasons = list(analysis.get("reasons") or [])
    confidence = float(ai_review.get("confidence") or 0)
    if ai_review.get("is_timesheet") is True:
        score += 0.18 + min(0.14, confidence * 0.14)
        reasons.append("lecture visuelle confirme une FDT")
    elif ai_review.get("is_timesheet") is False:
        score -= 0.24 + min(0.22, confidence * 0.22)
        reasons.append("lecture visuelle ecarte cette piece jointe")
    if ai_review.get("employee_name_seen"):
        reasons.append("nom lu sur document")
        score += 0.05
    if ai_review.get("period_text_seen"):
        reasons.append("periode lue sur document")
        score += 0.05
    if ai_review.get("is_signed") is True:
        reasons.append("signature visible")

    score = round(max(0.0, min(score, 1.0)), 2)
    return {
        **analysis,
        "score": score,
        "likely": score >= 0.42,
        "strong": score >= 0.65,
        "reasons": reasons,
        "ai_review": ai_review,
    }


def merge_ai_accommodation_analysis(analysis: dict, ai_review: dict) -> dict:
    if not ai_review:
        return analysis

    score = float(analysis.get("score") or 0)
    reasons = list(analysis.get("reasons") or [])
    confidence = float(ai_review.get("confidence") or 0)
    if ai_review.get("is_accommodation") is True:
        score += 0.18 + min(0.14, confidence * 0.14)
        reasons.append("lecture confirme un document d'hebergement")
    elif ai_review.get("is_accommodation") is False:
        score -= 0.26 + min(0.18, confidence * 0.18)
        reasons.append("lecture ecarte ce document d'hebergement")
    if ai_review.get("employee_name_seen"):
        reasons.append("nom lu sur document")
        score += 0.05
    if ai_review.get("period_text_seen"):
        reasons.append("periode lue sur document")
        score += 0.05
    if float(ai_review.get("total_cost") or 0) > 0:
        reasons.append("montant lu sur document")
        score += 0.05

    score = round(max(0.0, min(score, 1.0)), 2)
    return {
        **analysis,
        "score": score,
        "likely": score >= 0.38,
        "strong": score >= 0.62,
        "reasons": reasons,
        "amount_detected": round(float(ai_review.get("total_cost") or analysis.get("amount_detected") or 0), 2),
        "ai_review": ai_review,
    }


def _document_has_explicit_timesheet_hint(item: dict) -> bool:
    document = item.get("document") or {}
    analysis = item.get("analysis") or {}
    ai_review = item.get("ai_review") or {}
    combined = " ".join(
        _norm(value)
        for value in [
            document.get("filename", ""),
            document.get("subject", ""),
            document.get("body_preview", ""),
            item.get("extracted_text", ""),
            ai_review.get("employee_name_seen", ""),
            ai_review.get("period_text_seen", ""),
            ai_review.get("notes", ""),
        ]
        if value
    )
    return bool(
        any(keyword in combined for keyword in _TIMESHEET_KEYWORDS)
        or analysis.get("period_detected")
        or ai_review.get("period_text_seen")
    )


def _document_has_explicit_accommodation_hint(item: dict) -> bool:
    document = item.get("document") or {}
    analysis = item.get("accommodation_analysis") or {}
    ai_review = item.get("accommodation_ai_review") or {}
    combined = " ".join(
        _norm(value)
        for value in [
            document.get("filename", ""),
            document.get("subject", ""),
            document.get("body_preview", ""),
            item.get("extracted_text", ""),
            ai_review.get("employee_name_seen", ""),
            ai_review.get("period_text_seen", ""),
            ai_review.get("notes", ""),
        ]
        if value
    )
    return bool(
        any(keyword in combined for keyword in _ACCOMMODATION_KEYWORDS)
        or analysis.get("period_detected")
        or ai_review.get("period_text_seen")
        or float(analysis.get("amount_detected") or 0) > 0
    )


def _select_timesheet_candidates(analyzed_docs: list[dict]) -> list[dict]:
    if not analyzed_docs:
        return []

    filtered = [
        item
        for item in analyzed_docs
        if (item.get("ai_review") or {}).get("is_timesheet") is not False
        and (
            (item.get("analysis") or {}).get("likely")
            or (item.get("analysis") or {}).get("strong")
            or (item.get("ai_review") or {}).get("is_timesheet") is True
        )
    ]
    if not filtered:
        return []

    confirmed = [item for item in filtered if (item.get("ai_review") or {}).get("is_timesheet") is True]
    if confirmed:
        return confirmed

    strong_with_hint = [
        item for item in filtered
        if (item.get("analysis") or {}).get("strong") and _document_has_explicit_timesheet_hint(item)
    ]
    if strong_with_hint:
        return strong_with_hint

    hinted = [item for item in filtered if _document_has_explicit_timesheet_hint(item)]
    pool = hinted or filtered
    ranked = sorted(
        pool,
        key=lambda item: (
            float((item.get("analysis") or {}).get("score") or 0),
            1 if item.get("employee") else 0,
            1 if (item.get("analysis") or {}).get("period_detected") else 0,
        ),
        reverse=True,
    )
    return ranked[:1]


def _select_accommodation_candidates(analyzed_docs: list[dict]) -> list[dict]:
    if not analyzed_docs:
        return []

    filtered = [
        item
        for item in analyzed_docs
        if (item.get("accommodation_ai_review") or {}).get("is_accommodation") is not False
        and (
            (item.get("accommodation_analysis") or {}).get("likely")
            or (item.get("accommodation_analysis") or {}).get("strong")
            or (item.get("accommodation_ai_review") or {}).get("is_accommodation") is True
        )
    ]
    if not filtered:
        return []

    confirmed = [item for item in filtered if (item.get("accommodation_ai_review") or {}).get("is_accommodation") is True]
    if confirmed:
        return confirmed

    strong_with_hint = [
        item
        for item in filtered
        if (item.get("accommodation_analysis") or {}).get("strong") and _document_has_explicit_accommodation_hint(item)
    ]
    if strong_with_hint:
        return strong_with_hint

    hinted = [item for item in filtered if _document_has_explicit_accommodation_hint(item)]
    pool = hinted or filtered
    ranked = sorted(
        pool,
        key=lambda item: (
            float((item.get("accommodation_analysis") or {}).get("score") or 0),
            1 if item.get("employee") else 0,
            1 if (item.get("accommodation_analysis") or {}).get("period_detected") else 0,
            float((item.get("accommodation_analysis") or {}).get("amount_detected") or 0),
        ),
        reverse=True,
    )
    return ranked[:2]


def _normalize_shift_summary_item(item: dict) -> Optional[dict]:
    if not isinstance(item, dict):
        return None
    date_value = str(item.get("date") or "").strip()[:10]
    day_label = str(item.get("day_label") or "").strip()
    start_value = normalize_time_str(str(item.get("start") or "").strip())
    end_value = normalize_time_str(str(item.get("end") or "").strip())
    try:
        pause_minutes = int(round(float(item.get("pause_minutes", 0) or 0)))
    except (TypeError, ValueError):
        pause_minutes = 0
    try:
        hours = round(float(item.get("hours", 0) or 0), 2)
    except (TypeError, ValueError):
        hours = 0.0
    unit = str(item.get("unit") or item.get("location") or "").strip()
    approver_name = str(item.get("approver_name") or item.get("signer_name") or "").strip()
    shift_notes = str(item.get("notes") or "").strip()
    shift_type = str(item.get("type") or "unknown").strip().lower()
    if shift_type not in {"regular", "orientation", "unknown"}:
        shift_type = "unknown"
    if not any([date_value, day_label, start_value, end_value, hours, unit, approver_name, shift_notes]):
        return None
    return {
        "date": date_value,
        "day_label": day_label,
        "start": start_value,
        "end": end_value,
        "pause_minutes": pause_minutes,
        "hours": hours,
        "type": shift_type,
        "unit": unit,
        "approver_name": approver_name,
        "notes": shift_notes,
    }


async def extract_timesheet_shift_summary(
    document: dict,
    employee_hint: str = "",
    period_hint: str = "",
    extracted_text: str = "",
    raise_on_error: bool = False,
    force_timesheet: bool = False,
) -> dict:
    if not OPENAI_API_KEY:
        return {}

    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    content = None
    prompt_prefix = (
        "L'utilisateur confirme qu'il s'agit d'une FDT jointe dans le chat. "
        "Lis le document comme une feuille de temps et extrais le maximum d'information utile sans inventer. "
        if force_timesheet
        else ""
    )
    prompt_text = (
        f"{prompt_prefix}"
        "Analyse cette feuille de temps de Soins Expert Plus. "
        "Retourne uniquement un JSON compact avec les cles: "
        "is_timesheet, employee_name, employee_title, period_text, is_signed, visible_names, shifts, notes. "
        "visible_names doit etre une liste courte des noms lisibles sur le document. "
        "Chaque element de shifts doit contenir: "
        "date, day_label, start, end, pause_minutes, hours, type, unit, approver_name, notes. "
        "Si une valeur est illisible, laisse-la vide ou a 0. "
        "Lis attentivement chaque ligne de quart visible, y compris les pauses, le service/unite, les noms du signataire et les mentions d'orientation. "
        "N'invente pas. Type doit etre regular, orientation ou unknown. "
        "Si le document semble etre une vraie FDT mais que certains quarts restent partiels, indique-le dans notes. "
        "Si une ligne est barree ou vide, n'ajoute pas de faux quart.\n\n"
        f"Expediteur: {document.get('from', '')}\n"
        f"Objet: {document.get('subject', '')}\n"
        f"Apercu: {document.get('body_preview', '')}\n"
        f"Nom du fichier: {document.get('filename', '')}\n"
        f"Employe attendu: {employee_hint or 'inconnu'}\n"
        f"Periode attendue si connue: {period_hint or 'inconnue'}"
    )

    if ext in _VISION_ATTACHMENT_EXTENSIONS:
        file_data = document.get("file_data", b"") or b""
        if not file_data:
            return {}
        mime_type = _mime_type_for_ai_review(document.get("filename", ""), document.get("mime_type", ""))
        data_url = f"data:{mime_type};base64,{base64.b64encode(file_data).decode('ascii')}"
        content = [
            {"type": "input_text", "text": prompt_text},
            {"type": "input_image", "image_url": data_url, "detail": "high"},
        ]
    elif ext == "pdf":
        file_data = document.get("file_data", b"") or b""
        png_bytes = _render_pdf_first_page_png(file_data)
        preview_text = extracted_text or extract_document_text_preview(
            document.get("filename", ""),
            document.get("mime_type", ""),
            file_data,
        )
        if png_bytes:
            data_url = f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"
            content = [{"type": "input_text", "text": prompt_text}]
            if preview_text:
                content.append({"type": "input_text", "text": f"Texte extrait du document:\n{preview_text[:6000]}"})
            content.append({"type": "input_image", "image_url": data_url, "detail": "high"})
        elif preview_text:
            content = [
                {"type": "input_text", "text": f"{prompt_text}\n\nTexte extrait du document:\n{preview_text[:6000]}"},
            ]
        else:
            return {}
    else:
        return {}

    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": (
            "Tu aides un commis de facturation et de paie a lire des feuilles de temps. "
            "Sois prudent, n'invente rien et extrais seulement ce qui est clairement visible ou lisible. "
            "Quand l'utilisateur fournit explicitement une FDT, donne le meilleur effort de transcription utile pour la facturation meme si certains champs restent partiels."
        ),
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": 1800,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        reasoning_effort = _normalized_reasoning_effort()
        if force_timesheet and reasoning_effort in {"none", "low", "medium"}:
            reasoning_effort = "high"
        payload["reasoning"] = {"effort": reasoning_effort}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            parsed = _parse_json_object(_extract_openai_text(response.json()))
    except Exception as exc:
        if raise_on_error:
            raise RuntimeError(_format_openai_api_error(exc)) from exc
        return {}

    shifts = []
    for shift in parsed.get("shifts") or []:
        normalized = _normalize_shift_summary_item(shift)
        if normalized:
            shifts.append(normalized)

    is_signed = parsed.get("is_signed")
    if isinstance(is_signed, str):
        lowered = is_signed.strip().lower()
        if lowered in {"true", "oui", "yes"}:
            is_signed = True
        elif lowered in {"false", "non", "no"}:
            is_signed = False
        else:
            is_signed = None
    elif not isinstance(is_signed, bool):
        is_signed = None

    is_timesheet = parsed.get("is_timesheet")
    if isinstance(is_timesheet, str):
        is_timesheet = is_timesheet.strip().lower() in {"true", "oui", "yes"}
    elif not isinstance(is_timesheet, bool):
        is_timesheet = None

    return {
        "is_timesheet": is_timesheet,
        "employee_name": str(parsed.get("employee_name") or "").strip(),
        "employee_title": str(parsed.get("employee_title") or "").strip(),
        "period_text": str(parsed.get("period_text") or "").strip(),
        "is_signed": is_signed,
        "visible_names": [
            str(name).strip()
            for name in (parsed.get("visible_names") or [])
            if str(name).strip()
        ][:12],
        "shifts": shifts[:20],
        "notes": str(parsed.get("notes") or "").strip(),
    }


def _summarize_explicit_timesheet_confidence(
    summary: dict,
    analysis: Optional[dict] = None,
    ai_review: Optional[dict] = None,
    matched_employee: Optional[Employee] = None,
) -> float:
    score = 0.48
    if summary.get("is_timesheet") is True:
        score += 0.12
    elif summary.get("is_timesheet") is False:
        score -= 0.08
    if summary.get("employee_name") or matched_employee:
        score += 0.12
    if summary.get("employee_title"):
        score += 0.04
    if summary.get("period_text"):
        score += 0.08
    if summary.get("is_signed") is not None:
        score += 0.04
    shift_count = len(summary.get("shifts") or [])
    if shift_count > 0:
        score += 0.16 + min(0.08, 0.02 * shift_count)
    if summary.get("visible_names"):
        score += min(0.06, 0.02 * len(summary.get("visible_names") or []))
    if analysis:
        score += min(0.10, float(analysis.get("score") or 0) * 0.10)
    if ai_review:
        score += min(0.10, float(ai_review.get("confidence") or 0) * 0.10)
    return _clamp_score(score)


async def _transcribe_timesheet_document_with_openai(
    document: dict,
    employee_hint: str = "",
    raise_on_error: bool = False,
) -> str:
    if not OPENAI_API_KEY:
        return ""

    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    if ext not in _VISION_ATTACHMENT_EXTENSIONS and ext != "pdf":
        return ""

    file_data = document.get("file_data", b"") or b""
    if not file_data:
        return ""

    if ext in _VISION_ATTACHMENT_EXTENSIONS:
        mime_type = _mime_type_for_ai_review(document.get("filename", ""), document.get("mime_type", ""))
        payload_content = [
            {
                "type": "input_text",
                "text": (
                    "Transcris le plus fidelement possible cette FDT Soins Expert Plus. "
                    "Donne un texte structure avec: nom employe, titre, periode, puis chaque ligne de quart visible "
                    "avec jour/date, heure debut, heure fin, pause/repas, total d'heures, unite/service, signataire et mentions utiles. "
                    "N'invente rien. Si quelque chose est illisible, note simplement illisible. "
                    f"Employe attendu si connu: {employee_hint or 'inconnu'}."
                ),
            },
            {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{base64.b64encode(file_data).decode('ascii')}",
                "detail": "high",
            },
        ]
    else:
        preview_text = extract_document_text_preview(
            document.get("filename", ""),
            document.get("mime_type", ""),
            file_data,
        )
        png_bytes = _render_pdf_first_page_png(file_data) if ext == "pdf" else b""
        if png_bytes:
            payload_content = [
                {
                    "type": "input_text",
                    "text": (
                        "Transcris le plus fidelement possible cette FDT Soins Expert Plus. "
                        "Donne un texte structure avec: nom employe, titre, periode, puis chaque ligne de quart visible "
                        "avec jour/date, heure debut, heure fin, pause/repas, total d'heures, unite/service, signataire et mentions utiles. "
                        "N'invente rien. Si quelque chose est illisible, note simplement illisible. "
                        f"Employe attendu si connu: {employee_hint or 'inconnu'}."
                    ),
                },
                {
                    "type": "input_image",
                    "image_url": f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}",
                    "detail": "high",
                },
            ]
            if preview_text:
                payload_content.insert(1, {"type": "input_text", "text": f"Texte extrait du document:\n{preview_text[:10000]}"})
        elif not preview_text:
            return ""
        else:
            payload_content = [
                {
                    "type": "input_text",
                    "text": (
                        "Voici le texte extrait d'une FDT. Reorganise-le proprement en transcription utile pour la facturation: "
                        "nom employe, titre, periode, puis quarts visibles avec heures, pauses, unite/service, signataire et notes. "
                        "N'invente rien.\n\n"
                        f"{preview_text[:10000]}"
                    ),
                }
            ]

    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": (
            "Tu fais une transcription OCR pragmatique de feuilles de temps. "
            "Le but est d'aider un commis a lire une FDT difficile. "
            "Retourne du texte brut structure, pas du JSON."
        ),
        "input": [{"role": "user", "content": payload_content}],
        "max_output_tokens": 2200,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        reasoning_effort = _normalized_reasoning_effort()
        if reasoning_effort in {"none", "low", "medium"}:
            reasoning_effort = "high"
        payload["reasoning"] = {"effort": reasoning_effort}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return _extract_openai_text(response.json())
    except Exception as exc:
        if raise_on_error:
            raise RuntimeError(_format_openai_api_error(exc)) from exc
        return ""


async def _extract_timesheet_shift_summary_from_transcript(
    transcript: str,
    document: dict,
    employee_hint: str = "",
    period_hint: str = "",
    raise_on_error: bool = False,
) -> dict:
    text = str(transcript or "").strip()
    if not text or not OPENAI_API_KEY:
        return {}

    prompt_text = (
        "Analyse cette transcription OCR d'une feuille de temps de Soins Expert Plus. "
        "Retourne uniquement un JSON compact avec les cles: "
        "is_timesheet, employee_name, employee_title, period_text, is_signed, visible_names, shifts, notes. "
        "visible_names doit etre une liste courte des noms lisibles sur le document. "
        "Chaque element de shifts doit contenir: "
        "date, day_label, start, end, pause_minutes, hours, type, unit, approver_name, notes. "
        "Si une valeur reste incertaine, laisse-la vide ou a 0. "
        "N'invente pas. Type doit etre regular, orientation ou unknown.\n\n"
        f"Nom du fichier: {document.get('filename', '')}\n"
        f"Employe attendu si connu: {employee_hint or 'inconnu'}\n"
        f"Periode attendue si connue: {period_hint or 'inconnue'}\n\n"
        f"Transcription OCR:\n{text[:14000]}"
    )
    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": (
            "Tu convertis une transcription OCR de FDT en donnees structurees pour la facturation. "
            "Sois prudent et n'invente rien."
        ),
        "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt_text}]}],
        "max_output_tokens": 1800,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        reasoning_effort = _normalized_reasoning_effort()
        if reasoning_effort in {"none", "low", "medium"}:
            reasoning_effort = "high"
        payload["reasoning"] = {"effort": reasoning_effort}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            parsed = _parse_json_object(_extract_openai_text(response.json()))
    except Exception as exc:
        if raise_on_error:
            raise RuntimeError(_format_openai_api_error(exc)) from exc
        return {}

    shifts = []
    for shift in parsed.get("shifts") or []:
        normalized = _normalize_shift_summary_item(shift)
        if normalized:
            shifts.append(normalized)

    is_signed = parsed.get("is_signed")
    if isinstance(is_signed, str):
        lowered = is_signed.strip().lower()
        if lowered in {"true", "oui", "yes"}:
            is_signed = True
        elif lowered in {"false", "non", "no"}:
            is_signed = False
        else:
            is_signed = None
    elif not isinstance(is_signed, bool):
        is_signed = None

    is_timesheet = parsed.get("is_timesheet")
    if isinstance(is_timesheet, str):
        is_timesheet = is_timesheet.strip().lower() in {"true", "oui", "yes"}
    elif not isinstance(is_timesheet, bool):
        is_timesheet = None

    return {
        "is_timesheet": is_timesheet,
        "employee_name": str(parsed.get("employee_name") or "").strip(),
        "employee_title": str(parsed.get("employee_title") or "").strip(),
        "period_text": str(parsed.get("period_text") or "").strip(),
        "is_signed": is_signed,
        "visible_names": [
            str(name).strip()
            for name in (parsed.get("visible_names") or [])
            if str(name).strip()
        ][:12],
        "shifts": shifts[:20],
        "notes": str(parsed.get("notes") or "").strip(),
    }


async def _describe_timesheet_document_with_openai(
    document: dict,
    employee_hint: str = "",
    transcript: str = "",
    raise_on_error: bool = False,
) -> str:
    if not OPENAI_API_KEY:
        return ""

    ext = _attachment_extension(document.get("filename", ""), document.get("mime_type", ""))
    file_data = document.get("file_data", b"") or b""
    content = None
    if ext in _VISION_ATTACHMENT_EXTENSIONS and file_data:
        mime_type = _mime_type_for_ai_review(document.get("filename", ""), document.get("mime_type", ""))
        content = [
            {
                "type": "input_text",
                "text": (
                    "Lis cette FDT comme le ferait un commis a la facturation. "
                    "Decris en francais ce que tu vois: nom employe, titre, periode, quarts ligne par ligne, pauses, unite/service, signataires, remarques, orientation, total approximatif et anomalies utiles. "
                    "Il vaut mieux donner une lecture approximative mais utile plutot que dire seulement que c'est partiel. "
                    "N'invente pas; dis 'illisible' quand necessaire. "
                    f"Employe attendu si connu: {employee_hint or 'inconnu'}."
                ),
            },
            {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{base64.b64encode(file_data).decode('ascii')}",
                "detail": "high",
            },
        ]
    elif transcript:
        content = [
            {
                "type": "input_text",
                "text": (
                    "Voici la transcription OCR d'une FDT. Resume clairement ce qui est visible et utile pour la facturation: "
                    "nom employe, titre, periode, quarts, pauses, unite/service, signataires, orientation et anomalies. "
                    "N'invente pas.\n\n"
                    f"{transcript[:14000]}"
                ),
            }
        ]
    else:
        return ""

    payload = {
        "model": TIMESHEET_ATTACHMENT_MODEL,
        "instructions": (
            "Tu aides un commis a comprendre rapidement une FDT difficile a lire. "
            "Retourne une reponse prose claire et concrete en francais."
        ),
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": 1800,
    }
    if _supports_reasoning(TIMESHEET_ATTACHMENT_MODEL):
        reasoning_effort = _normalized_reasoning_effort()
        if reasoning_effort in {"none", "low", "medium"}:
            reasoning_effort = "high"
        payload["reasoning"] = {"effort": reasoning_effort}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return _extract_openai_text(response.json()).strip()
    except Exception as exc:
        if raise_on_error:
            raise RuntimeError(_format_openai_api_error(exc)) from exc
        return ""


def serialize_timesheet_attachment(att: TimesheetAttachment) -> dict:
    return {
        "id": att.id,
        "timesheet_id": att.timesheet_id,
        "filename": att.filename,
        "original_filename": att.original_filename,
        "file_type": att.file_type,
        "file_size": att.file_size,
        "category": att.category,
        "description": att.description,
        "uploaded_by": att.uploaded_by,
        "source": att.source,
        "source_message_id": att.source_message_id,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


async def get_attachment_count_map(db: AsyncSession, model, fk_field, ids: Iterable) -> dict:
    ids = [item for item in ids if item is not None]
    if not ids:
        return {}
    result = await db.execute(
        select(fk_field, func.count(model.id))
        .where(fk_field.in_(ids))
        .group_by(fk_field)
    )
    return {row[0]: int(row[1] or 0) for row in result.all()}


async def find_timesheet(
    db: AsyncSession,
    employee_id: int,
    period_start: date,
    period_end: date,
) -> Optional[Timesheet]:
    result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id == employee_id,
            Timesheet.period_start == period_start,
            Timesheet.period_end == period_end,
        )
    )
    return result.scalar_one_or_none()


async def ensure_timesheet_for_period(
    db: AsyncSession,
    employee_id: int,
    period_start: date,
    period_end: date,
    status: str = "received",
    notes: str = "",
) -> tuple[Timesheet, bool]:
    existing = await find_timesheet(db, employee_id, period_start, period_end)
    if existing:
        if notes:
            current = (existing.notes or "").strip()
            if notes.strip() and notes.strip() not in current:
                existing.notes = f"{current}\n{notes}".strip() if current else notes.strip()
        if status and existing.status in {"draft", "received"}:
            existing.status = status
        return existing, False

    timesheet = Timesheet(
        id=new_id(),
        employee_id=employee_id,
        period_start=period_start,
        period_end=period_end,
        status=status,
        notes=(notes or "").strip(),
    )
    db.add(timesheet)
    await db.flush()
    return timesheet, True


async def find_accommodation_for_period(
    db: AsyncSession,
    employee_id: int,
    start_date: date,
    end_date: date,
) -> Optional[Accommodation]:
    result = await db.execute(
        select(Accommodation).where(
            Accommodation.employee_id == employee_id,
            Accommodation.start_date == start_date,
            Accommodation.end_date == end_date,
        )
    )
    return result.scalar_one_or_none()


async def ensure_accommodation_for_period(
    db: AsyncSession,
    employee_id: int,
    start_date: date,
    end_date: date,
    total_cost: float = 0.0,
    notes: str = "",
    pdf_name: str = "",
) -> tuple[Accommodation, bool]:
    existing = await find_accommodation_for_period(db, employee_id, start_date, end_date)
    span_days = max((end_date - start_date).days + 1, 1)
    rounded_total = round(float(total_cost or 0), 2)
    cost_per_day = round(rounded_total / span_days, 2) if rounded_total > 0 else 0.0
    if existing:
        if notes:
            current = (existing.notes or "").strip()
            cleaned = notes.strip()
            if cleaned and cleaned not in current:
                existing.notes = f"{current}\n{cleaned}".strip() if current else cleaned
        if rounded_total > 0 and float(existing.total_cost or 0) <= 0:
            existing.total_cost = rounded_total
        if cost_per_day > 0 and float(existing.cost_per_day or 0) <= 0:
            existing.cost_per_day = cost_per_day
        if int(existing.days_worked or 0) <= 0:
            existing.days_worked = span_days
        if pdf_name and not (existing.pdf_name or "").strip():
            existing.pdf_name = pdf_name.strip()
        return existing, False

    accommodation = Accommodation(
        id=new_id(),
        employee_id=employee_id,
        total_cost=rounded_total,
        start_date=start_date,
        end_date=end_date,
        days_worked=span_days,
        cost_per_day=cost_per_day,
        pdf_name=(pdf_name or "").strip(),
        notes=(notes or "").strip(),
    )
    db.add(accommodation)
    await db.flush()
    return accommodation, True


async def upsert_submitted_timesheet(db: AsyncSession, data) -> tuple[Timesheet, bool]:
    existing = await find_timesheet(db, data.employee_id, data.period_start, data.period_end)
    created = existing is None
    if existing:
        current = (existing.notes or "").strip()
        new_notes = (data.notes or "").strip()
        existing.notes = f"{current}\n{new_notes}".strip() if current and new_notes and new_notes not in current else (new_notes or current)
        existing.status = "submitted"
        shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == existing.id))
        for shift in shifts_result.scalars().all():
            await db.delete(shift)
        target = existing
    else:
        target = Timesheet(
            id=new_id(),
            employee_id=data.employee_id,
            period_start=data.period_start,
            period_end=data.period_end,
            status="submitted",
            notes=(data.notes or "").strip(),
        )
        db.add(target)
        await db.flush()

    for sh in data.shifts:
        db.add(
            TimesheetShift(
                id=new_id(),
                timesheet_id=target.id,
                schedule_id=sh.schedule_id,
                date=sh.date,
                hours_worked=sh.hours_worked,
                pause=sh.pause,
                garde_hours=sh.garde_hours,
                rappel_hours=sh.rappel_hours,
                km=getattr(sh, "km", 0),
                deplacement=getattr(sh, "deplacement", 0),
                autre_dep=getattr(sh, "autre_dep", 0),
                start_actual=sh.start_actual,
                end_actual=sh.end_actual,
            )
        )
    await db.flush()
    return target, created


async def add_timesheet_attachment(
    db: AsyncSession,
    timesheet_id: str,
    filename: str,
    file_data: bytes,
    content_type: str = "",
    category: str = "fdt",
    description: str = "",
    uploaded_by: str = "admin",
    source: str = "manual",
    source_message_id: str = "",
) -> tuple[TimesheetAttachment, bool]:
    original_filename = filename or "document"
    duplicate_query = select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet_id)
    if source_message_id:
        duplicate_query = duplicate_query.where(TimesheetAttachment.source_message_id == source_message_id)
        result = await db.execute(duplicate_query)
        duplicates = result.scalars().all()
        for existing in duplicates:
            if existing.original_filename == original_filename:
                return existing, False
    else:
        result = await db.execute(duplicate_query)
        duplicates = result.scalars().all()
        for existing in duplicates:
            if existing.original_filename == original_filename and int(existing.file_size or 0) == len(file_data or b""):
                return existing, False

    ext = _attachment_extension(original_filename, content_type)
    stored_name = original_filename
    attachment = TimesheetAttachment(
        timesheet_id=timesheet_id,
        filename=stored_name,
        original_filename=original_filename,
        file_type=ext,
        file_size=len(file_data or b""),
        file_data=file_data,
        category=category or "fdt",
        description=(description or "").strip(),
        uploaded_by=(uploaded_by or "admin").strip() or "admin",
        source=(source or "manual").strip() or "manual",
        source_message_id=(source_message_id or "").strip(),
    )
    db.add(attachment)
    await db.flush()
    return attachment, True


async def add_accommodation_attachment(
    db: AsyncSession,
    accommodation_id: str,
    filename: str,
    file_data: bytes,
    content_type: str = "",
    category: str = "hebergement",
    description: str = "",
    uploaded_by: str = "admin",
) -> tuple[AccommodationAttachment, bool]:
    original_filename = filename or "document"
    result = await db.execute(
        select(AccommodationAttachment).where(
            AccommodationAttachment.accommodation_id == accommodation_id
        )
    )
    duplicates = result.scalars().all()
    for existing in duplicates:
        if existing.original_filename == original_filename and int(existing.file_size or 0) == len(file_data or b""):
            return existing, False

    ext = _attachment_extension(original_filename, content_type)
    attachment = AccommodationAttachment(
        accommodation_id=accommodation_id,
        filename=original_filename,
        original_filename=original_filename,
        file_type=ext,
        file_size=len(file_data or b""),
        file_data=file_data,
        category=(category or "hebergement").strip() or "hebergement",
        description=(description or "").strip(),
        uploaded_by=(uploaded_by or "admin").strip() or "admin",
    )
    db.add(attachment)
    await db.flush()
    return attachment, True


async def sync_timesheet_attachments_to_reviews(
    db: AsyncSession,
    timesheet: Timesheet,
    approval: Optional[ScheduleApproval] = None,
) -> int:
    if not timesheet:
        return 0

    approvals = []
    if approval is not None:
        approvals = [approval]
    else:
        result = await db.execute(
            select(ScheduleApproval).where(
                ScheduleApproval.employee_id == timesheet.employee_id,
                ScheduleApproval.week_start == timesheet.period_start,
                ScheduleApproval.week_end == timesheet.period_end,
            )
        )
        approvals = result.scalars().all()

    if not approvals:
        return 0

    attachments_result = await db.execute(
        select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet.id)
    )
    timesheet_attachments = attachments_result.scalars().all()
    if not timesheet_attachments:
        return 0

    created = 0
    for review in approvals:
        existing_result = await db.execute(
            select(ScheduleApprovalAttachment).where(ScheduleApprovalAttachment.approval_id == review.id)
        )
        existing_attachments = existing_result.scalars().all()
        existing_keys = {
            (
                (item.original_filename or "").strip().lower(),
                int(item.file_size or 0),
                (item.category or "").strip().lower(),
            )
            for item in existing_attachments
        }
        for attachment in timesheet_attachments:
            key = (
                (attachment.original_filename or "").strip().lower(),
                int(attachment.file_size or 0),
                "fdt",
            )
            if key in existing_keys:
                continue
            db.add(
                ScheduleApprovalAttachment(
                    approval_id=review.id,
                    filename=attachment.filename,
                    original_filename=attachment.original_filename,
                    file_type=attachment.file_type,
                    file_size=attachment.file_size,
                    file_data=attachment.file_data,
                    category="fdt",
                    description=attachment.description or "Feuille de temps reçue",
                    uploaded_by=attachment.uploaded_by or "system",
                )
            )
            created += 1
    await db.flush()
    return created


def _match_text_against_employee(employee: Employee, candidates: list[str]) -> int:
    employee_name = _norm(employee.name)
    employee_tokens = set(employee_name.split())
    email_value = _norm(employee.email or "")
    best_score = 0
    for candidate in candidates:
        normalized = _norm(candidate)
        if not normalized:
            continue
        if email_value and normalized == email_value:
            best_score = max(best_score, 100)
        if employee_name and employee_name in normalized:
            best_score = max(best_score, 90)
        overlap = sum(1 for token in employee_tokens if token and token in normalized)
        if overlap:
            best_score = max(best_score, overlap * 20)
    return best_score


async def match_employee_from_email(
    db: AsyncSession,
    sender_header: str,
    subject: str = "",
    body_preview: str = "",
    attachment_names: Optional[list[str]] = None,
    extra_texts: Optional[list[str]] = None,
) -> tuple[Optional[Employee], str]:
    result = await db.execute(select(Employee))
    employees = result.scalars().all()
    sender_name, sender_email = parseaddr(sender_header or "")
    candidate_texts = [
        sender_header or "",
        sender_name or "",
        sender_email or "",
        subject or "",
        body_preview or "",
    ]
    candidate_texts.extend(attachment_names or [])
    candidate_texts.extend(extra_texts or [])

    exact_email_matches = [
        employee for employee in employees
        if sender_email and _norm(employee.email or "") == _norm(sender_email)
    ]
    if len(exact_email_matches) == 1:
        return exact_email_matches[0], "email"

    scored = []
    for employee in employees:
        score = _match_text_against_employee(employee, candidate_texts)
        if score > 0:
            scored.append((score, employee))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return None, ""
    if len(scored) == 1 or scored[0][0] > scored[1][0]:
        return scored[0][1], "nom"
    return None, ""


async def sync_timesheet_attachments_to_invoice(
    db: AsyncSession,
    timesheet: Optional[Timesheet],
    invoice: Optional[Invoice],
) -> int:
    if not timesheet or not invoice:
        return 0

    attachments_result = await db.execute(
        select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet.id)
    )
    timesheet_attachments = attachments_result.scalars().all()
    if not timesheet_attachments:
        return 0

    existing_result = await db.execute(
        select(InvoiceAttachment).where(InvoiceAttachment.invoice_id == invoice.id)
    )
    existing_items = existing_result.scalars().all()
    existing_keys = {
        (
            (item.original_filename or "").strip().lower(),
            int(item.file_size or 0),
            (item.category or "").strip().lower(),
        )
        for item in existing_items
    }

    created = 0
    for attachment in timesheet_attachments:
        key = (
            (attachment.original_filename or "").strip().lower(),
            int(attachment.file_size or 0),
            "fdt",
        )
        if key in existing_keys:
            continue
        db.add(
            InvoiceAttachment(
                invoice_id=invoice.id,
                filename=attachment.filename,
                original_filename=attachment.original_filename,
                file_type=attachment.file_type,
                file_size=attachment.file_size,
                file_data=attachment.file_data,
                category="fdt",
                description=attachment.description or "Feuille de temps recue par courriel",
                uploaded_by=attachment.uploaded_by or "system",
            )
        )
        created += 1
    await db.flush()
    return created


async def index_recent_timesheet_email_documents(
    db: AsyncSession,
    documents: list[dict],
    uploaded_by: str = "system",
) -> dict:
    grouped_documents: dict[str, list[dict]] = defaultdict(list)
    for document in documents or []:
        grouped_documents[str(document.get("message_id") or new_id())].append(document)

    indexed_items = []
    timesheet_items = []
    accommodation_items = []
    ignored_items = []
    unmatched_items = []
    created_timesheets = 0
    created_attachments = 0
    mirrored_review_attachments = 0
    created_accommodations = 0
    created_accommodation_attachments = 0

    for message_id, docs in grouped_documents.items():
        analyzed_docs = []
        for document in docs:
            extracted_text = extract_document_text_preview(
                document.get("filename", ""),
                document.get("mime_type", ""),
                document.get("file_data", b"") or b"",
            )
            employee, match_reason = await match_employee_from_email(
                db,
                document.get("from", ""),
                subject=document.get("subject", ""),
                body_preview=" ".join(
                    part for part in [document.get("body_preview", ""), extracted_text] if part
                ),
                attachment_names=[document.get("filename", ""), extracted_text],
            )
            analysis = analyze_timesheet_document(document, employee=employee, extracted_text=extracted_text)
            ai_review = {}
            if _should_use_ai_attachment_review(document, analysis, employee):
                ai_review = await inspect_attachment_with_openai(
                    document,
                    employee_hint=getattr(employee, "name", "") if employee else "",
                )
                if ai_review:
                    augmented_text_parts = [
                        extracted_text,
                        ai_review.get("employee_name_seen", ""),
                        ai_review.get("period_text_seen", ""),
                        ai_review.get("notes", ""),
                    ]
                    if not employee:
                        employee, match_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=" ".join(
                                part
                                for part in [
                                    document.get("body_preview", ""),
                                    ai_review.get("employee_name_seen", ""),
                                    ai_review.get("period_text_seen", ""),
                                    ai_review.get("notes", ""),
                                ]
                                if part
                            ),
                            attachment_names=[
                                document.get("filename", ""),
                                *[part for part in augmented_text_parts if part],
                            ],
                            extra_texts=[
                                ai_review.get("employee_name_seen", ""),
                                ai_review.get("period_text_seen", ""),
                            ],
                        )
                    elif ai_review.get("employee_name_seen"):
                        refined_employee, refined_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=document.get("body_preview", ""),
                            attachment_names=[document.get("filename", ""), extracted_text],
                            extra_texts=[ai_review.get("employee_name_seen", "")],
                        )
                        if refined_employee and refined_employee.id != employee.id:
                            employee = refined_employee
                            match_reason = refined_reason or "nom_document"
                    analysis = analyze_timesheet_document(
                        document,
                        employee=employee,
                        extracted_text=" ".join(part for part in augmented_text_parts if part),
                    )
                    analysis = merge_ai_attachment_analysis(analysis, ai_review)
            accommodation_analysis = analyze_accommodation_document(
                document,
                employee=employee,
                extracted_text=extracted_text,
            )
            accommodation_ai_review = {}
            if _should_use_ai_accommodation_review(document, accommodation_analysis, employee, extracted_text):
                accommodation_ai_review = await inspect_accommodation_document_with_openai(
                    document,
                    employee_hint=getattr(employee, "name", "") if employee else "",
                    extracted_text=extracted_text,
                )
                if accommodation_ai_review:
                    accommodation_augmented_text_parts = [
                        extracted_text,
                        accommodation_ai_review.get("employee_name_seen", ""),
                        accommodation_ai_review.get("period_text_seen", ""),
                        accommodation_ai_review.get("notes", ""),
                    ]
                    if not employee:
                        employee, match_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=" ".join(
                                part
                                for part in [
                                    document.get("body_preview", ""),
                                    accommodation_ai_review.get("employee_name_seen", ""),
                                    accommodation_ai_review.get("period_text_seen", ""),
                                    accommodation_ai_review.get("notes", ""),
                                ]
                                if part
                            ),
                            attachment_names=[
                                document.get("filename", ""),
                                *[part for part in accommodation_augmented_text_parts if part],
                            ],
                            extra_texts=[
                                accommodation_ai_review.get("employee_name_seen", ""),
                                accommodation_ai_review.get("period_text_seen", ""),
                            ],
                        )
                    elif accommodation_ai_review.get("employee_name_seen"):
                        refined_employee, refined_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=document.get("body_preview", ""),
                            attachment_names=[document.get("filename", ""), extracted_text],
                            extra_texts=[accommodation_ai_review.get("employee_name_seen", "")],
                        )
                        if refined_employee and refined_employee.id != employee.id:
                            employee = refined_employee
                            match_reason = refined_reason or "nom_document"
                    accommodation_analysis = analyze_accommodation_document(
                        document,
                        employee=employee,
                        extracted_text=" ".join(part for part in accommodation_augmented_text_parts if part),
                    )
                    accommodation_analysis = merge_ai_accommodation_analysis(
                        accommodation_analysis,
                        accommodation_ai_review,
                    )
            analyzed_docs.append(
                {
                    "document": document,
                    "employee": employee,
                    "match_reason": match_reason or "",
                    "analysis": analysis,
                    "extracted_text": extracted_text,
                    "ai_review": ai_review,
                    "accommodation_analysis": accommodation_analysis,
                    "accommodation_ai_review": accommodation_ai_review,
                }
            )

        selected_docs = _select_timesheet_candidates(analyzed_docs)
        selected_ids = {id(item) for item in selected_docs}
        selected_accommodation_docs = _select_accommodation_candidates(
            [item for item in analyzed_docs if id(item) not in selected_ids]
        )
        selected_accommodation_ids = {id(item) for item in selected_accommodation_docs}

        for item in selected_docs:
            document = item["document"]
            employee = item["employee"]
            if not employee:
                unmatched_items.append(
                    {
                        "message_id": message_id,
                        "filename": document.get("filename", ""),
                        "from": document.get("from", ""),
                        "subject": document.get("subject", ""),
                        "score": item["analysis"]["score"],
                        "ai_review": item.get("ai_review") or {},
                        "reason": "Employe introuvable",
                    }
                )
                continue

            reference_date = _safe_parse_message_date(document.get("date", ""))
            extracted_period = extract_period_from_text(
                " ".join(
                    part
                    for part in [
                        document.get("subject", ""),
                        document.get("body_preview", ""),
                        document.get("filename", ""),
                        item["extracted_text"],
                    ]
                    if part
                ),
                reference_date=reference_date,
            )
            if extracted_period:
                period_start, period_end = extracted_period
            else:
                period_start, period_end = completed_billing_period(reference_date)

            notes = f"FDT indexee depuis courriel: {document.get('subject', '')}".strip()
            timesheet, was_created = await ensure_timesheet_for_period(
                db,
                employee.id,
                period_start,
                period_end,
                status="received",
                notes=notes,
            )
            attachment, was_attached = await add_timesheet_attachment(
                db,
                timesheet_id=timesheet.id,
                filename=document.get("filename", "") or "document.pdf",
                file_data=document.get("file_data", b"") or b"",
                content_type=document.get("mime_type", "") or "",
                category="fdt",
                description=document.get("subject", "") or "FDT recue par courriel",
                uploaded_by=uploaded_by,
                source="email",
                source_message_id=document.get("message_id", "") or "",
            )
            mirrored = await sync_timesheet_attachments_to_reviews(db, timesheet)
            created_timesheets += 1 if was_created else 0
            created_attachments += 1 if was_attached else 0
            mirrored_review_attachments += mirrored
            payload = {
                "document_type": "fdt",
                "message_id": message_id,
                "employee_id": employee.id,
                "employee_name": employee.name,
                "match_reason": item["match_reason"] or "nom",
                "timesheet_id": timesheet.id,
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "attachment_id": attachment.id,
                "attachment_added": was_attached,
                "review_attachments_added": mirrored,
                "filename": attachment.original_filename,
                "score": item["analysis"]["score"],
                "analysis_reasons": item["analysis"]["reasons"],
                "ai_review": item.get("ai_review") or {},
            }
            indexed_items.append(payload)
            timesheet_items.append(payload)

        for item in selected_accommodation_docs:
            document = item["document"]
            employee = item["employee"]
            if not employee:
                unmatched_items.append(
                    {
                        "message_id": message_id,
                        "document_type": "hebergement",
                        "filename": document.get("filename", ""),
                        "from": document.get("from", ""),
                        "subject": document.get("subject", ""),
                        "score": item["accommodation_analysis"]["score"],
                        "ai_review": item.get("accommodation_ai_review") or {},
                        "reason": "Employe introuvable pour le document d'hebergement",
                    }
                )
                continue

            reference_date = _safe_parse_message_date(document.get("date", "")) or date.today()
            extracted_period = extract_period_from_text(
                " ".join(
                    part
                    for part in [
                        document.get("subject", ""),
                        document.get("body_preview", ""),
                        document.get("filename", ""),
                        item["extracted_text"],
                        (item.get("accommodation_ai_review") or {}).get("period_text_seen", ""),
                    ]
                    if part
                ),
                reference_date=reference_date,
            )
            if extracted_period:
                start_date, end_date = extracted_period
                period_note = ""
            else:
                start_date = reference_date
                end_date = reference_date
                period_note = " Periode a valider."

            amount_detected = round(
                float(
                    (item.get("accommodation_ai_review") or {}).get("total_cost")
                    or (item.get("accommodation_analysis") or {}).get("amount_detected")
                    or 0
                ),
                2,
            )
            vendor_name = str((item.get("accommodation_ai_review") or {}).get("vendor_name") or "").strip()
            notes = f"Document d'hebergement indexe depuis courriel: {document.get('subject', '')}".strip()
            if vendor_name:
                notes = f"{notes}\nFournisseur detecte: {vendor_name}".strip()
            ai_notes = str((item.get("accommodation_ai_review") or {}).get("notes") or "").strip()
            if ai_notes:
                notes = f"{notes}\n{ai_notes}".strip()
            if period_note:
                notes = f"{notes}\n{period_note.strip()}".strip()

            accommodation, was_created = await ensure_accommodation_for_period(
                db,
                employee.id,
                start_date,
                end_date,
                total_cost=amount_detected,
                notes=notes,
                pdf_name=document.get("filename", "") or "",
            )
            attachment, was_attached = await add_accommodation_attachment(
                db,
                accommodation_id=accommodation.id,
                filename=document.get("filename", "") or "document.pdf",
                file_data=document.get("file_data", b"") or b"",
                content_type=document.get("mime_type", "") or "",
                category="hebergement",
                description=document.get("subject", "") or "Document d'hebergement recu par courriel",
                uploaded_by=uploaded_by,
            )
            created_accommodations += 1 if was_created else 0
            created_accommodation_attachments += 1 if was_attached else 0
            payload = {
                "document_type": "hebergement",
                "message_id": message_id,
                "employee_id": employee.id,
                "employee_name": employee.name,
                "match_reason": item["match_reason"] or "nom",
                "accommodation_id": accommodation.id,
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
                "attachment_id": attachment.id,
                "attachment_added": was_attached,
                "filename": attachment.original_filename,
                "score": item["accommodation_analysis"]["score"],
                "analysis_reasons": item["accommodation_analysis"]["reasons"],
                "amount_detected": amount_detected,
                "ai_review": item.get("accommodation_ai_review") or {},
            }
            indexed_items.append(payload)
            accommodation_items.append(payload)

        for item in analyzed_docs:
            if id(item) in selected_ids or id(item) in selected_accommodation_ids:
                continue
            document = item["document"]
            reason = ", ".join(item["analysis"]["reasons"]) or ", ".join((item.get("accommodation_analysis") or {}).get("reasons") or [])
            ignored_items.append(
                {
                    "message_id": message_id,
                    "filename": document.get("filename", ""),
                    "from": document.get("from", ""),
                    "subject": document.get("subject", ""),
                    "score": max(
                        float((item.get("analysis") or {}).get("score") or 0),
                        float((item.get("accommodation_analysis") or {}).get("score") or 0),
                    ),
                    "ai_review": item.get("ai_review") or item.get("accommodation_ai_review") or {},
                    "reason": reason or "Piece jointe ignoree",
                }
            )

    return {
        "indexed_count": len(indexed_items),
        "created_timesheets": created_timesheets,
        "created_attachments": created_attachments,
        "mirrored_review_attachments": mirrored_review_attachments,
        "created_accommodations": created_accommodations,
        "created_accommodation_attachments": created_accommodation_attachments,
        "items": indexed_items,
        "timesheet_items": timesheet_items,
        "accommodation_items": accommodation_items,
        "ignored": ignored_items,
        "unmatched": unmatched_items,
    }


def _line_date(line: dict) -> str:
    return str(line.get("date") or "").strip()[:10]


def _line_hours(line: dict) -> float:
    try:
        return round(float(line.get("hours", 0) or 0), 2)
    except (TypeError, ValueError):
        return 0.0


async def build_timesheet_reconciliation(
    db: AsyncSession,
    employee: Employee,
    period_start: date,
    period_end: date,
    invoice_id: str = "",
    client_id: Optional[int] = None,
) -> dict:
    timesheet = await find_timesheet(db, employee.id, period_start, period_end)
    if not timesheet:
        return {
            "employee_id": employee.id,
            "employee_name": employee.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "confidence_score": 0.15,
            "confidence_level": "faible",
            "analysis_quality": "faible",
            "reasons": ["Aucune feuille de temps trouvée pour cette période."],
            "recommendation": "Indexer ou soumettre la FDT avant de concilier la facture.",
        }

    shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == timesheet.id))
    timesheet_shifts = shifts_result.scalars().all()
    attachments_result = await db.execute(select(TimesheetAttachment).where(TimesheetAttachment.timesheet_id == timesheet.id))
    timesheet_attachments = attachments_result.scalars().all()

    invoice_query = select(Invoice).where(
        Invoice.employee_id == employee.id,
        Invoice.period_start == period_start,
        Invoice.period_end == period_end,
        Invoice.status != InvoiceStatus.CANCELLED.value,
    )
    if invoice_id:
        invoice_query = invoice_query.where(Invoice.id == invoice_id)
    if client_id:
        invoice_query = invoice_query.where(Invoice.client_id == client_id)
    invoice_result = await db.execute(invoice_query)
    invoices = invoice_result.scalars().all()

    if not invoices:
        attachment_only = bool(timesheet_attachments) and not timesheet_shifts
        return {
            "timesheet_id": timesheet.id,
            "employee_id": employee.id,
            "employee_name": employee.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "attachment_count": len(timesheet_attachments),
            "shift_count": len(timesheet_shifts),
            "timesheet_hours": round(sum(float(item.hours_worked or 0) for item in timesheet_shifts), 2),
            "confidence_score": 0.42 if attachment_only else 0.3 if timesheet_shifts else 0.2,
            "confidence_level": "faible",
            "analysis_quality": "moyen" if timesheet_attachments else "faible",
            "reasons": ["Document FDT reçu, mais quarts non extraits." if attachment_only else "Aucune facture trouvée pour cette période."],
            "recommendation": "Générer la facture puis relancer la conciliation.",
        }

    timesheet_hours = round(sum(float(item.hours_worked or 0) for item in timesheet_shifts), 2)
    shift_by_schedule = {item.schedule_id: item for item in timesheet_shifts if item.schedule_id}

    scored = []
    for invoice in invoices:
        lines = list(getattr(invoice, "lines", None) or [])
        used_shift_ids = set()
        matched_line_count = 0
        matched_by_schedule_id = 0

        for line in lines:
            schedule_id = str(line.get("schedule_id") or "").strip()
            if schedule_id and schedule_id in shift_by_schedule and shift_by_schedule[schedule_id].id not in used_shift_ids:
                used_shift_ids.add(shift_by_schedule[schedule_id].id)
                matched_line_count += 1
                matched_by_schedule_id += 1
                continue

            line_date = _line_date(line)
            line_hours = _line_hours(line)
            for shift in timesheet_shifts:
                if shift.id in used_shift_ids:
                    continue
                if line_date and line_date != shift.date.isoformat():
                    continue
                if abs(round(float(shift.hours_worked or 0), 2) - line_hours) > 0.05:
                    continue
                used_shift_ids.add(shift.id)
                matched_line_count += 1
                break

        attachment_only = bool(timesheet_attachments) and not timesheet_shifts
        invoice_hours = round(sum(_line_hours(line) for line in lines), 2)
        unmatched_timesheet = max(len(timesheet_shifts) - matched_line_count, 0)
        unmatched_invoice = max(len(lines) - matched_line_count, 0)
        hours_gap = None if attachment_only else round(invoice_hours - timesheet_hours, 2)
        missing_schedule_links = sum(1 for line in lines if not line.get("schedule_id"))

        score = 1.0
        if len(invoices) > 1:
            score -= min(0.2, 0.08 * (len(invoices) - 1))
        if len(timesheet_attachments) == 0:
            score -= 0.1
        if hours_gap is not None and abs(hours_gap) > 0.01:
            score -= min(0.45, abs(hours_gap) / max(timesheet_hours or 1, 1) * 0.9)
        if len(timesheet_shifts):
            score -= min(0.2, unmatched_timesheet / len(timesheet_shifts) * 0.2)
        elif attachment_only:
            score -= 0.12
        if len(lines):
            score -= min(0.2, unmatched_invoice / len(lines) * 0.2)
        if missing_schedule_links:
            score -= min(0.1, missing_schedule_links / max(len(lines), 1) * 0.1)
        if matched_by_schedule_id == 0 and matched_line_count > 0:
            score -= 0.08
        score = round(max(0.05, min(score, 0.99)), 2)

        scored.append(
            {
                "invoice": invoice,
                "score": score,
                "invoice_hours": invoice_hours,
                "hours_gap": hours_gap,
                "matched_line_count": matched_line_count,
                "matched_by_schedule_id": matched_by_schedule_id,
                "unmatched_timesheet": unmatched_timesheet,
                "unmatched_invoice": unmatched_invoice,
                "missing_schedule_links": missing_schedule_links,
            }
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    best = scored[0]
    best_invoice = best["invoice"]
    confidence_score = float(best["score"])
    confidence_level = "élevé" if confidence_score >= 0.85 else "moyen" if confidence_score >= 0.6 else "faible"

    analysis_quality = "élevé"
    if not timesheet_attachments or best["missing_schedule_links"] > 0:
        analysis_quality = "moyen"
    if not timesheet_shifts or not invoices:
        analysis_quality = "faible"
    if timesheet_attachments and not timesheet_shifts:
        analysis_quality = "moyen"

    reasons = []
    if len(timesheet_attachments) > 0:
        reasons.append(f"{len(timesheet_attachments)} document(s) FDT rattaché(s) à la période.")
    else:
        reasons.append("Aucun document FDT n'est rattaché à cette période.")
    if len(invoices) > 1:
        reasons.append(f"{len(invoices)} factures existent pour cette période; la meilleure correspondance a été retenue.")
    if best["hours_gap"] is None:
        reasons.append("La FDT est rattachée en document, mais ses quarts ne sont pas encore extraits.")
    elif abs(best["hours_gap"]) <= 0.05:
        reasons.append("Les heures FDT et facture concordent.")
    else:
        reasons.append(f"Écart de {best['hours_gap']:+.2f} h entre la FDT et la facture.")
    if best["unmatched_timesheet"] > 0:
        reasons.append(f"{best['unmatched_timesheet']} quart(s) de la FDT n'ont pas trouvé de ligne facture.")
    if best["unmatched_invoice"] > 0:
        reasons.append(f"{best['unmatched_invoice']} ligne(s) facture ne correspondent pas clairement à la FDT.")
    if best["missing_schedule_links"] > 0:
        reasons.append(f"{best['missing_schedule_links']} ligne(s) facture n'ont pas de schedule_id, donc l'analyse est moins précise.")

    recommendation = "Conciliation prête."
    if best["hours_gap"] is None:
        recommendation = "Verifier visuellement la FDT jointe, puis confirmer ou ajuster la facture."
    elif confidence_level == "moyen":
        recommendation = "Vérifier les écarts signalés avant l'envoi final."
    if confidence_level == "faible":
        recommendation = "Valider manuellement la FDT, les quarts et la facture avant de poursuivre."

    client_name = ""
    if getattr(best_invoice, "client_id", None):
        client_result = await db.execute(select(Client).where(Client.id == best_invoice.client_id))
        client = client_result.scalar_one_or_none()
        client_name = client.name if client else (best_invoice.client_name or "")

    return {
        "timesheet_id": timesheet.id,
        "invoice_id": best_invoice.id,
        "invoice_number": best_invoice.number,
        "employee_id": employee.id,
        "employee_name": employee.name,
        "client_id": best_invoice.client_id,
        "client_name": client_name or (best_invoice.client_name or ""),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "timesheet_status": timesheet.status,
        "attachment_count": len(timesheet_attachments),
        "shift_count": len(timesheet_shifts),
        "invoice_line_count": len(getattr(best_invoice, "lines", None) or []),
        "timesheet_hours": timesheet_hours,
        "invoice_hours": best["invoice_hours"],
        "hours_gap": best["hours_gap"],
        "matched_line_count": best["matched_line_count"],
        "matched_by_schedule_id": best["matched_by_schedule_id"],
        "unmatched_timesheet_shifts": best["unmatched_timesheet"],
        "unmatched_invoice_lines": best["unmatched_invoice"],
        "confidence_score": confidence_score,
        "confidence_level": confidence_level,
        "analysis_quality": analysis_quality,
        "reasons": reasons,
        "recommendation": recommendation,
    }


async def build_timesheet_documents_summary(
    db: AsyncSession,
    group_by: str = "week",
    employee_id: Optional[int] = None,
) -> list[dict]:
    query = select(Timesheet).order_by(Timesheet.period_start.desc(), Timesheet.created_at.desc())
    if employee_id:
        query = query.where(Timesheet.employee_id == employee_id)
    result = await db.execute(query)
    timesheets = result.scalars().all()
    timesheet_ids = [timesheet.id for timesheet in timesheets]
    attachment_counts = await get_attachment_count_map(db, TimesheetAttachment, TimesheetAttachment.timesheet_id, timesheet_ids)

    grouped = {}
    for timesheet in timesheets:
        if group_by == "month":
            key = timesheet.period_start.strftime("%Y-%m")
            label = key
        else:
            key = timesheet.period_start.isoformat()
            label = f"Semaine du {timesheet.period_start.isoformat()}"
        bucket = grouped.setdefault(
            key,
            {"group_key": key, "label": label, "timesheet_count": 0, "document_count": 0, "hours": 0.0},
        )
        bucket["timesheet_count"] += 1
        bucket["document_count"] += attachment_counts.get(timesheet.id, 0)
        shifts_result = await db.execute(select(TimesheetShift).where(TimesheetShift.timesheet_id == timesheet.id))
        bucket["hours"] += sum(float(shift.hours_worked or 0) for shift in shifts_result.scalars().all())

    values = list(grouped.values())
    values.sort(key=lambda item: item["group_key"], reverse=True)
    for item in values:
        item["hours"] = round(item["hours"], 2)
    return values


async def summarize_recent_timesheet_documents(
    db: AsyncSession,
    documents: list[dict],
    employee: Optional[Employee] = None,
    raise_on_openai_error: bool = False,
) -> list[dict]:
    summaries = []
    grouped_documents: dict[str, list[dict]] = defaultdict(list)
    for document in documents or []:
        grouped_documents[str(document.get("message_id") or new_id())].append(document)

    for _, docs in grouped_documents.items():
        analyzed_docs = []
        for document in docs:
            extracted_text = extract_document_text_preview(
                document.get("filename", ""),
                document.get("mime_type", ""),
                document.get("file_data", b"") or b"",
            )
            matched_employee = employee
            match_reason = "filtre" if employee else ""
            if not matched_employee:
                matched_employee, match_reason = await match_employee_from_email(
                    db,
                    document.get("from", ""),
                    subject=document.get("subject", ""),
                    body_preview=" ".join(part for part in [document.get("body_preview", ""), extracted_text] if part),
                    attachment_names=[document.get("filename", ""), extracted_text],
                )
            analysis = analyze_timesheet_document(document, employee=matched_employee, extracted_text=extracted_text)
            ai_review = {}
            if _should_use_ai_attachment_review(document, analysis, matched_employee):
                ai_review = await inspect_attachment_with_openai(
                    document,
                    employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                    raise_on_error=raise_on_openai_error,
                )
                if ai_review:
                    if not matched_employee:
                        matched_employee, match_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=document.get("body_preview", ""),
                            attachment_names=[document.get("filename", ""), extracted_text],
                            extra_texts=[
                                ai_review.get("employee_name_seen", ""),
                                ai_review.get("period_text_seen", ""),
                                ai_review.get("notes", ""),
                            ],
                        )
                    elif ai_review.get("employee_name_seen"):
                        refined_employee, refined_reason = await match_employee_from_email(
                            db,
                            document.get("from", ""),
                            subject=document.get("subject", ""),
                            body_preview=document.get("body_preview", ""),
                            attachment_names=[document.get("filename", ""), extracted_text],
                            extra_texts=[ai_review.get("employee_name_seen", "")],
                        )
                        if refined_employee and refined_employee.id != matched_employee.id:
                            matched_employee = refined_employee
                            match_reason = refined_reason or "nom_document"
                    analysis = merge_ai_attachment_analysis(analysis, ai_review)
            analyzed_docs.append(
                {
                    "document": document,
                    "employee": matched_employee,
                    "match_reason": match_reason or "",
                    "analysis": analysis,
                    "extracted_text": extracted_text,
                    "ai_review": ai_review,
                }
            )

        selected_docs = _select_timesheet_candidates(analyzed_docs)
        for item in selected_docs:
            document = item["document"]
            matched_employee = item.get("employee")
            summary = await extract_timesheet_shift_summary(
                document,
                employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                period_hint=str((item.get("ai_review") or {}).get("period_text_seen") or ""),
                extracted_text=item.get("extracted_text", ""),
                raise_on_error=raise_on_openai_error,
            )
            if summary and summary.get("is_timesheet") is False and not (item.get("analysis") or {}).get("strong"):
                continue

            reference_date = _safe_parse_message_date(document.get("date", ""))
            period_source = " ".join(
                part
                for part in [
                    summary.get("period_text", "") if summary else "",
                    (item.get("ai_review") or {}).get("period_text_seen", ""),
                    document.get("subject", ""),
                    document.get("body_preview", ""),
                    document.get("filename", ""),
                    item.get("extracted_text", ""),
                ]
                if part
            )
            extracted_period = extract_period_from_text(period_source, reference_date=reference_date)
            period_start = extracted_period[0].isoformat() if extracted_period else ""
            period_end = extracted_period[1].isoformat() if extracted_period else ""
            shifts = list(summary.get("shifts") or [])
            summaries.append(
                {
                    "message_id": str(document.get("message_id") or ""),
                    "filename": str(document.get("filename") or ""),
                    "from": str(document.get("from") or ""),
                    "subject": str(document.get("subject") or ""),
                    "date": str(document.get("date") or ""),
                    "employee_name": getattr(matched_employee, "name", "") or str(summary.get("employee_name") or "").strip(),
                    "employee_id": getattr(matched_employee, "id", None),
                    "match_reason": item.get("match_reason") or "",
                    "confidence_score": float((item.get("analysis") or {}).get("score") or 0),
                    "analysis_reasons": list((item.get("analysis") or {}).get("reasons") or []),
                    "period_start": period_start,
                    "period_end": period_end,
                    "is_signed": summary.get("is_signed"),
                    "shift_count": len(shifts),
                    "shifts": shifts,
                    "notes": str(summary.get("notes") or "").strip(),
                }
            )

    return summaries


async def summarize_explicit_timesheet_documents(
    db: AsyncSession,
    documents: list[dict],
    employee: Optional[Employee] = None,
    raise_on_openai_error: bool = False,
) -> list[dict]:
    summaries = []
    for document in documents or []:
        extracted_text = extract_document_text_preview(
            document.get("filename", ""),
            document.get("mime_type", ""),
            document.get("file_data", b"") or b"",
        )
        matched_employee = employee
        match_reason = "filtre" if employee else ""
        if not matched_employee:
            matched_employee, match_reason = await match_employee_from_email(
                db,
                document.get("from", ""),
                subject=document.get("subject", ""),
                body_preview=" ".join(part for part in [document.get("body_preview", ""), extracted_text] if part),
                attachment_names=[document.get("filename", ""), extracted_text],
            )

        analysis = analyze_timesheet_document(document, employee=matched_employee, extracted_text=extracted_text)
        ai_review = {}
        if OPENAI_API_KEY:
            ai_review = await inspect_attachment_with_openai(
                document,
                employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                raise_on_error=raise_on_openai_error,
            )

        summary = await extract_timesheet_shift_summary(
            document,
            employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
            period_hint=str((ai_review or {}).get("period_text_seen") or ""),
            extracted_text=extracted_text,
            raise_on_error=raise_on_openai_error,
            force_timesheet=True,
        )
        transcript = ""
        if summary and not summary.get("shifts"):
            transcript = await _transcribe_timesheet_document_with_openai(
                document,
                employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                raise_on_error=raise_on_openai_error,
            )
            transcript_summary = await _extract_timesheet_shift_summary_from_transcript(
                transcript,
                document,
                employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                period_hint=str((ai_review or {}).get("period_text_seen") or ""),
                raise_on_error=raise_on_openai_error,
            )
            if transcript_summary and (
                transcript_summary.get("shifts")
                or transcript_summary.get("employee_name")
                or transcript_summary.get("visible_names")
            ):
                summary = transcript_summary
        prose_description = ""
        if summary:
            needs_prose_help = (
                not summary.get("shifts")
                or not summary.get("employee_name")
                or len(summary.get("visible_names") or []) < 2
            )
            if needs_prose_help:
                prose_description = await _describe_timesheet_document_with_openai(
                    document,
                    employee_hint=getattr(matched_employee, "name", "") if matched_employee else "",
                    transcript=transcript,
                    raise_on_error=raise_on_openai_error,
                )
        if not summary:
            continue

        if not matched_employee and summary.get("employee_name"):
            refined_employee, refined_reason = await match_employee_from_email(
                db,
                document.get("from", ""),
                subject=document.get("subject", ""),
                body_preview=document.get("body_preview", ""),
                attachment_names=[document.get("filename", ""), extracted_text],
                extra_texts=[summary.get("employee_name", "")] + list(summary.get("visible_names") or []) + ([transcript] if transcript else []),
            )
            if refined_employee:
                matched_employee = refined_employee
                match_reason = refined_reason or "nom_document"

        reference_date = _safe_parse_message_date(document.get("date", ""))
        period_source = " ".join(
            part
            for part in [
                summary.get("period_text", ""),
                (ai_review or {}).get("period_text_seen", ""),
                document.get("subject", ""),
                document.get("body_preview", ""),
                document.get("filename", ""),
                extracted_text,
            ]
            if part
        )
        extracted_period = extract_period_from_text(period_source, reference_date=reference_date)
        period_start = extracted_period[0].isoformat() if extracted_period else ""
        period_end = extracted_period[1].isoformat() if extracted_period else ""
        confidence_score = _summarize_explicit_timesheet_confidence(
            summary,
            analysis=analysis,
            ai_review=ai_review,
            matched_employee=matched_employee,
        )
        summaries.append(
            {
                "message_id": str(document.get("message_id") or ""),
                "filename": str(document.get("filename") or ""),
                "from": str(document.get("from") or ""),
                "subject": str(document.get("subject") or ""),
                "date": str(document.get("date") or ""),
                "employee_name": getattr(matched_employee, "name", "") or str(summary.get("employee_name") or "").strip(),
                "employee_id": getattr(matched_employee, "id", None),
                "employee_title": str(summary.get("employee_title") or "").strip(),
                "visible_names": list(summary.get("visible_names") or []),
                "match_reason": match_reason or "",
                "confidence_score": confidence_score,
                "analysis_reasons": list(analysis.get("reasons") or []),
                "period_start": period_start,
                "period_end": period_end,
                "is_signed": summary.get("is_signed"),
                "shift_count": len(summary.get("shifts") or []),
                "shifts": list(summary.get("shifts") or []),
                "notes": str(summary.get("notes") or "").strip() or ("Transcription OCR partielle disponible." if transcript else ""),
                "prose_description": prose_description,
            }
        )

    summaries.sort(
        key=lambda item: (
            float(item.get("confidence_score") or 0),
            item.get("shift_count") or 0,
            1 if item.get("employee_name") else 0,
        ),
        reverse=True,
    )
    return summaries


async def build_accommodation_documents_summary(
    db: AsyncSession,
    group_by: str = "week",
    employee_id: Optional[int] = None,
) -> list[dict]:
    query = select(Accommodation).order_by(Accommodation.start_date.desc())
    if employee_id:
        query = query.where(Accommodation.employee_id == employee_id)
    result = await db.execute(query)
    accommodations = result.scalars().all()
    accommodation_ids = [item.id for item in accommodations]
    attachment_counts = await get_attachment_count_map(
        db,
        AccommodationAttachment,
        AccommodationAttachment.accommodation_id,
        accommodation_ids,
    )

    grouped = {}
    for accommodation in accommodations:
        if group_by == "month":
            key = accommodation.start_date.strftime("%Y-%m")
            label = key
        else:
            week_start = accommodation.start_date - timedelta(days=(accommodation.start_date.weekday() + 1) % 7)
            key = week_start.isoformat()
            label = f"Semaine du {week_start.isoformat()}"
        bucket = grouped.setdefault(
            key,
            {"group_key": key, "label": label, "document_count": 0, "accommodation_count": 0, "total_cost": 0.0},
        )
        bucket["document_count"] += attachment_counts.get(accommodation.id, 0)
        bucket["accommodation_count"] += 1
        bucket["total_cost"] += float(accommodation.total_cost or 0)

    values = list(grouped.values())
    values.sort(key=lambda item: item["group_key"], reverse=True)
    for item in values:
        item["total_cost"] = round(item["total_cost"], 2)
    return values


def _contains_orientation_hint(*values: str) -> bool:
    combined = " ".join(_norm(value) for value in values if value)
    return any(keyword in combined for keyword in _ORIENTATION_KEYWORDS)


def _clamp_score(score: float) -> float:
    return round(max(0.05, min(float(score), 0.99)), 2)


def _score_to_level(score: float) -> str:
    if score >= 0.8:
        return "eleve"
    if score >= 0.55:
        return "moyen"
    return "faible"


def _estimate_weekly_accommodation_amount(accommodation: Accommodation, client_shifts: list[Schedule]) -> float:
    overlap_dates = {
        str(shift.date)
        for shift in client_shifts
        if accommodation.start_date <= shift.date <= accommodation.end_date
    }
    if not overlap_dates:
        return 0.0
    cost_per_day = float(accommodation.cost_per_day or 0)
    if cost_per_day <= 0:
        denominator = int(accommodation.days_worked or 0) or len(overlap_dates) or 1
        cost_per_day = float(accommodation.total_cost or 0) / denominator
    return round(cost_per_day * len(overlap_dates), 2)


async def build_weekly_validation_queue(
    db: AsyncSession,
    week_start: date,
    week_end: Optional[date] = None,
) -> dict:
    ws = week_start
    we = week_end or (ws + timedelta(days=6))

    schedules_result = await db.execute(
        select(Schedule).where(
            Schedule.date >= ws,
            Schedule.date <= we,
            Schedule.status != "cancelled",
        )
    )
    week_schedules = schedules_result.scalars().all()
    if not week_schedules:
        return {"week_start": ws.isoformat(), "week_end": we.isoformat(), "counts": {"eleve": 0, "moyen": 0, "faible": 0}, "items": []}

    employee_ids = sorted({int(schedule.employee_id) for schedule in week_schedules if schedule.employee_id is not None})
    explicit_client_ids = sorted({int(schedule.client_id) for schedule in week_schedules if schedule.client_id is not None})

    employee_result = await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
    employees = {employee.id: employee for employee in employee_result.scalars().all()}

    fallback_client_ids = {
        int(employee.client_id)
        for employee in employees.values()
        if getattr(employee, "client_id", None) is not None
    }
    client_ids = sorted(set(explicit_client_ids) | fallback_client_ids)
    client_result = await db.execute(select(Client).where(Client.id.in_(client_ids))) if client_ids else None
    clients = {client.id: client for client in (client_result.scalars().all() if client_result is not None else [])}

    grouped_schedules = defaultdict(list)
    for schedule in week_schedules:
        employee = employees.get(schedule.employee_id)
        resolved_client_id = schedule.client_id or getattr(employee, "client_id", None)
        grouped_schedules[(schedule.employee_id, resolved_client_id)].append(schedule)

    approval_result = await db.execute(
        select(ScheduleApproval).where(
            ScheduleApproval.week_start == ws,
            ScheduleApproval.employee_id.in_(employee_ids),
        )
    )
    approvals = {
        (approval.employee_id, approval.client_id): approval
        for approval in approval_result.scalars().all()
    }

    timesheet_result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id.in_(employee_ids),
            Timesheet.period_start == ws,
            Timesheet.period_end == we,
        )
    )
    timesheets = {timesheet.employee_id: timesheet for timesheet in timesheet_result.scalars().all()}
    timesheet_ids = [timesheet.id for timesheet in timesheets.values()]
    timesheet_attachment_counts = await get_attachment_count_map(db, TimesheetAttachment, TimesheetAttachment.timesheet_id, timesheet_ids)

    timesheet_shift_map: dict[str, list[TimesheetShift]] = defaultdict(list)
    if timesheet_ids:
        timesheet_shift_result = await db.execute(
            select(TimesheetShift).where(TimesheetShift.timesheet_id.in_(timesheet_ids))
        )
        for shift in timesheet_shift_result.scalars().all():
            timesheet_shift_map[shift.timesheet_id].append(shift)

    review_attachment_counts = {}
    if approvals:
        approval_ids = [approval.id for approval in approvals.values()]
        review_attachment_counts = await get_attachment_count_map(
            db,
            ScheduleApprovalAttachment,
            ScheduleApprovalAttachment.approval_id,
            approval_ids,
        )

    invoice_result = await db.execute(
        select(Invoice).where(
            Invoice.employee_id.in_(employee_ids),
            Invoice.period_start == ws,
            Invoice.period_end == we,
            Invoice.status != InvoiceStatus.CANCELLED.value,
        )
    )
    invoices_by_key: dict[tuple[int, int | None], list[Invoice]] = defaultdict(list)
    for invoice in invoice_result.scalars().all():
        invoices_by_key[(invoice.employee_id, invoice.client_id)].append(invoice)
    for invoice_list in invoices_by_key.values():
        invoice_list.sort(key=lambda invoice: invoice.created_at or datetime.min, reverse=True)

    invoice_ids = [invoice.id for invoice_list in invoices_by_key.values() for invoice in invoice_list]
    invoice_attachment_counts = await get_attachment_count_map(db, InvoiceAttachment, InvoiceAttachment.invoice_id, invoice_ids)
    invoice_attachment_categories: dict[str, set[str]] = defaultdict(set)
    if invoice_ids:
        invoice_attachment_result = await db.execute(
            select(InvoiceAttachment).where(InvoiceAttachment.invoice_id.in_(invoice_ids))
        )
        for attachment in invoice_attachment_result.scalars().all():
            invoice_attachment_categories[str(attachment.invoice_id)].add(str(attachment.category or "").strip().lower())

    accommodation_result = await db.execute(
        select(Accommodation).where(
            Accommodation.employee_id.in_(employee_ids),
            Accommodation.start_date <= we,
            Accommodation.end_date >= ws,
        )
    )
    accommodations_by_employee: dict[int, list[Accommodation]] = defaultdict(list)
    accommodations = accommodation_result.scalars().all()
    for accommodation in accommodations:
        accommodations_by_employee[accommodation.employee_id].append(accommodation)
    accommodation_ids = [accommodation.id for accommodation in accommodations]
    accommodation_attachment_counts = await get_attachment_count_map(
        db,
        AccommodationAttachment,
        AccommodationAttachment.accommodation_id,
        accommodation_ids,
    )

    items = []
    for (employee_id, resolved_client_id), client_schedules in grouped_schedules.items():
        employee = employees.get(employee_id)
        client = clients.get(resolved_client_id) if resolved_client_id else None
        client_name = client.name if client else "Client a confirmer"
        schedule_shift_ids = {str(schedule.id) for schedule in client_schedules}

        scheduled_hours = round(sum(float(schedule.hours or 0) for schedule in client_schedules), 2)
        shift_count = len(client_schedules)
        total_km = round(sum(float(schedule.km or 0) for schedule in client_schedules), 2)
        total_deplacement = round(sum(float(schedule.deplacement or 0) for schedule in client_schedules), 2)
        total_other_expenses = round(sum(float(schedule.autre_dep or 0) for schedule in client_schedules), 2)

        timesheet = timesheets.get(employee_id)
        timesheet_shifts = timesheet_shift_map.get(timesheet.id, []) if timesheet else []
        relevant_timesheet_shifts = [
            shift for shift in timesheet_shifts
            if str(shift.schedule_id or "") in schedule_shift_ids
        ]
        timesheet_shift_count = len(relevant_timesheet_shifts)
        timesheet_attachment_count = int(timesheet_attachment_counts.get(timesheet.id, 0)) if timesheet else 0
        has_timesheet_document_only = bool(timesheet) and timesheet_attachment_count > 0 and timesheet_shift_count == 0
        timesheet_hours = None if has_timesheet_document_only else round(sum(float(shift.hours_worked or 0) for shift in relevant_timesheet_shifts), 2)
        hours_gap_schedule_vs_timesheet = (
            None
            if not timesheet or has_timesheet_document_only
            else round(float(timesheet_hours or 0) - scheduled_hours, 2)
        )

        approval = approvals.get((employee_id, resolved_client_id)) if resolved_client_id else None
        review_attachment_count = int(review_attachment_counts.get(approval.id, 0)) if approval else 0

        invoice = (invoices_by_key.get((employee_id, resolved_client_id)) or [None])[0]
        invoice_lines = list(getattr(invoice, "lines", None) or []) if invoice else []
        invoice_hours = round(sum(_line_hours(line) for line in invoice_lines), 2) if invoice else 0.0
        invoice_hours_gap = round(invoice_hours - timesheet_hours, 2) if invoice and timesheet and timesheet_hours is not None else None
        invoice_attachment_count = int(invoice_attachment_counts.get(invoice.id, 0)) if invoice else 0
        invoice_categories = invoice_attachment_categories.get(str(invoice.id), set()) if invoice else set()

        overlapping_accommodations = accommodations_by_employee.get(employee_id, [])
        accommodation_amount = 0.0
        accommodation_doc_count = 0
        accommodation_count = 0
        for accommodation in overlapping_accommodations:
            amount = _estimate_weekly_accommodation_amount(accommodation, client_schedules)
            if amount <= 0:
                continue
            accommodation_count += 1
            accommodation_amount += amount
            accommodation_doc_count += int(accommodation_attachment_counts.get(accommodation.id, 0))
        accommodation_amount = round(accommodation_amount, 2)

        orientation_shift_count = 0
        if _contains_orientation_hint(getattr(employee, "position", "")):
            orientation_shift_count = shift_count
        else:
            orientation_shift_count = sum(
                1
                for schedule in client_schedules
                if _contains_orientation_hint(schedule.notes or "", schedule.location or "")
            )
        regular_shift_count = max(shift_count - orientation_shift_count, 0)
        missing_expense_notes = sum(
            1
            for schedule in client_schedules
            if (float(schedule.autre_dep or 0) > 0 or float(schedule.deplacement or 0) > 0)
            and not (schedule.notes or "").strip()
        )

        flags = []
        if not resolved_client_id:
            flags.append("client_a_confirmer")
        if not timesheet:
            flags.append("fdt_manquante")
        elif timesheet_attachment_count <= 0:
            flags.append("fdt_sans_piece_jointe")
        elif has_timesheet_document_only:
            flags.append("lecture_fdt_a_verifier")
        else:
            flags.append("signature_a_verifier")
        if timesheet and hours_gap_schedule_vs_timesheet is not None and abs(hours_gap_schedule_vs_timesheet) > 0.05:
            flags.append("ecart_horaire_fdt")
        if orientation_shift_count > 0:
            flags.append("orientation_a_verifier")
        if missing_expense_notes > 0:
            flags.append("frais_sans_note")
        if accommodation_amount > 0 and accommodation_doc_count <= 0:
            flags.append("hebergement_sans_facture")
        if invoice and timesheet_attachment_count > 0 and "fdt" not in invoice_categories:
            flags.append("fdt_non_jointe_a_facture")
        if invoice and accommodation_amount > 0 and "hebergement" not in invoice_categories:
            flags.append("hebergement_non_joint_a_facture")
        if invoice and invoice_attachment_count <= 0:
            flags.append("facture_sans_piece_jointe")
        if invoice and timesheet and invoice_hours_gap is not None and abs(invoice_hours_gap) > 0.05:
            flags.append("ecart_facture_fdt")

        confidence_score = 0.58
        if resolved_client_id:
            confidence_score += 0.04
        else:
            confidence_score -= 0.18
        if timesheet:
            confidence_score += 0.12
        else:
            confidence_score -= 0.28
        if timesheet_attachment_count > 0:
            confidence_score += 0.08
        else:
            confidence_score -= 0.12
        if has_timesheet_document_only:
            confidence_score -= 0.10
        elif timesheet and abs(hours_gap_schedule_vs_timesheet) <= 0.05:
            confidence_score += 0.14
        elif timesheet:
            confidence_score -= min(0.22, abs(hours_gap_schedule_vs_timesheet) / max(scheduled_hours or 1, 1) * 0.45)
        if approval and approval.status == "approved":
            confidence_score += 0.06
        elif approval:
            confidence_score += 0.02
        if invoice:
            confidence_score += 0.05
            if invoice_attachment_count > 0:
                confidence_score += 0.03
            if invoice_hours_gap is not None and abs(invoice_hours_gap) <= 0.05:
                confidence_score += 0.08
            elif invoice_hours_gap is not None:
                confidence_score -= min(0.18, abs(invoice_hours_gap) / max(timesheet_hours or scheduled_hours or 1, 1) * 0.4)
        if orientation_shift_count > 0:
            confidence_score -= min(0.12, 0.04 * orientation_shift_count)
        if missing_expense_notes > 0:
            confidence_score -= min(0.1, 0.04 * missing_expense_notes)
        if accommodation_amount > 0:
            confidence_score += 0.02 if accommodation_doc_count > 0 else -0.08

        confidence_score = _clamp_score(confidence_score)
        confidence_level = _score_to_level(confidence_score)
        analysis_quality = "eleve" if invoice and timesheet and timesheet_attachment_count > 0 and timesheet_shift_count > 0 else "moyen" if timesheet else "faible"

        recommendations = []
        if "fdt_manquante" in flags:
            recommendations.append("Attendre ou indexer la FDT avant de facturer.")
        if "signature_a_verifier" in flags:
            recommendations.append("Verifier manuellement que la FDT est bien signee.")
        if "lecture_fdt_a_verifier" in flags:
            recommendations.append("FDT recue en piece jointe; valider visuellement son contenu avant envoi final.")
        if "ecart_horaire_fdt" in flags:
            recommendations.append("Comparer les quarts FDT avec l'horaire et ajuster avant facture.")
        if "orientation_a_verifier" in flags:
            recommendations.append("Valider les quarts d'orientation avant la facturation finale.")
        if "hebergement_sans_facture" in flags:
            recommendations.append("Ajouter la facture d'hebergement avant l'envoi au client.")
        if "fdt_non_jointe_a_facture" in flags or "hebergement_non_joint_a_facture" in flags:
            recommendations.append("Joindre toutes les pieces justificatives a la facture avant l'envoi.")
        if not recommendations:
            recommendations.append("Dossier solide; faire la verification finale puis envoyer la facture.")

        items.append({
            "employee_id": employee_id,
            "employee_name": employee.name if employee else f"#{employee_id}",
            "employee_position": getattr(employee, "position", "") or "",
            "client_id": resolved_client_id,
            "client_name": client_name,
            "week_start": ws.isoformat(),
            "week_end": we.isoformat(),
            "shift_count": shift_count,
            "regular_shift_count": regular_shift_count,
            "orientation_shift_count": orientation_shift_count,
            "scheduled_hours": scheduled_hours,
            "timesheet_id": timesheet.id if timesheet else None,
            "timesheet_status": timesheet.status if timesheet else "missing",
            "timesheet_shift_count": timesheet_shift_count,
            "timesheet_hours": round(float(timesheet_hours or 0), 2) if timesheet_hours is not None else None,
            "timesheet_attachment_count": timesheet_attachment_count,
            "signature_status": "document_recu" if has_timesheet_document_only else "a_verifier" if timesheet_attachment_count > 0 else "document_manquant",
            "hours_gap_schedule_vs_timesheet": hours_gap_schedule_vs_timesheet if timesheet else None,
            "review_id": approval.id if approval else None,
            "review_status": approval.status if approval else "missing",
            "review_attachment_count": review_attachment_count,
            "invoice_id": invoice.id if invoice else None,
            "invoice_number": invoice.number if invoice else "",
            "invoice_status": invoice.status if invoice else "missing",
            "invoice_total": round(float(invoice.total or 0), 2) if invoice else 0.0,
            "invoice_hours": invoice_hours if invoice else None,
            "hours_gap_invoice_vs_timesheet": invoice_hours_gap,
            "invoice_attachment_count": invoice_attachment_count,
            "invoice_attachment_categories": sorted(invoice_categories),
            "total_km": total_km,
            "total_deplacement_hours": total_deplacement,
            "total_other_expenses": total_other_expenses,
            "accommodation_count": accommodation_count,
            "accommodation_amount": accommodation_amount,
            "accommodation_attachment_count": accommodation_doc_count,
            "confidence_score": confidence_score,
            "confidence_level": confidence_level,
            "analysis_quality": analysis_quality,
            "flags": flags,
            "recommendations": recommendations,
        })

    items.sort(key=lambda item: ({"faible": 0, "moyen": 1, "eleve": 2}.get(item["confidence_level"], 3), item["employee_name"], item["client_name"]))
    counts = {"eleve": 0, "moyen": 0, "faible": 0}
    for item in items:
        counts[item["confidence_level"]] = counts.get(item["confidence_level"], 0) + 1

    return {
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "counts": counts,
        "items": items,
    }
