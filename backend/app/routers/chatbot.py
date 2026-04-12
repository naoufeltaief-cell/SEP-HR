"""
Soins Expert Plus — Dual Agent System
OpenAI Responses API + business tools.
"""
import os
import json
import re
import unicodedata
import httpx
import imaplib
import email as email_lib
from email.header import decode_header
from email.utils import getaddresses
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from ..database import get_db
from ..models.models import ChatbotUpload, Client, Employee, Schedule, Accommodation, InvoiceAttachment, new_id
from ..models.models_invoice import AuditAction, Invoice, InvoiceAuditLog, InvoiceStatus
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin
from ..services.billing_gmail_oauth import (
    create_billing_gmail_draft,
    get_billing_gmail_connection,
    list_recent_billing_gmail_documents,
    list_recent_billing_gmail_messages,
    send_via_connected_billing_gmail,
)
from ..services.automation_service import (
    draft_weekly_timesheet_reminder,
    get_automation_config,
    process_incoming_timesheet_emails,
    send_weekly_timesheet_reminder,
)
from ..services.email_service import _send_email, BILLING_SENDER_EMAIL
from ..services.invoice_service import generate_invoice_number, recalculate_invoice, is_tax_exempt, get_rate_for_title, get_schedule_billable_rate, GARDE_RATE, KM_RATE, MAX_KM, MAX_DEPLACEMENT_HOURS, schedule_pause_to_invoice_minutes, build_shift_expense_description
from ..services.timesheet_service import (
    build_accommodation_documents_summary,
    build_timesheet_documents_summary,
    build_timesheet_reconciliation,
    completed_billing_period,
    index_recent_timesheet_email_documents,
    summarize_explicit_timesheet_documents,
    summarize_recent_timesheet_documents,
)

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
OPENAI_REASONING_EFFORT = (os.getenv("OPENAI_REASONING_EFFORT", "medium") or "medium").strip().lower()
CURRENT_YEAR = date.today().year
IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_USER = (
    os.getenv("IMAP_USER_PAIE")
    or os.getenv("IMAP_USER")
    or os.getenv("SMTP_USER_PAIE")
    or os.getenv("SMTP_USER")
    or BILLING_SENDER_EMAIL
)
IMAP_PASS = (
    os.getenv("IMAP_PASS_PAIE")
    or os.getenv("IMAP_PASS")
    or os.getenv("SMTP_PASS_PAIE")
    or os.getenv("SMTP_PASS")
    or ""
)

CHATBOT_ALLOWED_MIME = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
}
CHATBOT_MAX_FILE_SIZE = 15 * 1024 * 1024

BUSINESS_KNOWLEDGE = """
TAUX DE FACTURATION PAR TITRE D'EMPLOI:
- Infirmier(ère) / Infirmier(ère) Clinicien(ne): 86.23 $/h
- Infirmier(ère) auxiliaire: 57.18 $/h
- Préposé(e) aux bénéficiaires (PAB): 50.35 $/h
- Éducateur(trice): Variable selon entente
- Agent administratif: Variable selon entente

RÈGLES DE FACTURATION:
- Période de facturation: Dimanche au Samedi
- Garde: 8 heures de garde = 1 heure facturable au taux de 86.23$/h
- Kilométrage: 0.525 $/km (max 750 km aller, 1500 km aller-retour)
- Déplacement: Max 8 heures par déplacement, facturable une seule fois par assignation
- Exception CISSS Gaspésie: déplacement remboursé une seule fois par assignation
- Hébergement: coût total / nombre total de quarts travaillés sur la période d'hébergement, puis multiplié par les quarts de la période facturée
- TPS: 5% (numéro: 714564891RT0001)
- TVQ: 9.975% (numéro: 1225765936TQ0001)
- Clients exemptés de taxes: Centre de Santé Inuulitsivik, Conseil Cri de la Santé
"""

