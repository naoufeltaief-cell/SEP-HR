"""
Soins Expert Plus — Dual Agent System
OpenAI Responses API + business tools.
"""
import os
import json
import httpx
import imaplib
import email as email_lib
from email.header import decode_header
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from ..database import get_db
from ..models.models import Employee, Schedule, Client, Accommodation
from ..models.models_invoice import Invoice
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin
from ..services.email_service import _send_email
from ..services.invoice_service import generate_invoice_number, recalculate_invoice, is_tax_exempt, get_rate_for_title, GARDE_RATE, KM_RATE, MAX_KM, MAX_DEPLACEMENT_HOURS

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1")
IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_USER = os.getenv("IMAP_USER", os.getenv("SMTP_USER", ""))
IMAP_PASS = os.getenv("IMAP_PASS", os.getenv("SMTP_PASS", ""))

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
    {"name": "send_email", "description": "Envoyer un courriel.", "input_schema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body_html": {"type": "string"}}, "required": ["to", "subject", "body_html"]}},
    {"name": "get_candidates", "description": "Lister les employés actifs, avec filtres par titre/région, pour soumission ou assignation.", "input_schema": {"type": "object", "properties": {"title_filter": {"type": "string"}, "region_filter": {"type": "string"}}}},
    {"name": "get_invoices_summary", "description": "Obtenir un résumé des factures avec filtre optionnel par statut ou client.", "input_schema": {"type": "object", "properties": {"status_filter": {"type": "string"}, "client_id": {"type": "integer"}}}},
    {"name": "get_reports", "description": "Obtenir les rapports facturation par client, employé ou période.", "input_schema": {"type": "object", "properties": {"report_type": {"type": "string", "enum": ["by-client", "by-employee", "by-period"]}}, "required": ["report_type"]}},
    {"name": "get_accommodations", "description": "Obtenir la liste des hébergements actifs pour les employés.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "employee_name": {"type": "string"}}}},
    {"name": "get_business_info", "description": "Obtenir les informations business.", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}}},
]
TOOLS = [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"], "strict": False} for t in RAW_TOOLS]


def _norm(s: str) -> str:
    return (s or "").strip().lower()

async def _find_employee(db: AsyncSession, employee_id=None, employee_name=None):
    if employee_id:
        r = await db.execute(select(Employee).where(Employee.id == employee_id))
        return r.scalar_one_or_none()
    if employee_name:
        q = _norm(employee_name)
        r = await db.execute(select(Employee).where(Employee.is_active == True))
        emps = r.scalars().all()
        exact = [e for e in emps if _norm(e.name) == q]
        if exact:
            return exact[0]
        partial = [e for e in emps if q in _norm(e.name)]
        if len(partial) == 1:
            return partial[0]
    return None

async def _build_invoice_from_schedules(db: AsyncSession, employee, period_start: str, period_end: str):
    ps = date.fromisoformat(period_start)
    pe = date.fromisoformat(period_end)
    scheds_r = await db.execute(select(Schedule).where(Schedule.employee_id == employee.id, Schedule.date >= ps, Schedule.date <= pe, Schedule.status != 'cancelled').order_by(Schedule.date))
    scheds = scheds_r.scalars().all()
    if not scheds:
        return {"error": "Aucun quart trouvé pour cette période"}
    client_ids = sorted({s.client_id for s in scheds if getattr(s, 'client_id', None)})
    effective_client = None
    if len(client_ids) == 1:
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
        hours = round((getattr(s, 'hours', 0) or 0), 2)
        garde_h = getattr(s, 'garde_hours', 0) or 0
        rappel_h = getattr(s, 'rappel_hours', 0) or 0
        garde_billable = garde_h / 8.0 if garde_h else 0
        lines.append({"date": s.date.isoformat() if hasattr(s.date, 'isoformat') else str(s.date), "employee": employee.name or '', "location": effective_client.name, "start": getattr(s, 'start', '') or '', "end": getattr(s, 'end', '') or '', "pause_min": getattr(s, 'pause', 0) or 0, "hours": hours, "rate": rate, "service_amount": round(hours * rate, 2), "garde_hours": garde_h, "garde_amount": round(garde_billable * GARDE_RATE, 2), "rappel_hours": rappel_h, "rappel_amount": round(rappel_h * rate, 2)})
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

async def execute_tool(name: str, input_data: dict, db: AsyncSession) -> str:
    try:
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
            return json.dumps([{"id": c.id, "name": c.name, "email": getattr(c, 'email', ''), "address": getattr(c, 'address', ''), "tax_exempt": getattr(c, 'tax_exempt', False)} for c in matches[:20]], ensure_ascii=False)
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
            return json.dumps({"employee_id": emp.id, "employee_name": emp.name, "shifts": [{"date": s.date.isoformat(), "start": s.start, "end": s.end, "hours": s.hours, "location": s.location, "client_id": s.client_id, "rate": s.billable_rate, "km": getattr(s, 'km', 0) or 0, "deplacement": getattr(s, 'deplacement', 0) or 0, "autre_dep": getattr(s, 'autre_dep', 0) or 0} for s in shifts], "total_hours": sum(s.hours for s in shifts), "total_shifts": len(shifts)}, ensure_ascii=False)
        if name == 'generate_invoice_for_employee':
            emp = await _find_employee(db, input_data.get('employee_id'), input_data.get('employee_name'))
            if not emp:
                return "Employé introuvable pour génération de facture"
            result = await _build_invoice_from_schedules(db, emp, input_data['period_start'], input_data['period_end'])
            return json.dumps(result, ensure_ascii=False)
        if name == 'read_recent_emails':
            if not IMAP_USER or not IMAP_PASS:
                return "Configuration IMAP manquante."
            try:
                mail = imaplib.IMAP4_SSL(IMAP_HOST)
                mail.login(IMAP_USER, IMAP_PASS)
                folder = input_data.get('folder', 'INBOX')
                mail.select(folder)
                search_criteria = 'ALL'
                if input_data.get('search'):
                    s = input_data['search']
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
                return json.dumps(emails, ensure_ascii=False)
            except Exception as e:
                return f"Erreur lecture emails: {str(e)}"
        if name == 'send_email':
            await _send_email(input_data['to'], input_data['subject'], input_data['body_html'])
            return f"Courriel envoyé à {input_data['to']}: {input_data['subject']}"
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
                data.append({"employee": e.name if e else '?', "employee_id": a.employee_id, "start": a.start_date.isoformat() if a.start_date else '', "end": a.end_date.isoformat() if a.end_date else '', "total_cost": a.total_cost, "days": a.days_worked, "cost_per_day": a.cost_per_day})
            return json.dumps(data, ensure_ascii=False)
        if name == 'get_business_info':
            return BUSINESS_KNOWLEDGE
        return f"Outil '{name}' non reconnu"
    except Exception as e:
        return f"Erreur outil {name}: {str(e)}"

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les horaires, les courriels, les hébergements, les rapports et générer des factures brouillon à partir des données déjà dans la plateforme. Quand on te demande de générer une facture, utilise l'outil generate_invoice_for_employee. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Tu as l'autorité nécessaire pour consulter les employés actifs, lire les courriels, proposer des candidats et créer des quarts de travail. Réponds en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Tu as accès aux outils de facturation, recrutement, courriels et rapports. Utilise les outils dès qu'une action ou une donnée système est demandée. Réponds en français.\n\n" + BUSINESS_KNOWLEDGE

def _detect_prompt(message: str):
    m = message.lower()
    if any(kw in m for kw in ['factur', 'fdt', 'feuille de temps', 'paie', 'paiement', 'impayé', 'conciliation']):
        return AGENT_FACTURATION_PROMPT, 'facturation'
    if any(kw in m for kw in ['candidat', 'recrutement', 'besoin', 'soumission', 'disponib', 'assignation', 'placement']):
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

@router.post('/chat')
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail='Clé API OpenAI non configurée. Ajouter OPENAI_API_KEY dans les variables d\'environnement Render.')
    system_prompt, agent_name = _detect_prompt(msg.message)
    inputs = _history_to_input(msg.history, msg.message)
    headers = {'Authorization': f'Bearer {OPENAI_API_KEY}', 'Content-Type': 'application/json'}
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            data = None
            for _ in range(8):
                resp = await client.post('https://api.openai.com/v1/responses', headers=headers, json={'model': OPENAI_MODEL, 'instructions': system_prompt, 'input': inputs, 'tools': TOOLS, 'parallel_tool_calls': False})
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
                    result = await execute_tool(call.get('name', ''), args, db)
                    inputs.append({'type': 'function_call_output', 'call_id': call.get('call_id'), 'output': result})
            return {'reply': _extract_text(data or {}) or "Je n'ai pas pu générer de réponse.", 'usage': (data or {}).get('usage', {}), 'agent': agent_name, 'model': OPENAI_MODEL}
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f'Erreur API OpenAI: {e.response.text}')
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
