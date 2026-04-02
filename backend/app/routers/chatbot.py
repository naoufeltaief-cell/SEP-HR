"""
Soins Expert Plus — Dual Agent System
Agent 1: Facturation (FDT monitoring, invoice drafts, email reconciliation)
Agent 2: Recrutement (client needs, candidate suggestions, scheduling, email responses)
OpenAI Responses API + function tools.
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
from sqlalchemy import select
from ..database import get_db
from ..models.models import Employee, Schedule, Client, Accommodation
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin
from ..services.email_service import _send_email

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
- Hébergement: Coût total ÷ nombre de jours travaillés = coût/jour facturé au client
- TPS: 5% (numéro: 714564891RT0001)
- TVQ: 9.975% (numéro: 1225765936TQ0001)
- Clients exemptés de taxes: Centre de Santé Inuulitsivik, Conseil Cri de la Santé

CALENDRIER DE PAIE:
- Période de paie: aux 2 semaines (dimanche au samedi)
- Échéance envoi factures: Mardi (semaine normale), Mardi avant 12h (semaine de paie)
- FDT: doit être signée par l'employé ET un représentant du CIUSSS/CISSS

FEUILLE DE TEMPS CONFORME:
- Nom de l'employé + titre d'emploi
- Semaine visée (dimanche au samedi)
- Pour chaque journée: date, type de quart, heure d'arrivée, heure de départ, temps de repas
- Signature du représentant CIUSSS/CISSS
- Signature de l'employé de l'agence

COURRIELS:
- RH/Facturation: rh@soins-expert-plus.com
- Répartition: repartition@soins-expert-plus.com
"""