RAW_TOOLS = [
    {"name": "search_employees", "description": "Rechercher des employés par nom, poste ou email.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "search_clients", "description": "Rechercher des clients par nom.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "get_employee_schedule", "description": "Obtenir l'horaire d'un employé pour une période donnée.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "start_date": {"type": "string"}, "end_date": {"type": "string"}}, "required": []}},
    {"name": "generate_invoice_for_employee", "description": "Générer une facture brouillon à partir des horaires d'un employé pour une période donnée. Utiliser quand on te demande explicitement de générer une facture.", "input_schema": {"type": "object", "properties": {"employee_name": {"type": "string"}, "employee_id": {"type": "integer"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}}, "required": ["period_start", "period_end"]}},
    {"name": "read_recent_emails", "description": "Lire les courriels récents de la boîte de réception.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 10}, "search": {"type": "string"}, "folder": {"type": "string", "default": "INBOX"}}}},
    {"name": "generate_current_invoice_for_employee", "description": "Generer une facture brouillon pour la periode actuelle de facturation d'un employe.", "input_schema": {"type": "object", "properties": {"employee_name": {"type": "string"}, "employee_id": {"type": "integer"}, "client_name": {"type": "string"}, "client_id": {"type": "integer"}}, "required": []}},
    {"name": "get_invoice_details", "description": "Retrouver une facture et retourner ses lignes modifiables. Utiliser avant de modifier une facture brouillon existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "draft_only": {"type": "boolean", "default": False}}, "required": []}},
    {"name": "update_invoice_service_line", "description": "Modifier un quart deja present dans une facture brouillon existante. Utiliser quand l'utilisateur veut changer une pause, une heure, un taux, debut/fin ou supprimer un quart directement dans la facture et non dans l'horaire.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "schedule_id": {"type": "string"}, "date": {"type": "string"}, "current_start": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "pause_min": {"type": "number"}, "hours": {"type": "number"}, "rate": {"type": "number"}, "garde_hours": {"type": "number"}, "rappel_hours": {"type": "number"}, "delete": {"type": "boolean", "default": False}}, "required": []}},
    {"name": "add_invoice_expense_line", "description": "Ajouter un frais directement dans une facture brouillon existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "type": {"type": "string"}, "description": {"type": "string"}, "quantity": {"type": "number"}, "rate": {"type": "number"}, "amount": {"type": "number"}}, "required": ["description"]}},
    {"name": "delete_invoice_expense_line", "description": "Supprimer un frais d'une facture brouillon existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "description": {"type": "string"}, "type": {"type": "string"}}, "required": ["description"]}},
    {"name": "add_invoice_accommodation_per_worked_day", "description": "Ajouter un frais d'hebergement par journee travaillee directement dans une facture brouillon existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "cost_per_day": {"type": "number"}, "replace_existing": {"type": "boolean", "default": False}}, "required": ["cost_per_day"]}},
    {"name": "delete_invoice_accommodation_line", "description": "Supprimer une ligne d'hebergement d'une facture brouillon existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "period": {"type": "string"}}, "required": ["period"]}},
    {"name": "list_chat_session_documents", "description": "Lister les documents joints dans cette conversation chatbot pour pouvoir les rattacher ensuite a une facture ou a un courriel.", "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "analyze_chat_session_documents", "description": "Analyser les documents joints dans cette conversation, surtout une FDT ou un justificatif depose directement dans le chat, et extraire les quarts, pauses, dates, signature et periode detectees.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 5}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}, "required": []}},
    {"name": "attach_chat_documents_to_invoice", "description": "Joindre un ou plusieurs documents televerses dans cette conversation a une facture existante.", "input_schema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "invoice_number": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "document_ids": {"type": "array", "items": {"type": "string"}}, "filename_query": {"type": "string"}, "attach_all_session_documents": {"type": "boolean", "default": False}, "category": {"type": "string"}, "description": {"type": "string"}}, "required": []}},
    {"name": "resolve_contact_email", "description": "Retrouver une adresse courriel a partir du nom d'un employe ou d'un client avant d'envoyer un courriel.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "create_email_draft", "description": "Creer un vrai brouillon Gmail dans la boite paie. Utiliser seulement quand l'utilisateur demande explicitement de creer, enregistrer ou mettre un message dans les brouillons Gmail. Peut aussi servir pour un brouillon de masse avec CC ou CCI. Ne jamais envoyer le message.", "input_schema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body_text": {"type": "string"}, "body_html": {"type": "string"}, "thread_id": {"type": "string"}, "in_reply_to": {"type": "string"}, "references": {"type": "string"}, "cc": {"type": "string"}, "bcc": {"type": "string"}, "cc_list": {"type": "array", "items": {"type": "string"}}, "bcc_list": {"type": "array", "items": {"type": "string"}}, "document_ids": {"type": "array", "items": {"type": "string"}}, "filename_query": {"type": "string"}, "attach_all_session_documents": {"type": "boolean", "default": False}}, "required": ["to", "subject", "body_text"]}},
    {"name": "send_email", "description": "Envoyer immediatement un courriel. Ne jamais utiliser pour un brouillon Gmail ou si l'utilisateur veut revoir le message avant envoi.", "input_schema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body_html": {"type": "string"}, "document_ids": {"type": "array", "items": {"type": "string"}}, "filename_query": {"type": "string"}, "attach_all_session_documents": {"type": "boolean", "default": False}}, "required": ["to", "subject", "body_html"]}},
    {"name": "create_schedule_shift", "description": "Creer un quart dans l'horaire. Les heures doivent etre en format 24 h HH:MM.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "date": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "pause_minutes": {"type": "number"}, "pause_hours": {"type": "number"}, "hours": {"type": "number"}, "location": {"type": "string"}, "billable_rate": {"type": "number"}, "status": {"type": "string"}, "notes": {"type": "string"}, "km": {"type": "number"}, "deplacement": {"type": "number"}, "autre_dep": {"type": "number"}, "garde_hours": {"type": "number"}, "rappel_hours": {"type": "number"}}, "required": ["date", "start", "end"]}},
    {"name": "update_schedule_shift", "description": "Modifier un quart existant. Utiliser schedule_id en priorite. Sinon identifier le quart avec employe + current_date + current_start.", "input_schema": {"type": "object", "properties": {"schedule_id": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "current_date": {"type": "string"}, "current_start": {"type": "string"}, "current_end": {"type": "string"}, "date": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "pause_minutes": {"type": "number"}, "pause_hours": {"type": "number"}, "hours": {"type": "number"}, "location": {"type": "string"}, "billable_rate": {"type": "number"}, "status": {"type": "string"}, "notes": {"type": "string"}, "km": {"type": "number"}, "deplacement": {"type": "number"}, "autre_dep": {"type": "number"}, "garde_hours": {"type": "number"}, "rappel_hours": {"type": "number"}}, "required": []}},
    {"name": "delete_schedule_shift", "description": "Supprimer un quart existant. Utiliser schedule_id en priorite. Sinon identifier le quart avec employe + current_date + current_start.", "input_schema": {"type": "object", "properties": {"schedule_id": {"type": "string"}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}, "current_date": {"type": "string"}, "current_start": {"type": "string"}, "current_end": {"type": "string"}}, "required": []}},
    {"name": "get_candidates", "description": "Lister les employés actifs, avec filtres par titre/région, pour soumission ou assignation.", "input_schema": {"type": "object", "properties": {"title_filter": {"type": "string"}, "region_filter": {"type": "string"}}}},
    {"name": "get_invoices_summary", "description": "Obtenir un résumé des factures avec filtre optionnel par statut ou client.", "input_schema": {"type": "object", "properties": {"status_filter": {"type": "string"}, "client_id": {"type": "integer"}}}},
    {"name": "get_reports", "description": "Obtenir les rapports facturation par client, employé ou période.", "input_schema": {"type": "object", "properties": {"report_type": {"type": "string", "enum": ["by-client", "by-employee", "by-period"]}}, "required": ["report_type"]}},
    {"name": "get_accommodations", "description": "Obtenir la liste des hébergements actifs pour les employés.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}}},
    {"name": "create_accommodation_record", "description": "Ajouter un hebergement pour un employe.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "start_date": {"type": "string"}, "end_date": {"type": "string"}, "total_cost": {"type": "number"}, "days_worked": {"type": "integer"}, "cost_per_day": {"type": "number"}, "notes": {"type": "string"}}, "required": ["start_date", "end_date", "total_cost"]}},
    {"name": "reconcile_timesheet_invoice", "description": "Concilier une FDT avec la facture de la meme periode et retourner un niveau de confiance.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}, "period_start": {"type": "string"}, "period_end": {"type": "string"}, "invoice_id": {"type": "string"}, "client_id": {"type": "integer"}, "client_name": {"type": "string"}}, "required": []}},
    {"name": "index_recent_timesheet_emails", "description": "Indexer les pieces jointes recues dans la boite paie et classer les vraies FDT ainsi que les documents d'hebergement au bon employe.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 10}, "search": {"type": "string"}, "unread_only": {"type": "boolean", "default": False}}, "required": []}},
    {"name": "analyze_recent_timesheet_documents", "description": "Analyser les dernieres FDT recues dans la boite paie et resumer les quarts, pauses, signatures et periodes detectees. Utiliser pour lister les vraies FDT recentes ou pour resumer les quarts/pauses par employe.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 10}, "search": {"type": "string"}, "unread_only": {"type": "boolean", "default": False}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}, "required": []}},
    {"name": "process_incoming_timesheet_emails", "description": "Traiter automatiquement la boite paie: filtrer les vraies FDT, classer les documents d'hebergement, les rattacher au bon employe et preparer les brouillons de facture quand le niveau de confiance est suffisant.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 30}, "unread_only": {"type": "boolean", "default": False}}, "required": []}},
    {"name": "send_weekly_timesheet_reminder", "description": "Envoyer le rappel hebdomadaire de FDT avec la periode automatiquement calculee.", "input_schema": {"type": "object", "properties": {"force": {"type": "boolean", "default": False}}, "required": []}},
    {"name": "draft_weekly_timesheet_reminder", "description": "Creer un brouillon Gmail du rappel hebdomadaire de FDT avec les destinataires CCI configures et la periode automatiquement calculee. Utiliser quand l'utilisateur demande un test, un brouillon Gmail, ou veut verifier le rendu avant envoi.", "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "get_automation_config", "description": "Retourner la configuration des taches automatiques du dimanche: jour, heure, fuseau horaire, courriel d'envoi et destinataires CCI du rappel FDT.", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": []}},
    {"name": "get_timesheet_documents_summary", "description": "Obtenir un resume des FDT et documents regroupes par semaine ou par mois.", "input_schema": {"type": "object", "properties": {"group_by": {"type": "string", "enum": ["week", "month"]}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}, "required": []}},
    {"name": "get_accommodation_documents_summary", "description": "Obtenir un resume des hebergements et documents regroupes par semaine ou par mois avec le total $.", "input_schema": {"type": "object", "properties": {"group_by": {"type": "string", "enum": ["week", "month"]}, "employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}, "required": []}},
    {"name": "get_business_info", "description": "Obtenir les informations business.", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}}},
]
TOOLS = [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"], "strict": False} for t in RAW_TOOLS]


def _norm(s: str) -> str:
    raw = unicodedata.normalize("NFKD", (s or "").strip().lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


_MATCH_STOPWORDS = {"de", "du", "des", "la", "le", "les", "l", "d", "et"}
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


def _match_tokens(value: str):
    return [token for token in _norm(value).split() if token and token not in _MATCH_STOPWORDS]


def _extract_explicit_dates_from_message(message: str):
    text = str(message or "").strip()
    if not text:
        return []

    found = []

    for year, month, day in re.findall(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", text):
        try:
            found.append(date(int(year), int(month), int(day)))
        except ValueError:
            continue

    for day_value, month_value, year_value in re.findall(r"\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b", text):
        try:
            found.append(date(int(year_value or CURRENT_YEAR), int(month_value), int(day_value)))
        except ValueError:
            continue

    month_pattern = "|".join(sorted((re.escape(name) for name in _FRENCH_MONTHS.keys()), key=len, reverse=True))
    for day_value, month_name, year_value in re.findall(
        rf"\b(\d{{1,2}})\s+({month_pattern})(?:\s+(20\d{{2}}))?\b",
        text,
        flags=re.IGNORECASE,
    ):
        month_key = (month_name or "").strip().lower()
        month_number = _FRENCH_MONTHS.get(month_key)
        if not month_number:
            continue
        try:
            found.append(date(int(year_value or CURRENT_YEAR), month_number, int(day_value)))
        except ValueError:
            continue

    unique_dates = []
    seen = set()
    for item in found:
        if item.isoformat() in seen:
            continue
        seen.add(item.isoformat())
        unique_dates.append(item)
    return unique_dates


def _apply_schedule_date_guard(name: str, input_data: dict, user_message: str):
    if name not in {"create_schedule_shift", "update_schedule_shift", "delete_schedule_shift"}:
        return input_data

    explicit_dates = _extract_explicit_dates_from_message(user_message)
    if len(explicit_dates) != 1:
        return input_data

    guarded = dict(input_data or {})
    explicit_iso = explicit_dates[0].isoformat()

    if name == "create_schedule_shift":
        guarded["date"] = explicit_iso
        return guarded

    if name in {"update_schedule_shift", "delete_schedule_shift"}:
        if "current_date" in guarded or "date" not in guarded:
            guarded["current_date"] = explicit_iso
        if name == "update_schedule_shift" and "date" in guarded and guarded.get("date"):
            guarded["date"] = explicit_iso
    return guarded


def _extract_explicit_times_from_message(message: str):
    text = str(message or "").strip()
    if not text:
        return []

    found = []
    pattern = re.compile(r"\b([01]?\d|2[0-3])\s*(?:[:hH])\s*([0-5]\d)?\b")
    for hours_value, minutes_value in pattern.findall(text):
        hours = int(hours_value)
        minutes = int(minutes_value or "00")
        if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
            continue
        found.append(f"{hours:02d}:{minutes:02d}")

    unique_times = []
    seen = set()
    for item in found:
        if item in seen:
            continue
        seen.add(item)
        unique_times.append(item)
    return unique_times


def _apply_schedule_time_guard(name: str, input_data: dict, user_message: str):
    if name not in {"delete_schedule_shift", "update_schedule_shift"}:
        return input_data

    explicit_times = _extract_explicit_times_from_message(user_message)
    if not explicit_times:
        return input_data

    guarded = dict(input_data or {})
    if not guarded.get("current_start"):
        guarded["current_start"] = explicit_times[0]
    if len(explicit_times) > 1 and not guarded.get("current_end"):
        guarded["current_end"] = explicit_times[1]
    return guarded


def _parse_recipient_input(*values):
    raw_chunks = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            raw_chunks.extend(str(item or "").strip() for item in value if str(item or "").strip())
        else:
            raw_chunks.append(str(value or "").strip())
    recipients = []
    for _, email in getaddresses(raw_chunks):
        normalized = (email or "").strip()
        if normalized and normalized not in recipients:
            recipients.append(normalized)
    return recipients

async def _find_employee(db: AsyncSession, employee_id=None, employee_name=None):
    if employee_id:
        r = await db.execute(select(Employee).where(Employee.id == employee_id))
        return r.scalar_one_or_none()
    if employee_name:
        q = _norm(employee_name)
        r = await db.execute(select(Employee))
        emps = r.scalars().all()
        exact = [e for e in emps if _norm(e.name) == q]
        if exact:
            active_exact = [e for e in exact if getattr(e, "is_active", False)]
            return active_exact[0] if active_exact else exact[0]
        partial = [e for e in emps if q in _norm(e.name)]
        if len(partial) == 1:
            return partial[0]
        if partial:
            active_partial = [e for e in partial if getattr(e, "is_active", False)]
            if len(active_partial) == 1:
                return active_partial[0]
            if active_partial:
                return active_partial[0]
    return None


async def _find_client(db: AsyncSession, client_id=None, client_name=None):
    if client_id:
        result = await db.execute(select(Client).where(Client.id == client_id))
        return result.scalar_one_or_none()
    if client_name:
        q = _norm(client_name)
        result = await db.execute(select(Client))
        clients = result.scalars().all()
        exact = [c for c in clients if _norm(c.name) == q]
        if exact:
            return exact[0]
        partial = [c for c in clients if q in _norm(c.name)]
        if len(partial) == 1:
            return partial[0]
        if partial:
            q_tokens = _match_tokens(client_name)
            scored = []
            for client in partial:
                client_tokens = set(_match_tokens(client.name))
                score = sum(1 for token in q_tokens if token in client_tokens)
                scored.append((score, len(client_tokens), client))
            scored.sort(key=lambda item: (item[0], -item[1]), reverse=True)
            if len(scored) == 1 or (scored[0][0] > 0 and scored[0][0] > scored[1][0]):
                return scored[0][2]
        q_tokens = _match_tokens(client_name)
        if q_tokens:
            token_matches = []
            for client in clients:
                client_tokens = set(_match_tokens(client.name))
                if all(token in client_tokens for token in q_tokens):
                    token_matches.append((len(client_tokens), client))
            if len(token_matches) == 1:
                return token_matches[0][1]
            if token_matches:
                token_matches.sort(key=lambda item: item[0])
                if len(token_matches) == 1 or token_matches[0][0] < token_matches[1][0]:
                    return token_matches[0][1]
    return None


def _parse_date_value(value, field_name="date"):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_name} manquant")
    try:
        return date.fromisoformat(raw[:10])
    except ValueError as exc:
        raise ValueError(f"{field_name} invalide. Utilise YYYY-MM-DD.") from exc


def _current_billing_period(reference_date=None):
    current = reference_date or date.today()
    days_since_sunday = (current.weekday() + 1) % 7
    period_start = current - timedelta(days=days_since_sunday)
    period_end = period_start + timedelta(days=6)
    return period_start, period_end


def _normalize_time_value(value, field_name="heure"):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_name} manquante")
    raw = raw.replace("h", ":").replace("H", ":").replace(".", ":")
    if ":" not in raw:
        if len(raw) <= 2 and raw.isdigit():
            raw = f"{int(raw):02d}:00"
        elif len(raw) == 4 and raw.isdigit():
            raw = f"{int(raw[:2]):02d}:{raw[2:]}"
    parts = raw.split(":")
    if len(parts) < 2:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.")
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError as exc:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.") from exc
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        raise ValueError(f"{field_name} invalide. Utilise HH:MM en 24 h.")
    return f"{hours:02d}:{minutes:02d}"


def _time_to_minutes(value, field_name="heure"):
    normalized = _normalize_time_value(value, field_name)
    hours, minutes = normalized.split(":")
    return int(hours) * 60 + int(minutes)


def _get_float_value(input_data, *keys, default=None):
    for key in keys:
        if key in input_data and input_data.get(key) not in (None, ""):
            try:
                return float(input_data.get(key))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} invalide") from exc
    return default


def _get_pause_hours(input_data, default=None):
    pause_minutes = _get_float_value(input_data, "pause_minutes")
    if pause_minutes is not None:
        return round(pause_minutes / 60.0, 2)
    pause_hours = _get_float_value(input_data, "pause_hours", "pause")
    if pause_hours is not None:
        return round(pause_hours, 2)
    return default


def _calculate_schedule_hours(start_value, end_value, pause_hours=0):
    start_minutes = _time_to_minutes(start_value, "start")
    end_minutes = _time_to_minutes(end_value, "end")
    if end_minutes <= start_minutes:
        end_minutes += 24 * 60
    total_hours = (end_minutes - start_minutes) / 60.0 - float(pause_hours or 0)
    return round(max(total_hours, 0), 2)


def _serialize_schedule(shift, employee_name="", client_name=""):
    pause_hours = float(getattr(shift, "pause", 0) or 0)
    return {
        "id": shift.id,
        "employee_id": shift.employee_id,
        "employee_name": employee_name,
        "client_id": getattr(shift, "client_id", None),
        "client_name": client_name or "",
        "date": shift.date.isoformat() if hasattr(shift.date, "isoformat") else str(shift.date),
        "start": getattr(shift, "start", "") or "",
        "end": getattr(shift, "end", "") or "",
        "hours": round(float(getattr(shift, "hours", 0) or 0), 2),
        "pause_hours": round(pause_hours, 2),
        "pause_minutes": int(round(pause_hours * 60)),
        "location": getattr(shift, "location", "") or "",
        "status": getattr(shift, "status", "") or "",
        "notes": getattr(shift, "notes", "") or "",
        "billable_rate": float(getattr(shift, "billable_rate", 0) or 0),
        "km": float(getattr(shift, "km", 0) or 0),
        "deplacement": float(getattr(shift, "deplacement", 0) or 0),
        "autre_dep": float(getattr(shift, "autre_dep", 0) or 0),
        "garde_hours": float(getattr(shift, "garde_hours", 0) or 0),
        "rappel_hours": float(getattr(shift, "rappel_hours", 0) or 0),
    }


async def _find_schedule(
    db: AsyncSession,
    schedule_id=None,
    employee_id=None,
    employee_name=None,
    client_id=None,
    client_name=None,
    current_date=None,
    current_start=None,
    current_end=None,
):
    if schedule_id:
        result = await db.execute(select(Schedule).where(Schedule.id == str(schedule_id)))
        shift = result.scalar_one_or_none()
        if shift:
            return shift, None
        return None, "Quart introuvable"

    employee = await _find_employee(db, employee_id, employee_name)
    if not employee:
        return None, "Employe introuvable"
    if not current_date:
        return None, "Fournis schedule_id ou au minimum employe + date du quart."

    target_date = _parse_date_value(current_date, "current_date")
    query = select(Schedule).where(
        Schedule.employee_id == employee.id,
        Schedule.date == target_date,
    )

    if current_start:
        target_start = _normalize_time_value(current_start, "current_start")
        query = query.where(Schedule.start == target_start)

    if current_end:
        query = query.where(Schedule.end == _normalize_time_value(current_end, "current_end"))

    client = None
    if client_id or client_name:
        client = await _find_client(db, client_id, client_name)
        if not client:
            return None, "Client introuvable"
        query = query.where(Schedule.client_id == client.id)

    result = await db.execute(query.order_by(Schedule.date, Schedule.start))
    matches = result.scalars().all()
    if len(matches) == 1:
        return matches[0], None
    if not matches:
        return None, "Quart introuvable"
    if not current_start:
        return None, "Plusieurs quarts correspondent pour cette date. Fournis l'heure de debut ou schedule_id pour etre plus precis."
    return None, "Plusieurs quarts correspondent. Fournis schedule_id pour etre plus precis."


async def _get_schedule_names(db: AsyncSession, shift):
    employee_name = ""
    client_name = ""
    if getattr(shift, "employee_id", None):
        employee_result = await db.execute(select(Employee).where(Employee.id == shift.employee_id))
        employee = employee_result.scalar_one_or_none()
        employee_name = employee.name if employee else ""
    if getattr(shift, "client_id", None):
        client_result = await db.execute(select(Client).where(Client.id == shift.client_id))
        client = client_result.scalar_one_or_none()
        client_name = client.name if client else ""
    return employee_name, client_name

async def _build_invoice_from_schedules(
    db: AsyncSession,
    employee,
    period_start: str,
    period_end: str,
    client_id=None,
    client_name=None,
):
    ps = date.fromisoformat(period_start)
    pe = date.fromisoformat(period_end)
    scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee.id, Schedule.date >= ps, Schedule.date <= pe, Schedule.status != 'cancelled').order_by(Schedule.date))
    scheds = scheds_r.scalars().all()
    if not scheds:
        return {"error": "Aucun quart trouvé pour cette période"}
    selected_client = await _find_client(db, client_id, client_name) if (client_id or client_name) else None
    if (client_id or client_name) and not selected_client:
        return {"error": "Client introuvable pour cette facture"}
    client_ids = sorted({s.client_id for s in scheds if getattr(s, 'client_id', None)})
    effective_client = None
    if selected_client:
        effective_client = selected_client
        explicit_client_scheds = [s for s in scheds if getattr(s, 'client_id', None)]
        if explicit_client_scheds:
            scheds = [
                s for s in scheds
                if getattr(s, 'client_id', None) == selected_client.id
                or (not getattr(s, 'client_id', None) and getattr(employee, 'client_id', None) == selected_client.id)
            ]
        elif getattr(employee, 'client_id', None) and employee.client_id != selected_client.id:
            scheds = []
        if not scheds:
            return {"error": "Aucun quart trouve pour ce client dans cette periode"}
    elif len(client_ids) == 1:
        cr = await db.execute(select(Client).where(Client.id == client_ids[0]))
        effective_client = cr.scalar_one_or_none()
    elif len(client_ids) == 0 and getattr(employee, 'client_id', None):
        cr = await db.execute(select(Client).where(Client.id == employee.client_id))
        effective_client = cr.scalar_one_or_none()
        scheds = [s for s in scheds if not getattr(s, 'client_id', None) or s.client_id == employee.client_id]
    else:
        return {"error": f"Client ambigu pour cette période: {client_ids}"}
    if not effective_client:
        return {"error": "Aucun client associé trouvé pour cette période"}
    existing = await db.execute(select(Invoice).where(Invoice.employee_id == employee.id, Invoice.client_id == effective_client.id, Invoice.period_start == ps, Invoice.period_end == pe, Invoice.status != 'cancelled'))
    existing = existing.scalar_one_or_none()
    if existing:
        return {"id": existing.id, "number": existing.number, "status": existing.status, "total": existing.total, "client_name": existing.client_name, "employee_name": existing.employee_name, "message": "Facture déjà existante"}
    rate = get_rate_for_title(employee.position or 'Infirmier(ère)')
    include_tax = not is_tax_exempt(effective_client.name)
    lines, expense_lines = [], []
    for s in scheds:
        rate = get_schedule_billable_rate(s, employee.position or '')
        hours = round((getattr(s, 'hours', 0) or 0), 2)
        garde_h = getattr(s, 'garde_hours', 0) or 0
        rappel_h = getattr(s, 'rappel_hours', 0) or 0
        garde_billable = garde_h / 8.0 if garde_h else 0
        lines.append({"schedule_id": s.id, "date": s.date.isoformat() if hasattr(s.date, 'isoformat') else str(s.date), "employee": employee.name or '', "location": effective_client.name, "start": getattr(s, 'start', '') or '', "end": getattr(s, 'end', '') or '', "pause_min": schedule_pause_to_invoice_minutes(getattr(s, 'pause', 0) or 0), "hours": hours, "rate": rate, "service_amount": round(hours * rate, 2), "garde_hours": garde_h, "garde_amount": round(garde_billable * GARDE_RATE, 2), "rappel_hours": rappel_h, "rappel_amount": round(rappel_h * rate, 2)})
        km_val = getattr(s, 'km', 0) or 0
        if km_val:
            capped = min(float(km_val), MAX_KM)
            expense_lines.append({"type": "km", "description": f"Kilométrage ({s.date})", "quantity": capped, "rate": KM_RATE, "amount": round(capped * KM_RATE, 2)})
        depl_val = getattr(s, 'deplacement', 0) or 0
        if depl_val:
            capped = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
            expense_lines.append({"type": "deplacement", "description": f"Déplacement ({s.date})", "quantity": capped, "rate": rate, "amount": round(capped * rate, 2)})
        autre_val = getattr(s, 'autre_dep', 0) or 0
        if autre_val:
            expense_lines.append({"type": "autre", "description": f"Autres frais ({s.date})", "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})
    expense_lines = []
    for s in scheds:
        shift_notes = getattr(s, 'notes', '') or ''
        rate = get_schedule_billable_rate(s, employee.position or '')
        km_val = getattr(s, 'km', 0) or 0
        if km_val:
            capped = min(float(km_val), MAX_KM)
            expense_lines.append({"schedule_id": s.id, "type": "km", "description": build_shift_expense_description("km", s.date, shift_notes), "quantity": capped, "rate": KM_RATE, "amount": round(capped * KM_RATE, 2)})
        depl_val = getattr(s, 'deplacement', 0) or 0
        if depl_val:
            capped = min(float(depl_val), MAX_DEPLACEMENT_HOURS)
            expense_lines.append({"schedule_id": s.id, "type": "deplacement", "description": build_shift_expense_description("deplacement", s.date, shift_notes), "quantity": capped, "rate": rate, "amount": round(capped * rate, 2)})
        autre_val = getattr(s, 'autre_dep', 0) or 0
        if autre_val:
            expense_lines.append({"schedule_id": s.id, "type": "autre", "description": build_shift_expense_description("autre", s.date, shift_notes), "quantity": 1, "rate": float(autre_val), "amount": float(autre_val)})

    accom_r = await db.execute(select(Accommodation).where(Accommodation.employee_id == employee.id, Accommodation.start_date <= pe, Accommodation.end_date >= ps))
    accom_records = accom_r.scalars().all()
    all_scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee.id, Schedule.status != 'cancelled'))
    all_scheds = all_scheds_r.scalars().all()
    all_worked = sorted({s.date for s in all_scheds})
    billed_worked = sorted({s.date for s in scheds})
    accommodation_lines = []
    for a in accom_records:
        full_span_worked = [d for d in all_worked if a.start_date <= d <= a.end_date]
        billed_span_worked = [d for d in billed_worked if max(ps, a.start_date) <= d <= min(pe, a.end_date)]
        if not billed_span_worked:
            continue
        total_cost = float(getattr(a, 'total_cost', 0) or 0)
        denom = len(full_span_worked) or int(getattr(a, 'days_worked', 0) or 0) or 1
        cpd = round(total_cost / denom, 2) if total_cost else float(getattr(a, 'cost_per_day', 0) or 0)
        accommodation_lines.append({"employee": employee.name or '', "period": f"{max(ps, a.start_date).isoformat()} → {min(pe, a.end_date).isoformat()}", "days": len(billed_span_worked), "cost_per_day": cpd, "amount": round(cpd * len(billed_span_worked), 2)})
    inv = Invoice(number=await generate_invoice_number(db), date=date.today(), period_start=ps, period_end=pe, client_id=effective_client.id, client_name=effective_client.name, client_address=getattr(effective_client, 'address', '') or '', client_email=getattr(effective_client, 'email', '') or '', client_phone=getattr(effective_client, 'phone', '') or '', employee_id=employee.id, employee_name=employee.name or '', employee_title=employee.position or '', include_tax=include_tax, status='draft', lines=lines, accommodation_lines=accommodation_lines, expense_lines=expense_lines, extra_lines=[])
    inv = recalculate_invoice(inv)
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return {"id": inv.id, "number": inv.number, "status": inv.status, "total": inv.total, "client_name": inv.client_name, "employee_name": inv.employee_name, "period_start": period_start, "period_end": period_end}


def _invoice_identity_payload(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "number": invoice.number,
        "status": invoice.status,
        "employee_id": invoice.employee_id,
        "employee_name": invoice.employee_name,
        "client_id": invoice.client_id,
        "client_name": invoice.client_name,
        "period_start": invoice.period_start.isoformat() if getattr(invoice, "period_start", None) else "",
        "period_end": invoice.period_end.isoformat() if getattr(invoice, "period_end", None) else "",
        "total": round(float(getattr(invoice, "total", 0) or 0), 2),
    }


def _serialize_invoice_for_chat(invoice: Invoice) -> dict:
    payload = _invoice_identity_payload(invoice)
    payload.update(
        {
            "lines": list(getattr(invoice, "lines", None) or []),
            "expense_lines": list(getattr(invoice, "expense_lines", None) or []),
            "accommodation_lines": list(getattr(invoice, "accommodation_lines", None) or []),
            "extra_lines": list(getattr(invoice, "extra_lines", None) or []),
            "notes": getattr(invoice, "notes", "") or "",
            "po_number": getattr(invoice, "po_number", "") or "",
            "include_tax": bool(getattr(invoice, "include_tax", True)),
        }
    )
    return payload


async def _find_invoice(
    db: AsyncSession,
    invoice_id=None,
    invoice_number=None,
    employee_id=None,
    employee_name=None,
    period_start=None,
    period_end=None,
    client_id=None,
    client_name=None,
    draft_only: bool = False,
):
    query = select(Invoice).where(Invoice.status != InvoiceStatus.CANCELLED.value)
    if draft_only:
        query = query.where(Invoice.status == InvoiceStatus.DRAFT.value)
    if invoice_id:
        query = query.where(Invoice.id == str(invoice_id))
    if invoice_number:
        query = query.where(Invoice.number == str(invoice_number).strip())

    employee = None
    if employee_id or employee_name:
        employee = await _find_employee(db, employee_id, employee_name)
        if not employee:
            return None, "Employe introuvable pour cette facture"
        query = query.where(Invoice.employee_id == employee.id)

    client = None
    if client_id or client_name:
        client = await _find_client(db, client_id, client_name)
        if not client:
            return None, "Client introuvable pour cette facture"
        query = query.where(Invoice.client_id == client.id)

    if period_start:
        query = query.where(Invoice.period_start == _parse_date_value(period_start, "period_start"))
    if period_end:
        query = query.where(Invoice.period_end == _parse_date_value(period_end, "period_end"))

    result = await db.execute(query.order_by(desc(Invoice.created_at), desc(Invoice.date)))
    matches = result.scalars().all()
    if not matches:
        return None, "Facture introuvable"
    if len(matches) == 1:
        return matches[0], None

    normalized_number = _norm(str(invoice_number or ""))
    if normalized_number:
        exact_number = [item for item in matches if _norm(item.number) == normalized_number]
        if len(exact_number) == 1:
            return exact_number[0], None

    draft_matches = [item for item in matches if item.status == InvoiceStatus.DRAFT.value]
    if len(draft_matches) == 1:
        return draft_matches[0], None

    if employee and (period_start or period_end):
        return matches[0], None
    return None, "Plusieurs factures correspondent. Fournis le numero de facture pour etre plus precis."


def _recalculate_invoice_service_line(line: dict) -> dict:
    updated = dict(line or {})
    start = str(updated.get("start") or "").strip()
    end = str(updated.get("end") or "").strip()
    pause_min = float(updated.get("pause_min") or 0)
    rate = float(updated.get("rate") or 0)
    if start and end and ("hours" not in updated or updated.get("hours") in (None, "")):
        start_minutes = _time_to_minutes(start, "start")
        end_minutes = _time_to_minutes(end, "end")
        if end_minutes <= start_minutes:
            end_minutes += 24 * 60
        updated["hours"] = round(max(((end_minutes - start_minutes) - pause_min) / 60.0, 0), 2)
    updated["hours"] = round(float(updated.get("hours") or 0), 2)
    updated["pause_min"] = round(pause_min, 2)
    updated["rate"] = round(rate, 2)
    updated["garde_hours"] = round(float(updated.get("garde_hours") or 0), 2)
    updated["rappel_hours"] = round(float(updated.get("rappel_hours") or 0), 2)
    updated["service_amount"] = round(updated["hours"] * updated["rate"], 2)
    updated["garde_amount"] = round((updated["garde_hours"] / 8.0) * GARDE_RATE, 2)
    updated["rappel_amount"] = round(updated["rappel_hours"] * updated["rate"], 2)
    return updated


def _find_service_line_index(lines: list[dict], schedule_id=None, date_value=None, current_start=None):
    if schedule_id:
        for index, line in enumerate(lines):
            if str(line.get("schedule_id") or "") == str(schedule_id):
                return index
        return -1

    target_date = str(date_value or "").strip()
    target_start = str(current_start or "").strip()
    matches = []
    for index, line in enumerate(lines):
        if target_date and str(line.get("date") or "")[:10] != target_date[:10]:
            continue
        if target_start and str(line.get("start") or "") != target_start:
            continue
        matches.append(index)
    if len(matches) == 1:
        return matches[0]
    return -1


async def _save_chatbot_invoice_update(db: AsyncSession, invoice: Invoice, user_email: str, details: str) -> dict:
    invoice = recalculate_invoice(invoice)
    audit = InvoiceAuditLog(
        invoice_id=invoice.id,
        action=AuditAction.UPDATED.value,
        user_email=user_email or "chatbot@soins-expert-plus.com",
        details=details,
    )
    db.add(audit)
    await db.commit()
    await db.refresh(invoice)
    return _serialize_invoice_for_chat(invoice)


def _serialize_chat_upload(upload: ChatbotUpload) -> dict:
    return {
        "id": upload.id,
        "session_id": upload.session_id,
        "filename": upload.original_filename,
        "file_type": upload.file_type,
        "mime_type": upload.mime_type,
        "file_size": upload.file_size,
        "description": upload.description or "",
        "uploaded_by": upload.uploaded_by or "",
        "created_at": upload.created_at.isoformat() if upload.created_at else None,
    }


async def _get_chat_session_uploads(db: AsyncSession, session_id: str) -> list[ChatbotUpload]:
    if not (session_id or "").strip():
        return []
    result = await db.execute(
        select(ChatbotUpload)
        .where(ChatbotUpload.session_id == session_id.strip())
        .order_by(ChatbotUpload.created_at.desc())
    )
    return result.scalars().all()


def _chat_upload_to_attachment_payload(upload: ChatbotUpload) -> dict:
    return {
        "filename": upload.original_filename or upload.filename,
        "mime_type": upload.mime_type or "application/octet-stream",
        "content": upload.file_data or b"",
    }


def _chat_upload_to_document(upload: ChatbotUpload) -> dict:
    return {
        "message_id": f"chat-upload:{upload.id}",
        "filename": upload.original_filename or upload.filename or "document",
        "mime_type": upload.mime_type or "application/octet-stream",
        "file_size": int(upload.file_size or 0),
        "file_data": upload.file_data or b"",
        "from": upload.uploaded_by or "chatbot",
        "subject": upload.description or "",
        "body_preview": upload.description or "",
        "date": upload.created_at.isoformat() if upload.created_at else "",
    }


async def _select_chat_uploads_for_action(
    db: AsyncSession,
    session_id: str,
    document_ids=None,
    filename_query: str = "",
    attach_all: bool = False,
) -> list[ChatbotUpload]:
    uploads = await _get_chat_session_uploads(db, session_id)
    if not uploads:
        return []
    if attach_all:
        return uploads

    normalized_ids = {str(item).strip() for item in (document_ids or []) if str(item).strip()}
    if normalized_ids:
        return [item for item in uploads if str(item.id) in normalized_ids]

    query = _norm(filename_query or "")
    if query:
        return [item for item in uploads if query in _norm(item.original_filename or item.filename or "")]
    return []


def _chat_upload_context_text(uploads: list[ChatbotUpload]) -> str:
    if not uploads:
        return ""
    lines = []
    for item in uploads[:10]:
        label = item.original_filename or item.filename or "document"
        size_label = f"{round((item.file_size or 0) / 1024.0, 1)} Ko" if item.file_size else "taille inconnue"
        lines.append(f"- {label} [id={item.id}] ({item.mime_type or item.file_type}, {size_label})")
    return (
        "\n\nDocuments actuellement joints dans cette conversation:\n"
        + "\n".join(lines)
        + "\nQuand l'utilisateur veut joindre un document a une facture ou a un courriel, utilise list_chat_session_documents, "
          "analyze_chat_session_documents, attach_chat_documents_to_invoice ou les options de pieces jointes des outils send_email/create_email_draft."
    )


def _format_timesheet_analysis_response(items: list[dict], max_results: int = 5) -> str:
    if not items:
        return "Aucune FDT exploitable n'a pu etre lue dans les documents joints."

    lines = []
    for idx, item in enumerate(items[:max_results], start=1):
        employee_label = item.get("employee_name") or "Employe a confirmer"
        signature = (
            "signee"
            if item.get("is_signed") is True
            else "signature a verifier"
            if item.get("is_signed") is False
            else "signature non confirmee"
        )
        lines.append(f"{idx}. {employee_label} — {item.get('filename', 'document')}")
        if item.get("employee_title"):
            lines.append(f"   Titre: {item.get('employee_title')}")
        if item.get("period_start") and item.get("period_end"):
            lines.append(f"   Periode: {item.get('period_start')} au {item.get('period_end')}")
        lines.append(f"   Signature: {signature}")
        if item.get("visible_names"):
            lines.append(f"   Noms visibles: {', '.join(item.get('visible_names')[:8])}")
        if item.get("shift_count"):
            lines.append("   Quarts:")
            for shift in item.get("shifts", [])[:20]:
                shift_bits = []
                if shift.get("day_label"):
                    shift_bits.append(shift["day_label"])
                if shift.get("date"):
                    shift_bits.append(shift["date"])
                if shift.get("start") or shift.get("end"):
                    shift_bits.append(f"{shift.get('start') or '?'}-{shift.get('end') or '?'}")
                if shift.get("pause_minutes"):
                    shift_bits.append(f"pause {shift.get('pause_minutes')} min")
                if shift.get("hours"):
                    shift_bits.append(f"{shift.get('hours')} h")
                if shift.get("type") and shift.get("type") != "unknown":
                    shift_bits.append(shift.get("type"))
                if shift.get("unit"):
                    shift_bits.append(shift.get("unit"))
                if shift.get("approver_name"):
                    shift_bits.append(f"signataire {shift.get('approver_name')}")
                if shift.get("notes"):
                    shift_bits.append(shift.get("notes"))
                lines.append(f"   - {' | '.join(shift_bits) if shift_bits else 'Quart detecte'}")
        else:
            prose_description = str(item.get("prose_description") or "").strip()
            if prose_description:
                lines.append("   Lecture detaillee:")
                for prose_line in prose_description.splitlines()[:18]:
                    clean = prose_line.strip()
                    if clean:
                        lines.append(f"   {clean}")
            else:
                lines.append("   Lecture: aucune structure fiable extraite, mais je peux relire le document si tu me demandes un point precis.")
        if item.get("notes"):
            lines.append(f"   Note: {item.get('notes')}")
    return "\n".join(lines)


def _message_requests_chat_upload_analysis(
    message: str,
    uploads: list[ChatbotUpload] | None = None,
    history: list[dict] | None = None,
) -> bool:
    m = _norm(message or "")
    upload_context = " ".join(
        _norm(item.original_filename or item.filename or "")
        for item in (uploads or [])
        if item
    )
    recent_history = [
        _norm(str(entry.get("content") or ""))
        for entry in (history or [])[-6:]
        if isinstance(entry, dict)
    ]
    analysis_words = [
        "detail",
        "details",
        "analy",
        "resume",
        "resumer",
        "voir",
        "montre",
        "affiche",
        "quart",
        "quarts",
        "pause",
        "pauses",
        "nom",
        "noms",
        "inscrit",
        "inscrits",
        "transcri",
        "lire",
        "lis",
        "reconn",
        "document joint",
        "piece jointe",
        "pieces jointes",
        "cette fdt",
        "cette feuille de temps",
    ]
    timesheet_words = ["fdt", "feuille de temps", "timesheet"]
    upload_reference_words = [
        "ce document",
        "cette piece jointe",
        "cette piece",
        "ce fichier",
        "ce pdf",
        "cette image",
        "cette photo",
        "celle la",
        "celle-ci",
        "celui la",
        "document joint",
        "piece jointe",
        "pieces jointes",
    ]
    email_words = [
        "courriel",
        "courriels",
        "email",
        "emails",
        "mail",
        "mails",
        "boite",
        "boite mail",
        "boite courriel",
        "recu",
        "recus",
        "recues",
        "message",
        "messages",
        "inbox",
    ]
    invoice_words = [
        "facture",
        "factures",
        "invoice",
        "invoices",
        "brouillon",
        "generer",
        "genere",
        "générer",
        "génère",
        "compar",
        "concil",
        "ecart",
        "écart",
    ]
    challenge_words = [
        "pourquoi",
        "alors que",
        "je viens de voir",
        "tu as genere",
        "tu as généré",
        "seulement",
        "pas tous",
        "incoher",
        "incohér",
    ]
    analysis_intent = any(word in m for word in analysis_words)
    current_timesheet_reference = any(word in m for word in timesheet_words + upload_reference_words)
    email_intent = any(word in m for word in email_words)
    invoice_intent = any(word in m for word in invoice_words)
    challenge_intent = any(word in m for word in challenge_words)
    recent_timesheet_context = any(
        any(word in entry for word in timesheet_words)
        or "employe a confirmer" in entry
        or "signature" in entry
        or "quarts:" in entry
        or any(word in entry for word in ("lecture partielle", "fdt"))
        for entry in recent_history
    ) or any(word in upload_context for word in timesheet_words)

    if email_intent and not current_timesheet_reference:
        return False
    if (invoice_intent or challenge_intent) and not current_timesheet_reference:
        return False
    if analysis_intent and current_timesheet_reference:
        return True
    if (
        analysis_intent
        and recent_timesheet_context
        and len((message or "").split()) <= 10
        and not email_intent
    ):
        return True
    return False

async def execute_tool(name: str, input_data: dict, db: AsyncSession, user_message: str = "", chat_session_id: str = "") -> str:
    try:
        input_data = _apply_schedule_date_guard(name, input_data, user_message)
        input_data = _apply_schedule_time_guard(name, input_data, user_message)
        if name == 'search_employees':
            q = _norm(input_data.get('query', ''))
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            employees = result.scalars().all()
            matches = [e for e in employees if q in _norm(e.name) or q in _norm(e.position or '') or q in _norm(e.email or '')]
            return json.dumps([{"id": e.id, "name": e.name, "position": e.position, "rate": e.rate, "email": e.email, "phone": e.phone, "client_id": e.client_id} for e in matches[:20]], ensure_ascii=False)
        if name == 'search_clients':
            q = _norm(input_data.get('query', ''))
            result = await db.execute(select(Client))
            clients = result.scalars().all()
            matches = [c for c in clients if q in _norm(c.name)]
            if not matches:
                query_tokens = _match_tokens(input_data.get('query', ''))
                if query_tokens:
                    matches = [
                        c for c in clients
                        if all(token in set(_match_tokens(c.name)) for token in query_tokens)
                    ]
            return json.dumps([{"id": c.id, "name": c.name, "email": getattr(c, 'email', ''), "address": getattr(c, 'address', ''), "tax_exempt": getattr(c, 'tax_exempt', False)} for c in matches[:20]], ensure_ascii=False)
        if name == 'resolve_contact_email':
            q = _norm(input_data.get('query', ''))
            matches = []
            if q:
                employee_result = await db.execute(select(Employee).where(Employee.is_active == True))
                for employee in employee_result.scalars().all():
                    if not (employee.email or "").strip():
                        continue
                    if q in _norm(employee.name or "") or q in _norm(employee.email or ""):
                        matches.append({
                            "kind": "employee",
                            "id": employee.id,
                            "name": employee.name,
                            "email": employee.email,
                            "phone": employee.phone,
                            "position": employee.position,
                        })
                client_result = await db.execute(select(Client))
                for client in client_result.scalars().all():
                    if not (getattr(client, 'email', '') or "").strip():
                        continue
                    if q in _norm(client.name or "") or q in _norm(getattr(client, 'email', '') or ""):
                        matches.append({
                            "kind": "client",
                            "id": client.id,
                            "name": client.name,
                            "email": getattr(client, 'email', ''),
                            "phone": getattr(client, 'phone', ''),
                        })
            return json.dumps(matches[:20], ensure_ascii=False)
        if name == 'get_employee_schedule':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employé introuvable"
            q = select(Schedule).where(Schedule.employee_id == emp.id)
            if input_data.get('start_date'):
                q = q.where(Schedule.date >= input_data['start_date'])
            if input_data.get('end_date'):
                q = q.where(Schedule.date <= input_data['end_date'])
            q = q.order_by(Schedule.date, Schedule.start)
            result = await db.execute(q)
            shifts = result.scalars().all()
            client_ids = sorted({s.client_id for s in shifts if getattr(s, 'client_id', None)})
            client_map = {}
            if client_ids:
                client_result = await db.execute(select(Client).where(Client.id.in_(client_ids)))
                client_map = {c.id: c.name for c in client_result.scalars().all()}
            return json.dumps({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "shifts": [_serialize_schedule(s, emp.name, client_map.get(s.client_id, "")) for s in shifts],
                "total_hours": round(sum(float(getattr(s, 'hours', 0) or 0) for s in shifts), 2),
                "total_shifts": len(shifts),
            }, ensure_ascii=False)
        if name == 'generate_invoice_for_employee':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employé introuvable pour génération de facture"
            period_start = input_data.get('period_start')
            period_end = input_data.get('period_end')
            if not period_start or not period_end:
                current_start, current_end = _current_billing_period()
                period_start = current_start.isoformat()
                period_end = current_end.isoformat()
            result = await _build_invoice_from_schedules(
                db,
                emp,
                period_start,
                period_end,
                input_data.get('client_id'),
                input_data.get('client_name'),
            )
            return json.dumps(result, ensure_ascii=False)
        if name == 'generate_current_invoice_for_employee':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour generation de facture"
            period_start, period_end = _current_billing_period()
            result = await _build_invoice_from_schedules(
                db,
                emp,
                period_start.isoformat(),
                period_end.isoformat(),
                input_data.get('client_id'),
                input_data.get('client_name'),
            )
            if isinstance(result, dict) and 'period_start' not in result:
                result['period_start'] = period_start.isoformat()
                result['period_end'] = period_end.isoformat()
            return json.dumps(result, ensure_ascii=False)
        if name == 'get_invoice_details':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=bool(input_data.get('draft_only')),
            )
            if not invoice:
                return error or "Facture introuvable"
            return json.dumps(_serialize_invoice_for_chat(invoice), ensure_ascii=False)
        if name == 'update_invoice_service_line':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=True,
            )
            if not invoice:
                return error or "Facture brouillon introuvable"
            lines = [dict(line or {}) for line in (getattr(invoice, 'lines', None) or [])]
            line_index = _find_service_line_index(
                lines,
                schedule_id=input_data.get('schedule_id'),
                date_value=input_data.get('date'),
                current_start=input_data.get('current_start'),
            )
            if line_index < 0:
                return "Ligne de service introuvable dans cette facture. Fournis la date et l'heure de debut, ou schedule_id."
            target_line = dict(lines[line_index] or {})
            if bool(input_data.get('delete')):
                removed = lines.pop(line_index)
                invoice.lines = lines
                saved = await _save_chatbot_invoice_update(
                    db,
                    invoice,
                    "chatbot",
                    f"Ligne service supprimee depuis chatbot ({removed.get('date', '')} {removed.get('start', '')})",
                )
                return json.dumps({"message": "Ligne de facture supprimee", "invoice": saved}, ensure_ascii=False)
            if input_data.get('date'):
                target_line['date'] = str(input_data.get('date'))[:10]
            for field in ['start', 'end']:
                if input_data.get(field):
                    target_line[field] = _normalize_time_value(input_data.get(field), field)
            for field in ['pause_min', 'hours', 'rate', 'garde_hours', 'rappel_hours']:
                if input_data.get(field) not in (None, ''):
                    target_line[field] = float(input_data.get(field) or 0)
            target_line = _recalculate_invoice_service_line(target_line)
            lines[line_index] = target_line
            invoice.lines = lines
            saved = await _save_chatbot_invoice_update(
                db,
                invoice,
                "chatbot",
                f"Ligne service modifiee depuis chatbot ({target_line.get('date', '')} {target_line.get('start', '')})",
            )
            return json.dumps({"message": "Ligne de facture modifiee", "invoice": saved, "line": target_line}, ensure_ascii=False)
        if name == 'add_invoice_expense_line':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=True,
            )
            if not invoice:
                return error or "Facture brouillon introuvable"
            expense_lines = [dict(line or {}) for line in (getattr(invoice, 'expense_lines', None) or [])]
            quantity = float(input_data.get('quantity') or 0)
            rate = float(input_data.get('rate') or 0)
            amount = input_data.get('amount')
            if amount not in (None, ''):
                amount = float(amount)
                if quantity in (0, 0.0) and rate:
                    quantity = round(amount / rate, 2)
            else:
                amount = round(quantity * rate, 2)
            new_line = {
                "type": str(input_data.get('type') or 'autre'),
                "description": str(input_data.get('description') or '').strip(),
                "quantity": round(quantity, 2),
                "rate": round(rate, 2),
                "amount": round(amount, 2),
            }
            expense_lines.append(new_line)
            invoice.expense_lines = expense_lines
            saved = await _save_chatbot_invoice_update(
                db,
                invoice,
                "chatbot",
                f"Frais ajoute depuis chatbot ({new_line['description']})",
            )
            return json.dumps({"message": "Frais ajoute a la facture", "invoice": saved, "expense_line": new_line}, ensure_ascii=False)
        if name == 'delete_invoice_expense_line':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=True,
            )
            if not invoice:
                return error or "Facture brouillon introuvable"
            match_description = _norm(str(input_data.get('description') or ''))
            match_type = str(input_data.get('type') or '').strip().lower()
            expense_lines = [dict(line or {}) for line in (getattr(invoice, 'expense_lines', None) or [])]
            kept = []
            removed = None
            for line in expense_lines:
                if removed is None and match_description and match_description in _norm(line.get('description', '')):
                    if not match_type or str(line.get('type') or '').strip().lower() == match_type:
                        removed = line
                        continue
                kept.append(line)
            if not removed:
                return "Frais introuvable dans cette facture."
            invoice.expense_lines = kept
            saved = await _save_chatbot_invoice_update(
                db,
                invoice,
                "chatbot",
                f"Frais supprime depuis chatbot ({removed.get('description', '')})",
            )
            return json.dumps({"message": "Frais supprime de la facture", "invoice": saved, "removed": removed}, ensure_ascii=False)
        if name == 'add_invoice_accommodation_per_worked_day':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=True,
            )
            if not invoice:
                return error or "Facture brouillon introuvable"
            worked_days = sorted({str(line.get('date') or '')[:10] for line in (getattr(invoice, 'lines', None) or []) if str(line.get('date') or '').strip()})
            if not worked_days:
                return "Aucun quart facture dans cette facture pour calculer l'hebergement."
            accommodation_lines = [] if bool(input_data.get('replace_existing')) else [dict(line or {}) for line in (getattr(invoice, 'accommodation_lines', None) or [])]
            cost_per_day = float(input_data.get('cost_per_day') or 0)
            new_line = {
                "employee": invoice.employee_name or "",
                "period": f"{invoice.period_start.isoformat()} → {invoice.period_end.isoformat()}",
                "days": len(worked_days),
                "cost_per_day": round(cost_per_day, 2),
                "amount": round(len(worked_days) * cost_per_day, 2),
            }
            accommodation_lines.append(new_line)
            invoice.accommodation_lines = accommodation_lines
            saved = await _save_chatbot_invoice_update(
                db,
                invoice,
                "chatbot",
                f"Hebergement ajoute depuis chatbot ({cost_per_day:.2f}$/jour sur {len(worked_days)} jour(s))",
            )
            return json.dumps({"message": "Hebergement ajoute a la facture", "invoice": saved, "accommodation_line": new_line}, ensure_ascii=False)
        if name == 'delete_invoice_accommodation_line':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=True,
            )
            if not invoice:
                return error or "Facture brouillon introuvable"
            match_period = _norm(str(input_data.get('period') or ''))
            accommodation_lines = [dict(line or {}) for line in (getattr(invoice, 'accommodation_lines', None) or [])]
            kept = []
            removed = None
            for line in accommodation_lines:
                if removed is None and match_period and match_period in _norm(line.get('period', '')):
                    removed = line
                    continue
                kept.append(line)
            if not removed:
                return "Ligne d'hebergement introuvable dans cette facture."
            invoice.accommodation_lines = kept
            saved = await _save_chatbot_invoice_update(
                db,
                invoice,
                "chatbot",
                f"Hebergement supprime depuis chatbot ({removed.get('period', '')})",
            )
            return json.dumps({"message": "Ligne d'hebergement supprimee", "invoice": saved, "removed": removed}, ensure_ascii=False)
        if name == 'list_chat_session_documents':
            uploads = await _get_chat_session_uploads(db, chat_session_id)
            return json.dumps([_serialize_chat_upload(item) for item in uploads], ensure_ascii=False)
        if name == 'analyze_chat_session_documents':
            uploads = await _get_chat_session_uploads(db, chat_session_id)
            if not uploads:
                return "Aucun document n'est joint a cette conversation."
            employee = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                employee = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
                if input_data.get('employee_name') and not employee:
                    return "Employe introuvable pour l'analyse de la FDT jointe."
            items = await summarize_explicit_timesheet_documents(
                db,
                [_chat_upload_to_document(upload) for upload in uploads],
                employee=employee,
                raise_on_openai_error=True,
            )
            return _format_timesheet_analysis_response(items, max_results=int(input_data.get('max_results', 5) or 5))
        if name == 'attach_chat_documents_to_invoice':
            invoice, error = await _find_invoice(
                db,
                invoice_id=input_data.get('invoice_id'),
                invoice_number=input_data.get('invoice_number'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                period_start=input_data.get('period_start'),
                period_end=input_data.get('period_end'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                draft_only=False,
            )
            if not invoice:
                return error or "Facture introuvable"
            uploads = await _select_chat_uploads_for_action(
                db,
                chat_session_id,
                document_ids=input_data.get('document_ids'),
                filename_query=input_data.get('filename_query', ''),
                attach_all=bool(input_data.get('attach_all_session_documents')),
            )
            if not uploads:
                return "Aucun document de cette conversation ne correspond a la demande."
            created = []
            category = str(input_data.get('category') or 'autre').strip() or 'autre'
            base_description = str(input_data.get('description') or '').strip()
            for upload in uploads:
                attachment = InvoiceAttachment(
                    invoice_id=invoice.id,
                    filename=upload.filename,
                    original_filename=upload.original_filename,
                    file_type=upload.file_type,
                    file_size=upload.file_size,
                    file_data=upload.file_data,
                    category=category,
                    description=base_description or upload.description or "Document joint depuis le chatbot",
                    uploaded_by="chatbot",
                )
                db.add(attachment)
                created.append({
                    "filename": upload.original_filename,
                    "category": category,
                })
            await db.commit()
            return json.dumps(
                {
                    "message": f"{len(created)} document(s) joint(s) a la facture",
                    "invoice": _invoice_identity_payload(invoice),
                    "attachments": created,
                },
                ensure_ascii=False,
            )
        if name == 'read_recent_emails':
            gmail_connection = await get_billing_gmail_connection(db)
            try:
                gmail_result = await list_recent_billing_gmail_messages(
                    db,
                    max_results=input_data.get('max_results', 10),
                    search=input_data.get('search', ''),
                    folder=input_data.get('folder', 'INBOX'),
                    unread_only=bool(input_data.get('unread_only')),
                )
                if gmail_result:
                    return json.dumps(gmail_result, ensure_ascii=False)
            except Exception as gmail_error:
                if gmail_connection and getattr(gmail_connection, 'is_active', False) and getattr(gmail_connection, 'refresh_token', ''):
                    return f"Lecture du courriel paie impossible: {str(gmail_error)}"
                if not IMAP_USER or not IMAP_PASS:
                    return f"Lecture du courriel paie impossible: {str(gmail_error)}"
            if not IMAP_USER or not IMAP_PASS:
                return "Configuration IMAP manquante."
            try:
                mail = imaplib.IMAP4_SSL(IMAP_HOST)
                mail.login(IMAP_USER, IMAP_PASS)
                folder = input_data.get('folder', 'INBOX')
                mail.select(folder)
                search_criteria = 'UNSEEN' if input_data.get('unread_only') else 'ALL'
                if input_data.get('search'):
                    s = input_data['search']
                    if input_data.get('unread_only'):
                        search_criteria = f'(UNSEEN OR (FROM "{s}") (SUBJECT "{s}"))'
                    else:
                        search_criteria = f'(OR (FROM "{s}") (SUBJECT "{s}"))'
                _, msg_nums = mail.search(None, search_criteria)
                nums = msg_nums[0].split()
                max_r = input_data.get('max_results', 10)
                recent = nums[-max_r:] if len(nums) > max_r else nums
                emails = []
                for num in reversed(recent):
                    _, msg_data = mail.fetch(num, '(RFC822)')
                    msg = email_lib.message_from_bytes(msg_data[0][1])
                    subject = decode_header(msg['Subject'] or '')[0]
                    subject = subject[0].decode(subject[1] or 'utf-8') if isinstance(subject[0], bytes) else str(subject[0])
                    from_addr = msg['From'] or ''
                    date_str = msg['Date'] or ''
                    body = ''
                    has_pdf = False
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == 'text/plain':
                                body = part.get_payload(decode=True).decode('utf-8', errors='replace')[:500]
                            if part.get_filename() and part.get_filename().lower().endswith('.pdf'):
                                has_pdf = True
                    else:
                        body = msg.get_payload(decode=True).decode('utf-8', errors='replace')[:500]
                    emails.append({"from": from_addr, "subject": subject, "date": date_str[:25], "body_preview": body[:200], "has_pdf_attachment": has_pdf})
                mail.logout()
                return json.dumps({"mailbox": IMAP_USER, "folder": folder, "items": emails}, ensure_ascii=False)
            except Exception as e:
                return f"Erreur lecture emails: {str(e)}"
        if name == 'create_email_draft':
            cc_emails = _parse_recipient_input(input_data.get('cc'), input_data.get('cc_list'))
            bcc_emails = _parse_recipient_input(input_data.get('bcc'), input_data.get('bcc_list'))
            selected_uploads = await _select_chat_uploads_for_action(
                db,
                chat_session_id,
                document_ids=input_data.get('document_ids'),
                filename_query=input_data.get('filename_query', ''),
                attach_all=bool(input_data.get('attach_all_session_documents')),
            )
            attachments = [_chat_upload_to_attachment_payload(item) for item in selected_uploads]
            draft = await create_billing_gmail_draft(
                db,
                to_email=input_data['to'],
                subject=input_data['subject'],
                body_text=input_data.get('body_text', ''),
                body_html=input_data.get('body_html', ''),
                thread_id=input_data.get('thread_id', ''),
                in_reply_to=input_data.get('in_reply_to', ''),
                references=input_data.get('references', ''),
                cc_emails=cc_emails,
                bcc_emails=bcc_emails,
                attachments=attachments,
            )
            if not draft:
                return "Le compte Gmail de facturation n'est pas connecte. Clique 'Reconnecter Gmail' dans Facturation pour brancher paie@soins-expert-plus.com."
            return json.dumps(
                {
                    "message": "Brouillon Gmail cree",
                    "draft": draft,
                    "attachments": [_serialize_chat_upload(item) for item in selected_uploads],
                },
                ensure_ascii=False,
            )
        if name == 'send_email':
            selected_uploads = await _select_chat_uploads_for_action(
                db,
                chat_session_id,
                document_ids=input_data.get('document_ids'),
                filename_query=input_data.get('filename_query', ''),
                attach_all=bool(input_data.get('attach_all_session_documents')),
            )
            attachments = [_chat_upload_to_attachment_payload(item) for item in selected_uploads]
            gmail_error = None
            try:
                delivery = await send_via_connected_billing_gmail(
                    db,
                    to_email=input_data['to'],
                    subject=input_data['subject'],
                    body_html=input_data['body_html'],
                    attachments=attachments,
                )
                if not delivery:
                    raise RuntimeError("Le compte Gmail de facturation n'est pas connecte")
            except Exception as exc:
                gmail_error = exc
                try:
                    await _send_email(
                        input_data['to'],
                        input_data['subject'],
                        input_data['body_html'],
                        attachments=attachments,
                    )
                except Exception as smtp_exc:
                    raise RuntimeError(
                        f"Envoi Gmail impossible: {gmail_error}. Secours SMTP echoue aussi: {smtp_exc}"
                    ) from smtp_exc
            attachment_note = f" ({len(attachments)} piece(s) jointe(s))" if attachments else ""
            return f"Courriel envoye a {input_data['to']}: {input_data['subject']}{attachment_note}"
        if name == 'send_email':
            gmail_error = None
            try:
                delivery = await send_via_connected_billing_gmail(
                    db,
                    to_email=input_data['to'],
                    subject=input_data['subject'],
                    body_html=input_data['body_html'],
                )
                if not delivery:
                    raise RuntimeError("Le compte Gmail de facturation n'est pas connecte")
            except Exception as exc:
                gmail_error = exc
                try:
                    await _send_email(input_data['to'], input_data['subject'], input_data['body_html'])
                except Exception as smtp_exc:
                    raise RuntimeError(
                        f"Envoi Gmail impossible: {gmail_error}. Secours SMTP echoue aussi: {smtp_exc}"
                    ) from smtp_exc
            return f"Courriel envoyé à {input_data['to']}: {input_data['subject']}"
        if name == 'create_email_draft':
            cc_emails = _parse_recipient_input(input_data.get('cc'), input_data.get('cc_list'))
            bcc_emails = _parse_recipient_input(input_data.get('bcc'), input_data.get('bcc_list'))
            draft = await create_billing_gmail_draft(
                db,
                to_email=input_data['to'],
                subject=input_data['subject'],
                body_text=input_data.get('body_text', ''),
                body_html=input_data.get('body_html', ''),
                thread_id=input_data.get('thread_id', ''),
                in_reply_to=input_data.get('in_reply_to', ''),
                references=input_data.get('references', ''),
                cc_emails=cc_emails,
                bcc_emails=bcc_emails,
            )
            if not draft:
                return "Le compte Gmail de facturation n'est pas connecte. Clique 'Reconnecter Gmail' dans Facturation pour brancher paie@soins-expert-plus.com."
            return json.dumps({"message": "Brouillon Gmail cree", "draft": draft}, ensure_ascii=False)
        if name == 'create_schedule_shift':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour creation de quart"
            client = None
            if input_data.get('client_id') or input_data.get('client_name'):
                client = await _find_client(db, input_data.get('client_id'), input_data.get('client_name'))
                if not client:
                    return "Client introuvable pour creation de quart"
            shift_date = _parse_date_value(input_data.get('date'))
            start_value = _normalize_time_value(input_data.get('start'), 'start')
            end_value = _normalize_time_value(input_data.get('end'), 'end')
            pause_hours = _get_pause_hours(input_data, default=0) or 0
            hours = _get_float_value(input_data, 'hours', default=None)
            if hours is None:
                hours = _calculate_schedule_hours(start_value, end_value, pause_hours)
            shift = Schedule(
                id=new_id(),
                employee_id=emp.id,
                client_id=client.id if client else getattr(emp, 'client_id', None),
                date=shift_date,
                start=start_value,
                end=end_value,
                hours=hours,
                pause=pause_hours,
                location=(input_data.get('location') or '').strip(),
                billable_rate=_get_float_value(input_data, 'billable_rate', default=float(getattr(emp, 'rate', 0) or 0)) or 0,
                status=(input_data.get('status') or 'published').strip() or 'published',
                notes=(input_data.get('notes') or '').strip(),
                km=_get_float_value(input_data, 'km', default=0) or 0,
                deplacement=_get_float_value(input_data, 'deplacement', default=0) or 0,
                autre_dep=_get_float_value(input_data, 'autre_dep', 'other_dep', default=0) or 0,
                garde_hours=_get_float_value(input_data, 'garde_hours', default=0) or 0,
                rappel_hours=_get_float_value(input_data, 'rappel_hours', default=0) or 0,
            )
            db.add(shift)
            await db.commit()
            await db.refresh(shift)
            _, client_name = await _get_schedule_names(db, shift)
            return json.dumps({
                "message": "Quart cree",
                "shift": _serialize_schedule(shift, emp.name, client_name),
            }, ensure_ascii=False)
        if name == 'update_schedule_shift':
            shift, error = await _find_schedule(
                db,
                schedule_id=input_data.get('schedule_id'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                current_date=input_data.get('current_date'),
                current_start=input_data.get('current_start'),
                current_end=input_data.get('current_end'),
            )
            if error:
                return error
            updates = {}
            if input_data.get('client_id') or input_data.get('client_name'):
                resolved_client = await _find_client(db, input_data.get('client_id'), input_data.get('client_name'))
                if not resolved_client:
                    return "Client introuvable pour mise a jour du quart"
                updates['client_id'] = resolved_client.id
            if input_data.get('date'):
                updates['date'] = _parse_date_value(input_data.get('date'))
            if input_data.get('start'):
                updates['start'] = _normalize_time_value(input_data.get('start'), 'start')
            if input_data.get('end'):
                updates['end'] = _normalize_time_value(input_data.get('end'), 'end')
            pause_hours = _get_pause_hours(input_data, default=None)
            if pause_hours is not None:
                updates['pause'] = pause_hours
            for text_key in ('location', 'status', 'notes'):
                if text_key in input_data and input_data.get(text_key) is not None:
                    updates[text_key] = str(input_data.get(text_key) or '').strip()
            numeric_map = {
                'billable_rate': ('billable_rate',),
                'hours': ('hours',),
                'km': ('km',),
                'deplacement': ('deplacement',),
                'autre_dep': ('autre_dep', 'other_dep'),
                'garde_hours': ('garde_hours',),
                'rappel_hours': ('rappel_hours',),
            }
            for target_key, source_keys in numeric_map.items():
                value = _get_float_value(input_data, *source_keys, default=None)
                if value is not None:
                    updates[target_key] = value
            if 'hours' not in updates and any(key in updates for key in ('start', 'end', 'pause')):
                updates['hours'] = _calculate_schedule_hours(
                    updates.get('start', shift.start),
                    updates.get('end', shift.end),
                    updates.get('pause', float(getattr(shift, 'pause', 0) or 0)),
                )
            if not updates:
                return "Aucune modification demandee pour ce quart"
            for key, value in updates.items():
                setattr(shift, key, value)
            await db.commit()
            await db.refresh(shift)
            employee_name, client_name = await _get_schedule_names(db, shift)
            return json.dumps({
                "message": "Quart mis a jour",
                "shift": _serialize_schedule(shift, employee_name, client_name),
            }, ensure_ascii=False)
        if name == 'delete_schedule_shift':
            shift, error = await _find_schedule(
                db,
                schedule_id=input_data.get('schedule_id'),
                employee_id=input_data.get('employee_id'),
                employee_name=input_data.get('employee_name'),
                client_id=input_data.get('client_id'),
                client_name=input_data.get('client_name'),
                current_date=input_data.get('current_date'),
                current_start=input_data.get('current_start'),
                current_end=input_data.get('current_end'),
            )
            if error:
                return error
            employee_name, client_name = await _get_schedule_names(db, shift)
            snapshot = _serialize_schedule(shift, employee_name, client_name)
            await db.delete(shift)
            await db.commit()
            return json.dumps({"message": "Quart supprime", "shift": snapshot}, ensure_ascii=False)
        if name == 'get_candidates':
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            emps = result.scalars().all()
            title_filter = _norm(input_data.get('title_filter', ''))
            region_filter = _norm(input_data.get('region_filter', ''))
            matches = []
            for e in emps:
                if title_filter and title_filter not in _norm(e.position or ''):
                    continue
                if region_filter and region_filter not in _norm(getattr(e, 'address', '') or '') and region_filter not in _norm(getattr(e, 'city', '') or ''):
                    continue
                matches.append({"id": e.id, "name": e.name, "position": e.position, "email": e.email, "phone": e.phone, "rate": e.rate})
            return json.dumps(matches[:50], ensure_ascii=False)
        if name == 'get_invoices_summary':
            q = select(Invoice).order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            if input_data.get('status_filter'):
                q = select(Invoice).where(Invoice.status == input_data['status_filter']).order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            if input_data.get('client_id'):
                base = select(Invoice).where(Invoice.client_id == input_data['client_id'])
                if input_data.get('status_filter'):
                    base = base.where(Invoice.status == input_data['status_filter'])
                q = base.order_by(desc(Invoice.date), desc(Invoice.created_at)).limit(100)
            result = await db.execute(q)
            invs = result.scalars().all()
            total = sum(float(getattr(i, 'total', 0) or 0) for i in invs)
            outstanding = sum(float(getattr(i, 'balance_due', 0) or 0) for i in invs)
            return json.dumps({"count": len(invs), "total": round(total, 2), "outstanding": round(outstanding, 2), "items": [{"id": i.id, "number": i.number, "client_name": i.client_name, "employee_name": i.employee_name, "status": i.status, "total": i.total, "balance_due": i.balance_due} for i in invs[:20]]}, ensure_ascii=False)
        if name == 'get_reports':
            result = await db.execute(select(Invoice).where(Invoice.status != 'cancelled').order_by(desc(Invoice.date)))
            invs = result.scalars().all()
            rtype = input_data['report_type']
            if rtype == 'by-client':
                agg = {}
                for i in invs:
                    key = i.client_name or 'Non assigné'
                    agg.setdefault(key, {"client_name": key, "total": 0, "count": 0, "outstanding": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["outstanding"] += float(i.balance_due or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['total'], reverse=True), ensure_ascii=False)
            if rtype == 'by-employee':
                agg = {}
                for i in invs:
                    key = i.employee_name or 'Non assigné'
                    agg.setdefault(key, {"employee_name": key, "total": 0, "count": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['total'], reverse=True), ensure_ascii=False)
            if rtype == 'by-period':
                agg = {}
                for i in invs:
                    key = i.date.strftime('%Y-%m') if i.date else 'unknown'
                    agg.setdefault(key, {"period": key, "total": 0, "count": 0})
                    agg[key]["total"] += float(i.total or 0)
                    agg[key]["count"] += 1
                return json.dumps(sorted(agg.values(), key=lambda x: x['period']), ensure_ascii=False)
        if name == 'get_accommodations':
            emp = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            q = select(Accommodation)
            if emp:
                q = q.where(Accommodation.employee_id == emp.id)
            result = await db.execute(q)
            accoms = result.scalars().all()
            data = []
            for a in accoms:
                er = await db.execute(select(Employee).where(Employee.id == a.employee_id))
                e = er.scalar_one_or_none()
                data.append({"id": a.id, "employee": e.name if e else '?', "employee_id": a.employee_id, "start": a.start_date.isoformat() if a.start_date else '', "end": a.end_date.isoformat() if a.end_date else '', "total_cost": a.total_cost, "days": a.days_worked, "cost_per_day": a.cost_per_day, "notes": getattr(a, 'notes', '') or ''})
            return json.dumps(data, ensure_ascii=False)
        if name == 'create_accommodation_record':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour hebergement"
            start_date = _parse_date_value(input_data.get('start_date'), 'start_date')
            end_date = _parse_date_value(input_data.get('end_date'), 'end_date')
            if end_date < start_date:
                return "La date de fin doit etre apres ou egale a la date de debut"
            total_cost = _get_float_value(input_data, 'total_cost', default=None)
            if total_cost is None:
                return "total_cost manquant pour l'hebergement"
            accommodation = Accommodation(
                id=new_id(),
                employee_id=emp.id,
                total_cost=total_cost,
                start_date=start_date,
                end_date=end_date,
                days_worked=int(_get_float_value(input_data, 'days_worked', default=0) or 0),
                cost_per_day=_get_float_value(input_data, 'cost_per_day', default=0) or 0,
                notes=(input_data.get('notes') or '').strip(),
            )
            db.add(accommodation)
            await db.commit()
            await db.refresh(accommodation)
            return json.dumps({
                "message": "Hebergement ajoute",
                "accommodation": {
                    "id": accommodation.id,
                    "employee_id": accommodation.employee_id,
                    "employee_name": emp.name,
                    "start_date": accommodation.start_date.isoformat(),
                    "end_date": accommodation.end_date.isoformat(),
                    "total_cost": float(accommodation.total_cost or 0),
                    "days_worked": int(accommodation.days_worked or 0),
                    "cost_per_day": float(accommodation.cost_per_day or 0),
                    "notes": accommodation.notes or "",
                },
            }, ensure_ascii=False)
        if name == 'reconcile_timesheet_invoice':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employe introuvable pour la conciliation"
            period_start = input_data.get('period_start')
            period_end = input_data.get('period_end')
            if not period_start or not period_end:
                fallback_start, fallback_end = completed_billing_period()
                period_start = fallback_start.isoformat()
                period_end = fallback_end.isoformat()
            resolved_client = None
            if input_data.get('client_id') or input_data.get('client_name'):
                resolved_client = await _find_client(db, input_data.get('client_id'), input_data.get('client_name'))
                if not resolved_client:
                    return "Client introuvable pour la conciliation"
            result = await build_timesheet_reconciliation(
                db,
                emp,
                date.fromisoformat(period_start),
                date.fromisoformat(period_end),
                invoice_id=(input_data.get('invoice_id') or '').strip(),
                client_id=resolved_client.id if resolved_client else None,
            )
            return json.dumps(result, ensure_ascii=False)
        if name == 'index_recent_timesheet_emails':
            documents = await list_recent_billing_gmail_documents(
                db,
                max_results=input_data.get('max_results', 10),
                search=input_data.get('search', '') or 'newer_than:14d',
                unread_only=bool(input_data.get('unread_only')),
            )
            if documents is None:
                return "Le compte Gmail de facturation n'est pas connecte. Clique 'Reconnecter Gmail' dans Facturation pour brancher paie@soins-expert-plus.com."
            result = await index_recent_timesheet_email_documents(db, documents, uploaded_by='chatbot')
            await db.commit()
            return json.dumps(result, ensure_ascii=False)
        if name == 'analyze_recent_timesheet_documents':
            employee = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                employee = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
                if input_data.get('employee_name') and not employee:
                    return "Employe introuvable pour l'analyse des FDT"
            documents = await list_recent_billing_gmail_documents(
                db,
                max_results=input_data.get('max_results', 10),
                search=input_data.get('search', '') or 'newer_than:21d',
                unread_only=bool(input_data.get('unread_only')),
            )
            if documents is None:
                return "Le compte Gmail de facturation n'est pas connecte. Clique 'Reconnecter Gmail' dans Facturation pour brancher paie@soins-expert-plus.com."
            items = await summarize_recent_timesheet_documents(db, documents, employee=employee)
            if not items:
                if employee:
                    return f"Aucune FDT recente exploitable n'a ete trouvee pour {employee.name} dans la boite paie."
                return "Aucune vraie FDT recente exploitable n'a pu etre lue dans la boite paie."
            lines = []
            for idx, item in enumerate(items[: input_data.get('max_results', 10)], start=1):
                employee_label = item.get('employee_name') or 'Employe a confirmer'
                period_bits = []
                if item.get('period_start') and item.get('period_end'):
                    period_bits.append(f"{item.get('period_start')} au {item.get('period_end')}")
                signature = "signee" if item.get('is_signed') is True else "signature a verifier" if item.get('is_signed') is False else "signature non confirmee"
                lines.append(f"{idx}. {employee_label} — {item.get('filename', 'document')}")
                if period_bits:
                    lines.append(f"   Periode: {'; '.join(period_bits)}")
                lines.append(f"   Signature: {signature}")
                if item.get('shift_count'):
                    lines.append("   Quarts:")
                    for shift in item.get('shifts', [])[:12]:
                        shift_bits = []
                        if shift.get('date'):
                            shift_bits.append(shift['date'])
                        if shift.get('start') or shift.get('end'):
                            shift_bits.append(f"{shift.get('start') or '?'}-{shift.get('end') or '?'}")
                        if shift.get('pause_minutes'):
                            shift_bits.append(f"pause {shift.get('pause_minutes')} min")
                        if shift.get('hours'):
                            shift_bits.append(f"{shift.get('hours')} h")
                        if shift.get('type') and shift.get('type') != 'unknown':
                            shift_bits.append(shift.get('type'))
                        lines.append(f"   - {' | '.join(shift_bits) if shift_bits else 'Quart detecte'}")
                else:
                    lines.append("   Quarts: lecture partielle, quarts non extraits clairement.")
                if item.get('notes'):
                    lines.append(f"   Note: {item.get('notes')}")
            return "\n".join(lines)
        if name == 'process_incoming_timesheet_emails':
            result = await process_incoming_timesheet_emails(
                triggered_by="chatbot",
                max_results=input_data.get('max_results', 30),
                unread_only=bool(input_data.get('unread_only')),
            )
            return json.dumps(result, ensure_ascii=False)
        if name == 'send_weekly_timesheet_reminder':
            result = await send_weekly_timesheet_reminder(
                triggered_by="chatbot",
                force=bool(input_data.get('force')),
            )
            return json.dumps(result, ensure_ascii=False)
        if name == 'draft_weekly_timesheet_reminder':
            result = await draft_weekly_timesheet_reminder(triggered_by="chatbot")
            return json.dumps(result, ensure_ascii=False)
        if name == 'get_automation_config':
            return json.dumps(get_automation_config(), ensure_ascii=False)
        if name == 'get_timesheet_documents_summary':
            emp = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
                if input_data.get('employee_name') and not emp:
                    return "Employe introuvable pour le resume FDT"
            summary = await build_timesheet_documents_summary(
                db,
                group_by=(input_data.get('group_by') or 'week'),
                employee_id=emp.id if emp else input_data.get('employee_id'),
            )
            return json.dumps(summary, ensure_ascii=False)
        if name == 'get_accommodation_documents_summary':
            emp = None
            if input_data.get('employee_id') or input_data.get('employee_name'):
                emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
                if input_data.get('employee_name') and not emp:
                    return "Employe introuvable pour le resume hebergement"
            summary = await build_accommodation_documents_summary(
                db,
                group_by=(input_data.get('group_by') or 'week'),
                employee_id=emp.id if emp else input_data.get('employee_id'),
            )
            return json.dumps(summary, ensure_ascii=False)
        if name == 'get_business_info':
            return BUSINESS_KNOWLEDGE
        return f"Outil '{name}' non reconnu"
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        return f"Erreur outil {name}: {str(e)}"

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les horaires, les courriels, les hébergements, les rapports et générer des factures brouillon à partir des données déjà dans la plateforme. Quand on te demande de générer une facture, utilise l'outil generate_invoice_for_employee. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les employés actifs, lire les courriels, proposer des candidats et créer des quarts de travail. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as accès aux outils de facturation, recrutement, courriels et rapports. Utilise les outils dès qu'une action ou une donnée système est demandée. Réponds en français.\n\n" + BUSINESS_KNOWLEDGE

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu peux consulter la boite paie, lire les courriels recents, indexer les FDT recues, consulter et modifier les horaires, ajouter des hebergements, envoyer le rappel hebdomadaire de FDT, generer des factures brouillon et concilier une FDT avec la facture correspondante. Tu dois raisonner comme un vrai commis de facturation et de paie qui agit dans le meilleur interet de l'entreprise: ne retiens pas les pieces jointes sans rapport, privilegie les vraies FDT, et explique clairement quand une verification humaine est encore necessaire. Quand on te demande de creer une facture pour la periode actuelle, utilise l'outil generate_current_invoice_for_employee. Pour une periode precise, utilise l'outil generate_invoice_for_employee. Quand on te demande de concilier une FDT et une facture, utilise reconcile_timesheet_invoice et mentionne clairement le niveau de confiance. Quand on te demande d'indexer les FDT recues par courriel, utilise index_recent_timesheet_emails. Quand on te demande de lister les dernieres vraies FDT recues ou d'analyser les quarts, pauses ou signatures visibles sur les FDT, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand on te demande de traiter ou surveiller les courriels entrants et preparer les brouillons, utilise process_incoming_timesheet_emails. Quand on te demande le rappel hebdomadaire du dimanche, utilise send_weekly_timesheet_reminder. Quand on te demande un resume des documents FDT ou hebergement par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Quand on te demande de modifier un quart, utilise les outils create_schedule_shift, update_schedule_shift ou delete_schedule_shift. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft. N'utilise jamais send_email pour un brouillon. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu peux consulter les employes actifs, lire les courriels, proposer des candidats et creer, modifier ou supprimer des quarts de travail. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as acces aux outils de facturation, recrutement, courriels, hebergements, horaires et FDT. Utilise les outils des qu'une action ou une donnee systeme est demandee. Si l'utilisateur demande une modification de quart, un ajout d'hebergement, une lecture de courriel paie, l'indexation de FDT recues, le traitement automatique des courriels entrants, la generation d'une facture, une conciliation FDT-facture ou l'envoi du rappel hebdomadaire de FDT, execute l'action demandee puis resume le resultat. Agis comme un commis de facturation prudent: ignore les pieces jointes qui ne sont pas pertinentes et dis clairement quand une verification visuelle reste necessaire. Pour lister les dernieres vraies FDT recues ou analyser les quarts, pauses et signatures visibles, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand l'utilisateur parle de la periode actuelle de facturation, utilise l'outil generate_current_invoice_for_employee. Quand l'utilisateur demande un niveau de confiance, utilise reconcile_timesheet_invoice et cite clairement le niveau eleve, moyen ou faible. Quand l'utilisateur demande de traiter ou surveiller les courriels entrants, utilise process_incoming_timesheet_emails. Quand l'utilisateur demande un resume documentaire par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft et ne l'envoie pas. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais.\n\n" + BUSINESS_KNOWLEDGE

def _detect_prompt(message: str):
    m = message.lower()
    if any(kw in m for kw in ['factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impay', 'conciliation', 'courriel', 'email', 'gmail', 'brouillon', 'draft', 'hebergement', 'hébergement', 'rappel', 'document']):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in ['candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation', 'placement', 'horaire', 'quart']):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    if any(kw in m for kw in ['factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impayé', 'conciliation']):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in ['candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation', 'placement']):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    return GENERAL_PROMPT, 'general'

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu peux consulter la boite paie, lire les courriels recents, indexer les FDT recues, consulter et modifier les horaires, ajouter des hebergements, envoyer ou preparer le rappel hebdomadaire de FDT, generer des factures brouillon et concilier une FDT avec la facture correspondante. Tu dois raisonner comme un vrai commis de facturation et de paie qui agit dans le meilleur interet de l'entreprise: ne retiens pas les pieces jointes sans rapport, privilegie les vraies FDT, et explique clairement quand une verification humaine est encore necessaire. Les demandes concernant FDT, courriels paie, rappels du dimanche, pieces jointes, pauses, signatures, quarts visibles sur une FDT, brouillons Gmail et automatisation restent du cote facturation meme si le mot quart apparait. Quand on te demande de creer une facture pour la periode actuelle, utilise l'outil generate_current_invoice_for_employee. Pour une periode precise, utilise l'outil generate_invoice_for_employee. Quand on te demande de concilier une FDT et une facture, utilise reconcile_timesheet_invoice et mentionne clairement le niveau de confiance. Quand on te demande d'indexer les FDT recues par courriel, utilise index_recent_timesheet_emails. Quand on te demande de lister les dernieres vraies FDT recues ou d'analyser les quarts, pauses ou signatures visibles sur les FDT, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand on te demande de traiter ou surveiller les courriels entrants et preparer les brouillons, utilise process_incoming_timesheet_emails. Quand on te demande le rappel hebdomadaire du dimanche, utilise send_weekly_timesheet_reminder. Quand on te demande un test, un brouillon Gmail ou un envoi de masse en brouillon pour ce rappel, utilise draft_weekly_timesheet_reminder. Quand on te demande quel jour, quelle heure, quel fuseau horaire ou quels courriels sont configures pour les taches du dimanche, utilise get_automation_config. Quand on te demande un resume des documents FDT ou hebergement par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Quand on te demande de modifier un quart, utilise les outils create_schedule_shift, update_schedule_shift ou delete_schedule_shift. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft. N'utilise jamais send_email pour un brouillon. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as acces aux outils de facturation, recrutement, courriels, hebergements, horaires et FDT. Utilise les outils des qu'une action ou une donnee systeme est demandee. Si l'utilisateur demande une modification de quart, un ajout d'hebergement, une lecture de courriel paie, l'indexation de FDT recues, le traitement automatique des courriels entrants, la generation d'une facture, une conciliation FDT-facture ou l'envoi du rappel hebdomadaire de FDT, execute l'action demandee puis resume le resultat. Agis comme un commis de facturation prudent: ignore les pieces jointes qui ne sont pas pertinentes et dis clairement quand une verification visuelle reste necessaire. Pour lister les dernieres vraies FDT recues ou analyser les quarts, pauses et signatures visibles, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand l'utilisateur parle de la periode actuelle de facturation, utilise l'outil generate_current_invoice_for_employee. Quand l'utilisateur demande un niveau de confiance, utilise reconcile_timesheet_invoice et cite clairement le niveau eleve, moyen ou faible. Quand l'utilisateur demande de traiter ou surveiller les courriels entrants, utilise process_incoming_timesheet_emails. Quand l'utilisateur demande un rappel hebdomadaire en brouillon Gmail ou un test d'envoi de masse en brouillon, utilise draft_weekly_timesheet_reminder. Quand l'utilisateur demande le jour, l'heure, le fuseau horaire ou les destinataires du rappel du dimanche, utilise get_automation_config. Quand l'utilisateur demande un resume documentaire par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft et ne l'envoie pas. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais.\n\n" + BUSINESS_KNOWLEDGE
AGENT_FACTURATION_PROMPT += "\nQuand tu traites les courriels entrants, classe les pieces jointes utiles par employe: FDT dans les feuilles de temps, documents d'hebergement dans hebergement, et ignore le reste si ce n'est pas pertinent."
GENERAL_PROMPT += "\nQuand l'utilisateur demande de trier ou classer les courriels recus, priorise la facturation: FDT, hebergement et pieces jointes utiles par employe."
AGENT_FACTURATION_PROMPT += "\nQuand l'utilisateur joint des documents dans cette conversation, liste-les au besoin avec list_chat_session_documents. Si l'utilisateur te demande de lire, analyser ou resumer une FDT jointe directement dans le chat, utilise analyze_chat_session_documents. Tu peux les rattacher a une facture avec attach_chat_documents_to_invoice, ou les joindre a un courriel ou brouillon Gmail avec document_ids, filename_query ou attach_all_session_documents dans send_email et create_email_draft. Si l'utilisateur donne seulement un nom de personne sans adresse courriel, utilise resolve_contact_email avant l'envoi."
GENERAL_PROMPT += "\nSi des documents sont joints dans cette conversation, tu peux les reutiliser pour une facture ou un courriel. Utilise list_chat_session_documents pour les voir, analyze_chat_session_documents pour lire une FDT jointe et attach_chat_documents_to_invoice pour les rattacher a une facture."


def _detect_prompt(message: str):
    m = _norm(message)
    facturation_keywords = [
        'factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impay', 'conciliation',
        'courriel', 'courriels', 'email', 'emails', 'gmail', 'brouillon', 'draft',
        'hebergement', 'rappel', 'dimanche', 'hebdomadaire', 'automatisation', 'automation',
        'document', 'documents', 'piece jointe', 'pieces jointes', 'signature', 'signer',
        'pause', 'pauses', 'visible', 'visibles', 'pdf', 'jpg', 'jpeg', 'cci', 'bcc'
    ]
    recrutement_keywords = [
        'candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation',
        'placement', 'horaire', 'quart', 'quarts'
    ]
    if any(kw in m for kw in facturation_keywords):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in recrutement_keywords):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    return GENERAL_PROMPT, 'general'


AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu peux consulter la boite paie, lire les courriels recents, indexer les FDT recues, consulter et modifier les horaires, ajouter des hebergements, envoyer ou preparer le rappel hebdomadaire de FDT, generer des factures brouillon et concilier une FDT avec la facture correspondante. Tu dois raisonner comme un vrai commis de facturation et de paie qui agit dans le meilleur interet de l'entreprise: ne retiens pas les pieces jointes sans rapport, privilegie les vraies FDT, et explique clairement quand une verification humaine est encore necessaire. Les demandes concernant FDT, courriels paie, rappels du dimanche, pieces jointes, pauses, signatures, quarts visibles sur une FDT, brouillons Gmail et automatisation restent du cote facturation meme si le mot quart apparait. Quand on te demande de creer une facture pour la periode actuelle, utilise l'outil generate_current_invoice_for_employee. Pour une periode precise, utilise l'outil generate_invoice_for_employee. Si l'utilisateur demande explicitement de generer une facture a partir d'une FDT jointe dans le chat, ne fais pas semblant de l'avoir fait via l'horaire: dis clairement si l'outil disponible genere encore depuis l'horaire de la plateforme plutot que depuis les quarts extraits du document. Quand on te demande de consulter ou modifier une facture brouillon existante directement dans la facture et non dans l'horaire, utilise get_invoice_details puis update_invoice_service_line, add_invoice_expense_line, delete_invoice_expense_line, add_invoice_accommodation_per_worked_day ou delete_invoice_accommodation_line selon le besoin. Quand on te demande de concilier une FDT et une facture, utilise reconcile_timesheet_invoice et mentionne clairement le niveau de confiance. Quand on te demande d'indexer les FDT recues par courriel, utilise index_recent_timesheet_emails. Quand on te demande de lister les dernieres vraies FDT recues ou d'analyser les quarts, pauses ou signatures visibles sur les FDT, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand on te demande de traiter ou surveiller les courriels entrants et preparer les brouillons, utilise process_incoming_timesheet_emails. Quand on te demande le rappel hebdomadaire du dimanche, utilise send_weekly_timesheet_reminder. Quand on te demande un test, un brouillon Gmail ou un envoi de masse en brouillon pour ce rappel, utilise draft_weekly_timesheet_reminder. Quand on te demande quel jour, quelle heure, quel fuseau horaire ou quels courriels sont configures pour les taches du dimanche, utilise get_automation_config. Quand on te demande un resume des documents FDT ou hebergement par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Quand on te demande de modifier un quart, utilise les outils create_schedule_shift, update_schedule_shift ou delete_schedule_shift. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft. N'utilise jamais send_email pour un brouillon. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu peux consulter les employes actifs, lire les courriels, proposer des candidats et creer, modifier ou supprimer des quarts de travail. Reponds en francais quebecois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as acces aux outils de facturation, recrutement, courriels, hebergements, horaires et FDT. Utilise les outils des qu'une action ou une donnee systeme est demandee. Si l'utilisateur demande une modification de quart, un ajout d'hebergement, une lecture de courriel paie, l'indexation de FDT recues, le traitement automatique des courriels entrants, la generation d'une facture, une conciliation FDT-facture ou l'envoi du rappel hebdomadaire de FDT, execute l'action demandee puis resume le resultat. Agis comme un commis de facturation prudent: ignore les pieces jointes qui ne sont pas pertinentes et dis clairement quand une verification visuelle reste necessaire. Pour lister les dernieres vraies FDT recues ou analyser les quarts, pauses et signatures visibles, utilise analyze_recent_timesheet_documents plutot que read_recent_emails. Quand l'utilisateur parle de la periode actuelle de facturation, utilise l'outil generate_current_invoice_for_employee. Quand l'utilisateur demande de modifier directement une facture brouillon existante, utilise les outils get_invoice_details, update_invoice_service_line, add_invoice_expense_line, delete_invoice_expense_line, add_invoice_accommodation_per_worked_day ou delete_invoice_accommodation_line au lieu de modifier l'horaire. Quand l'utilisateur demande un niveau de confiance, utilise reconcile_timesheet_invoice et cite clairement le niveau eleve, moyen ou faible. Quand l'utilisateur demande de traiter ou surveiller les courriels entrants, utilise process_incoming_timesheet_emails. Quand l'utilisateur demande un rappel hebdomadaire en brouillon Gmail ou un test d'envoi de masse en brouillon, utilise draft_weekly_timesheet_reminder. Quand l'utilisateur demande le jour, l'heure, le fuseau horaire ou les destinataires du rappel du dimanche, utilise get_automation_config. Quand l'utilisateur demande un resume documentaire par semaine ou par mois, utilise get_timesheet_documents_summary ou get_accommodation_documents_summary. Si l'utilisateur donne une date explicite comme 06 avril, 2026-04-06 ou 06/04, preserve exactement ce jour dans l'outil. Pour supprimer un quart, utilise delete_schedule_shift. Si un seul quart existe cette journee pour cet employe, la date suffit. Sinon preserve aussi l'heure de debut. Si l'utilisateur demande seulement un brouillon de reponse, redige le texte dans le chat. S'il demande explicitement de creer, enregistrer ou mettre ce message dans les brouillons Gmail, utilise create_email_draft et ne l'envoie pas. Si un outil retourne une erreur, cite clairement la vraie erreur et la prochaine action concrete a faire, sans la diluer. Reponds en francais.\n\n" + BUSINESS_KNOWLEDGE


def _detect_prompt(message: str):
    m = _norm(message)
    facturation_keywords = [
        'factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impay', 'conciliation',
        'courriel', 'courriels', 'email', 'emails', 'gmail', 'brouillon', 'draft',
        'hebergement', 'frais', 'ajustement', 'ligne de facture', 'rappel', 'dimanche',
        'hebdomadaire', 'automatisation', 'automation', 'document', 'documents',
        'piece jointe', 'pieces jointes', 'signature', 'signer', 'pause', 'pauses',
        'visible', 'visibles', 'pdf', 'jpg', 'jpeg', 'cci', 'bcc'
    ]
    recrutement_keywords = [
        'candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation',
        'placement', 'horaire', 'quart', 'quarts'
    ]
    if any(kw in m for kw in facturation_keywords):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in recrutement_keywords):
        return AGENT_RECRUTEMENT_PROMPT, 'recrutement'
    return GENERAL_PROMPT, 'general'


def _history_to_input(history, user_message):
    items = []
    for m in history or []:
        items.append({"role": m.get('role', 'user'), "content": str(m.get('content', ''))})
    items.append({"role": 'user', "content": user_message})
    return items

def _extract_text(data):
    if data.get('output_text'):
        return data['output_text']
    texts = []
    for item in data.get('output', []) or []:
        if item.get('type') == 'message':
            for c in item.get('content', []) or []:
                if c.get('type') in ('output_text', 'text') and c.get('text'):
                    texts.append(c['text'])
    return '\n'.join(texts).strip()


def _extract_last_tool_output(inputs):
    for item in reversed(inputs or []):
        if item.get('type') == 'function_call_output' and item.get('output'):
            return str(item.get('output') or '').strip()
    return ''


def _normalized_reasoning_effort() -> str:
    effort = (OPENAI_REASONING_EFFORT or "medium").strip().lower()
    return effort if effort in {"none", "low", "medium", "high", "xhigh"} else "medium"


def _supports_reasoning(model_name: str) -> bool:
    model = (model_name or "").strip().lower()
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


def _build_openai_request_payload(system_prompt, inputs):
    payload = {
        'model': OPENAI_MODEL,
        'instructions': system_prompt,
        'input': inputs,
        'tools': TOOLS,
        'parallel_tool_calls': False,
    }
    if _supports_reasoning(OPENAI_MODEL):
        payload['reasoning'] = {'effort': _normalized_reasoning_effort()}
    return payload


def _infer_chatbot_upload_type(filename: str, mime_type: str = ""):
    normalized_mime = (mime_type or "").strip().lower()
    if normalized_mime in CHATBOT_ALLOWED_MIME:
        return CHATBOT_ALLOWED_MIME[normalized_mime], normalized_mime

    lower_name = (filename or "").strip().lower()
    extension_map = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
    }
    for suffix, mapped_mime in extension_map.items():
        if lower_name.endswith(suffix):
            return CHATBOT_ALLOWED_MIME[mapped_mime], mapped_mime
    raise HTTPException(
        status_code=400,
        detail="Type de document non supporte dans le chatbot. Formats acceptes: PDF, JPG, PNG, GIF, HEIC, TXT, CSV, DOCX, XLSX.",
    )


@router.get('/uploads')
async def list_chatbot_uploads(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    uploads = await _get_chat_session_uploads(db, session_id)
    return [_serialize_chat_upload(item) for item in uploads]


@router.post('/uploads')
async def upload_chatbot_documents(
    session_id: str = Form(...),
    description: str = Form(""),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    normalized_session_id = (session_id or "").strip()
    if not normalized_session_id:
        raise HTTPException(status_code=400, detail="session_id manquant")
    if not files:
        raise HTTPException(status_code=400, detail="Aucun fichier a televerser")

    created = []
    for upload in files:
        original_filename = (upload.filename or "document").strip() or "document"
        content = await upload.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"Le fichier {original_filename} est vide")
        if len(content) > CHATBOT_MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Le fichier {original_filename} depasse la limite de 15 Mo",
            )
        file_type, normalized_mime = _infer_chatbot_upload_type(original_filename, upload.content_type or "")
        stored = ChatbotUpload(
            session_id=normalized_session_id,
            filename=f"{new_id()}.{file_type}",
            original_filename=original_filename,
            file_type=file_type,
            mime_type=normalized_mime,
            file_size=len(content),
            file_data=content,
            description=(description or "").strip(),
            uploaded_by=getattr(user, 'email', '') or 'admin',
        )
        db.add(stored)
        created.append(stored)

    await db.commit()
    for item in created:
        await db.refresh(item)
    return [_serialize_chat_upload(item) for item in created]


@router.get('/uploads/{upload_id}')
async def download_chatbot_upload(
    upload_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(ChatbotUpload).where(ChatbotUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Document introuvable")
    safe_name = upload.original_filename or upload.filename or "document"
    return Response(
        content=upload.file_data,
        media_type=upload.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


@router.delete('/uploads/{upload_id}')
async def delete_chatbot_upload(
    upload_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    result = await db.execute(select(ChatbotUpload).where(ChatbotUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Document introuvable")
    await db.delete(upload)
    await db.commit()
    return {"ok": True}

@router.post('/chat')
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail='Clé API OpenAI non configurée. Ajouter OPENAI_API_KEY dans les variables d\'environnement Render.')
    system_prompt, agent_name = _detect_prompt(msg.message)
    session_uploads = await _get_chat_session_uploads(db, msg.session_id)
    system_prompt = f"{system_prompt}{_chat_upload_context_text(session_uploads)}"
    if session_uploads and _message_requests_chat_upload_analysis(msg.message, session_uploads, msg.history):
        try:
            items = await summarize_explicit_timesheet_documents(
                db,
                [_chat_upload_to_document(upload) for upload in session_uploads],
                raise_on_openai_error=True,
            )
            return {
                'reply': _format_timesheet_analysis_response(items, max_results=5),
                'usage': {},
                'agent': 'facturation',
                'model': os.getenv("TIMESHEET_ATTACHMENT_MODEL") or OPENAI_MODEL,
                'reasoning_effort': _normalized_reasoning_effort() if _supports_reasoning(os.getenv("TIMESHEET_ATTACHMENT_MODEL") or OPENAI_MODEL) else None,
            }
        except RuntimeError as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Analyse FDT impossible avec l'API OpenAI du site: "
                    f"{exc}. Verifie le quota/facturation de OPENAI_API_KEY sur Render."
                ),
            )
    inputs = _history_to_input(msg.history, msg.message)
    headers = {'Authorization': f'Bearer {OPENAI_API_KEY}', 'Content-Type': 'application/json'}
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            data = None
            for _ in range(8):
                resp = await client.post(
                    'https://api.openai.com/v1/responses',
                    headers=headers,
                    json=_build_openai_request_payload(system_prompt, inputs),
                )
                resp.raise_for_status()
                data = resp.json()
                tool_calls = [item for item in data.get('output', []) if item.get('type') == 'function_call']
                if not tool_calls:
                    break
                inputs.extend(data.get('output', []))
                for call in tool_calls:
                    try:
                        args = json.loads(call.get('arguments') or '{}')
                    except Exception:
                        args = {}
                    result = await execute_tool(call.get('name', ''), args, db, msg.message, msg.session_id)
                    inputs.append({'type': 'function_call_output', 'call_id': call.get('call_id'), 'output': result})
            return {
                'reply': _extract_text(data or {}) or _extract_last_tool_output(inputs) or "Je n'ai pas pu générer de réponse.",
                'usage': (data or {}).get('usage', {}),
                'agent': agent_name,
                'model': OPENAI_MODEL,
                'reasoning_effort': _normalized_reasoning_effort() if _supports_reasoning(OPENAI_MODEL) else None,
            }
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f'Erreur API OpenAI: {e.response.text}')
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