RAW_TOOLS = [
    {"name": "search_employees", "description": "Rechercher des employés par nom, poste ou email.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "get_employee_schedule", "description": "Obtenir l'horaire d'un employé pour une période donnée.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "start_date": {"type": "string"}, "end_date": {"type": "string"}}, "required": ["employee_id"]}},
    {"name": "create_schedule", "description": "Créer un quart de travail pour un employé.", "input_schema": {"type": "object", "properties": {"employee_id": {"type": "integer"}, "date": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "hours": {"type": "number"}, "location": {"type": "string"}, "billable_rate": {"type": "number"}}, "required": ["employee_id", "date", "start", "end", "hours", "location"]}},
    {"name": "read_recent_emails", "description": "Lire les courriels récents de la boîte de réception.", "input_schema": {"type": "object", "properties": {"max_results": {"type": "integer", "default": 10}, "search": {"type": "string"}, "folder": {"type": "string", "default": "INBOX"}}}},
    {"name": "send_email", "description": "Envoyer un courriel.", "input_schema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body_html": {"type": "string"}}, "required": ["to", "subject", "body_html"]}},
    {"name": "get_candidates", "description": "Obtenir la liste des candidats disponibles.", "input_schema": {"type": "object", "properties": {"title_filter": {"type": "string"}, "region_filter": {"type": "string"}}}},
    {"name": "get_invoices_summary", "description": "Obtenir un résumé de la facturation.", "input_schema": {"type": "object", "properties": {"status_filter": {"type": "string"}, "client_id": {"type": "integer"}}}},
    {"name": "get_accommodations", "description": "Obtenir la liste des hébergements actifs pour les employés.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_business_info", "description": "Obtenir les informations business.", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}}},
]
TOOLS = [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"], "strict": False} for t in RAW_TOOLS]

async def execute_tool(name: str, input_data: dict, db: AsyncSession) -> str:
    try:
        if name == "search_employees":
            query = input_data.get("query", "").lower()
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            employees = result.scalars().all()
            matches = [e for e in employees if query in e.name.lower() or query in (e.position or "").lower() or query in (e.email or "").lower()]
            if not matches:
                return f"Aucun employé trouvé pour '{query}'. {len(employees)} employés actifs au total."
            return json.dumps([{"id": e.id, "name": e.name, "position": e.position, "rate": e.rate, "email": e.email, "phone": e.phone, "client_id": e.client_id} for e in matches], ensure_ascii=False)
        if name == "get_employee_schedule":
            eid = input_data["employee_id"]
            q = select(Schedule).where(Schedule.employee_id == eid)
            if input_data.get("start_date"):
                q = q.where(Schedule.date >= input_data["start_date"])
            if input_data.get("end_date"):
                q = q.where(Schedule.date <= input_data["end_date"])
            q = q.order_by(Schedule.date, Schedule.start)
            result = await db.execute(q)
            shifts = result.scalars().all()
            total_hours = sum(s.hours for s in shifts)
            return json.dumps({"employee_id": eid, "shifts": [{"date": s.date.isoformat(), "start": s.start, "end": s.end, "hours": s.hours, "location": s.location, "rate": s.billable_rate} for s in shifts], "total_hours": total_hours, "total_shifts": len(shifts)}, ensure_ascii=False)
        if name == "create_schedule":
            from ..models.models import new_id
            emp = await db.execute(select(Employee).where(Employee.id == input_data["employee_id"]))
            emp = emp.scalar_one_or_none()
            if not emp:
                return "Employé introuvable"
            y,m,d = input_data["date"].split("-")
            sched = Schedule(id=new_id(), employee_id=input_data["employee_id"], date=date(int(y), int(m), int(d)), start=input_data["start"], end=input_data["end"], hours=input_data["hours"], location=input_data["location"], billable_rate=input_data.get("billable_rate", emp.rate or 0), status="published")
            db.add(sched)
            await db.commit()
            return f"Quart créé: {emp.name} le {input_data['date']} de {input_data['start']} à {input_data['end']} ({input_data['hours']}h) à {input_data['location']}"
        if name == "read_recent_emails":
            if not IMAP_USER or not IMAP_PASS:
                return "Configuration IMAP manquante."
            try:
                mail = imaplib.IMAP4_SSL(IMAP_HOST)
                mail.login(IMAP_USER, IMAP_PASS)
                folder = input_data.get("folder", "INBOX")
                mail.select(folder)
                search_criteria = "ALL"
                if input_data.get("search"):
                    s = input_data["search"]
                    search_criteria = f'(OR (FROM "{s}") (SUBJECT "{s}"))'
                _, msg_nums = mail.search(None, search_criteria)
                nums = msg_nums[0].split()
                max_r = input_data.get("max_results", 10)
                recent = nums[-max_r:] if len(nums) > max_r else nums
                emails = []
                for num in reversed(recent):
                    _, msg_data = mail.fetch(num, "(RFC822)")
                    msg = email_lib.message_from_bytes(msg_data[0][1])
                    subject = decode_header(msg["Subject"] or "")[0]
                    subject = subject[0].decode(subject[1] or "utf-8") if isinstance(subject[0], bytes) else str(subject[0])
                    from_addr = msg["From"] or ""
                    date_str = msg["Date"] or ""
                    body = ""
                    has_pdf = False
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == "text/plain":
                                body = part.get_payload(decode=True).decode("utf-8", errors="replace")[:500]
                            if part.get_filename() and part.get_filename().lower().endswith(".pdf"):
                                has_pdf = True
                    else:
                        body = msg.get_payload(decode=True).decode("utf-8", errors="replace")[:500]
                    emails.append({"from": from_addr, "subject": subject, "date": date_str[:25], "body_preview": body[:200], "has_pdf_attachment": has_pdf})
                mail.logout()
                return json.dumps(emails, ensure_ascii=False)
            except Exception as e:
                return f"Erreur lecture emails: {str(e)}"
        if name == "send_email":
            await _send_email(input_data["to"], input_data["subject"], input_data["body_html"])
            return f"Courriel envoyé à {input_data['to']}: {input_data['subject']}"
        if name == "get_candidates":
            return json.dumps({"note": "La liste des candidats est disponible dans l'onglet Candidats.", "suggestion": "Consultez l'onglet Candidats pour voir les candidats avec leurs disponibilités."}, ensure_ascii=False)
        if name == "get_invoices_summary":
            return json.dumps({"note": "Utilisez l'onglet Facturation pour le détail. L'agent peut résumer les statuts sur demande."}, ensure_ascii=False)
        if name == "get_accommodations":
            result = await db.execute(select(Accommodation))
            accoms = result.scalars().all()
            data = []
            for a in accoms:
                emp = await db.execute(select(Employee).where(Employee.id == a.employee_id))
                emp = emp.scalar_one_or_none()
                data.append({"employee": emp.name if emp else "?", "start": a.start_date.isoformat() if a.start_date else "", "end": a.end_date.isoformat() if a.end_date else "", "total_cost": a.total_cost, "days": a.days_worked, "cost_per_day": a.cost_per_day})
            return json.dumps(data, ensure_ascii=False)
        if name == "get_business_info":
            return BUSINESS_KNOWLEDGE
        return f"Outil '{name}' non reconnu"
    except Exception as e:
        return f"Erreur outil {name}: {str(e)}"

AGENT_FACTURATION_PROMPT = "Tu es l'Agent de Facturation de Soins Expert Plus. Utilise les outils disponibles pour la facturation, les FDT, la conciliation et les factures. Réponds toujours en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
AGENT_RECRUTEMENT_PROMPT = "Tu es l'Agent de Recrutement de Soins Expert Plus. Utilise les outils disponibles pour les besoins clients, les candidats, les horaires et les courriels. Réponds toujours en français québécois professionnel.\n\n" + BUSINESS_KNOWLEDGE
GENERAL_PROMPT = "Tu es l'assistant intelligent de Soins Expert Plus. Sois concis, professionnel et proactif. Réponds en français.\n\n" + BUSINESS_KNOWLEDGE

def _detect_prompt(message: str):
    m = message.lower()
    if any(kw in m for kw in ["factur", "fdt", "feuille de temps", "paie", "paiement", "impayé", "souffrance", "concili"]):
        return AGENT_FACTURATION_PROMPT, "facturation"
    if any(kw in m for kw in ["candidat", "recrutement", "besoin", "soumission", "disponib", "assignation", "placement"]):
        return AGENT_RECRUTEMENT_PROMPT, "recrutement"
    return GENERAL_PROMPT, "general"

def _history_to_input(history, user_message):
    items = []
    for m in history or []:
        role = m.get("role", "user")
        content = m.get("content", "")
        items.append({"role": role, "content": str(content)})
    items.append({"role": "user", "content": user_message})
    return items

def _extract_text(data):
    if data.get("output_text"):
        return data["output_text"]
    texts = []
    for item in data.get("output", []) or []:
        if item.get("type") == "message":
            for c in item.get("content", []) or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    texts.append(c["text"])
    return "\n".join(texts).strip()

@router.post("/chat")
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="Clé API OpenAI non configurée. Ajouter OPENAI_API_KEY dans les variables d'environnement Render.")
    system_prompt, agent_name = _detect_prompt(msg.message)
    inputs = _history_to_input(msg.history, msg.message)
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=90) as client:
        try:
            data = None
            for _ in range(6):
                resp = await client.post("https://api.openai.com/v1/responses", headers=headers, json={"model": OPENAI_MODEL, "instructions": system_prompt, "input": inputs, "tools": TOOLS, "parallel_tool_calls": False})
                resp.raise_for_status()
                data = resp.json()
                tool_calls = [item for item in data.get("output", []) if item.get("type") == "function_call"]
                if not tool_calls:
                    break
                inputs.extend(data.get("output", []))
                for call in tool_calls:
                    raw_args = call.get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args)
                    except Exception:
                        args = {}
                    result = await execute_tool(call.get("name", ""), args, db)
                    inputs.append({"type": "function_call_output", "call_id": call.get("call_id"), "output": result})
            return {"reply": _extract_text(data or {}) or "Je n'ai pas pu générer de réponse.", "usage": (data or {}).get("usage", {}), "agent": agent_name, "model": OPENAI_MODEL}
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Erreur API OpenAI: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
