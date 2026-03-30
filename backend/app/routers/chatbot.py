"""
Soins Expert Plus — Dual Agent System
Agent 1: Facturation (FDT monitoring, invoice drafts, email reconciliation)
Agent 2: Recrutement (client needs, candidate suggestions, scheduling, email responses)
Both use Claude with tool-use for intelligent actions.
"""
import os
import json
import httpx
import imaplib
import email as email_lib
from email.header import decode_header
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from ..database import get_db
from ..models.models import Employee, Schedule, Timesheet, Invoice, Client, Accommodation
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin
from ..services.email_service import _send_email

router = APIRouter()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-4-20250514"

# Gmail IMAP config
IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_USER = os.getenv("IMAP_USER", os.getenv("SMTP_USER", ""))
IMAP_PASS = os.getenv("IMAP_PASS", os.getenv("SMTP_PASS", ""))

# ══════════════════════════════════════════
# BUSINESS KNOWLEDGE BASE
# ══════════════════════════════════════════
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


# ══════════════════════════════════════════
# TOOL DEFINITIONS
# ══════════════════════════════════════════
TOOLS = [
    {
        "name": "search_employees",
        "description": "Rechercher des employés par nom, poste ou email. Retourne les infos complètes incluant taux horaire, client assigné, heures travaillées.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Nom, poste ou email à chercher"},
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_employee_schedule",
        "description": "Obtenir l'horaire d'un employé pour une période donnée.",
        "input_schema": {
            "type": "object",
            "properties": {
                "employee_id": {"type": "integer"},
                "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD"},
            },
            "required": ["employee_id"]
        }
    },
    {
        "name": "create_schedule",
        "description": "Créer un ou plusieurs quarts de travail pour un employé. Utiliser pour planifier des horaires.",
        "input_schema": {
            "type": "object",
            "properties": {
                "employee_id": {"type": "integer"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "start": {"type": "string", "description": "HH:MM"},
                "end": {"type": "string", "description": "HH:MM"},
                "hours": {"type": "number"},
                "location": {"type": "string"},
                "billable_rate": {"type": "number"},
            },
            "required": ["employee_id", "date", "start", "end", "hours", "location"]
        }
    },
    {
        "name": "read_recent_emails",
        "description": "Lire les courriels récents de la boîte de réception. Peut filtrer par expéditeur ou sujet. Utile pour trouver les FDT envoyées par les employés ou les besoins des clients.",
        "input_schema": {
            "type": "object",
            "properties": {
                "max_results": {"type": "integer", "default": 10},
                "search": {"type": "string", "description": "Terme de recherche (expéditeur, sujet, contenu)"},
                "folder": {"type": "string", "default": "INBOX"},
            },
        }
    },
    {
        "name": "send_email",
        "description": "Envoyer un courriel à un employé, un client ou un candidat. Toujours confirmer avec l'admin avant d'envoyer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Adresse email du destinataire"},
                "subject": {"type": "string"},
                "body_html": {"type": "string", "description": "Contenu HTML du courriel"},
            },
            "required": ["to", "subject", "body_html"]
        }
    },
    {
        "name": "get_candidates",
        "description": "Obtenir la liste des candidats disponibles pour soumission, avec filtres optionnels par titre d'emploi ou région.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title_filter": {"type": "string", "description": "Filtrer par titre d'emploi (ex: Infirmier)"},
                "region_filter": {"type": "string", "description": "Filtrer par région"},
            },
        }
    },
    {
        "name": "get_invoices_summary",
        "description": "Obtenir un résumé de la facturation: factures impayées, en retard, totaux par client.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status_filter": {"type": "string", "description": "Filtrer par statut: draft, sent, paid, overdue"},
                "client_id": {"type": "integer", "description": "Filtrer par client"},
            },
        }
    },
    {
        "name": "get_accommodations",
        "description": "Obtenir la liste des hébergements actifs pour les employés.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_business_info",
        "description": "Obtenir les informations business: taux horaires, calendrier de paie, règles de facturation, tarifs de déplacement, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Sujet: taux, paie, deplacement, hebergement, garde, taxes, fdt"},
            },
        }
    },
]


# ══════════════════════════════════════════
# TOOL IMPLEMENTATIONS
# ══════════════════════════════════════════
async def execute_tool(name: str, input_data: dict, db: AsyncSession) -> str:
    """Execute a tool and return the result as a string."""
    try:
        if name == "search_employees":
            query = input_data.get("query", "").lower()
            result = await db.execute(select(Employee).where(Employee.is_active == True))
            employees = result.scalars().all()
            matches = [e for e in employees if query in e.name.lower() or query in (e.position or "").lower() or query in (e.email or "").lower()]
            if not matches:
                return f"Aucun employé trouvé pour '{query}'. {len(employees)} employés actifs au total."
            return json.dumps([{"id": e.id, "name": e.name, "position": e.position, "rate": e.rate, "email": e.email, "phone": e.phone, "client_id": e.client_id} for e in matches], ensure_ascii=False)

        elif name == "get_employee_schedule":
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
            return json.dumps({
                "employee_id": eid,
                "shifts": [{"date": s.date.isoformat(), "start": s.start, "end": s.end, "hours": s.hours, "location": s.location, "rate": s.billable_rate} for s in shifts],
                "total_hours": total_hours,
                "total_shifts": len(shifts),
            }, ensure_ascii=False)

        elif name == "create_schedule":
            from ..models.models import new_id
            emp = await db.execute(select(Employee).where(Employee.id == input_data["employee_id"]))
            emp = emp.scalar_one_or_none()
            if not emp:
                return "Employé introuvable"
            parts = input_data["date"].split("-")
            sched = Schedule(
                id=new_id(), employee_id=input_data["employee_id"],
                date=date(int(parts[0]), int(parts[1]), int(parts[2])),
                start=input_data["start"], end=input_data["end"],
                hours=input_data["hours"], location=input_data["location"],
                billable_rate=input_data.get("billable_rate", emp.rate or 0),
                status="published",
            )
            db.add(sched)
            await db.commit()
            return f"Quart créé: {emp.name} le {input_data['date']} de {input_data['start']} à {input_data['end']} ({input_data['hours']}h) à {input_data['location']}"

        elif name == "read_recent_emails":
            if not IMAP_USER or not IMAP_PASS:
                return "Configuration IMAP manquante. Configurer IMAP_USER et IMAP_PASS (ou SMTP_USER/SMTP_PASS) dans les variables d'environnement Render."
            try:
                mail = imaplib.IMAP4_SSL(IMAP_HOST)
                mail.login(IMAP_USER, IMAP_PASS)
                folder = input_data.get("folder", "INBOX")
                mail.select(folder)
                search_criteria = "ALL"
                if input_data.get("search"):
                    search_criteria = f'(OR (FROM "{input_data["search"]}") (SUBJECT "{input_data["search"]}"))'
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

        elif name == "send_email":
            to = input_data["to"]
            subject = input_data["subject"]
            body = input_data["body_html"]
            await _send_email(to, subject, body)
            return f"Courriel envoyé à {to}: {subject}"

        elif name == "get_candidates":
            # Return from the static candidates data (loaded from CSV)
            # In production, this would query a candidates table
            return json.dumps({
                "note": "La liste des candidats est disponible dans l'onglet Candidats de la plateforme. Utilisez les filtres par titre et région pour trouver les candidats disponibles.",
                "suggestion": "Consultez l'onglet Candidats pour voir les 80+ candidats avec leurs disponibilités, régions et coordonnées."
            }, ensure_ascii=False)

        elif name == "get_invoices_summary":
            q = select(Invoice)
            result = await db.execute(q)
            invoices = result.scalars().all()
            today = datetime.now().date()
            summary = {
                "total_invoices": len(invoices),
                "total_revenue": sum(i.total for i in invoices),
                "paid": sum(i.total for i in invoices if i.status == "paid"),
                "unpaid": sum(i.total for i in invoices if i.status != "paid"),
                "overdue": [],
            }
            for inv in invoices:
                if inv.status != "paid" and inv.date:
                    days = (today - inv.date).days
                    if days > 30:
                        cl = await db.execute(select(Client).where(Client.id == inv.client_id)) if inv.client_id else None
                        cl_name = cl.scalar_one_or_none().name if cl else inv.client_name
                        summary["overdue"].append({
                            "number": inv.number, "total": inv.total,
                            "date": inv.date.isoformat(), "days_overdue": days - 30,
                            "client": cl_name or "?"
                        })
            return json.dumps(summary, ensure_ascii=False)

        elif name == "get_accommodations":
            result = await db.execute(select(Accommodation))
            accoms = result.scalars().all()
            data = []
            for a in accoms:
                emp = await db.execute(select(Employee).where(Employee.id == a.employee_id))
                emp = emp.scalar_one_or_none()
                data.append({
                    "employee": emp.name if emp else "?",
                    "start": a.start_date.isoformat() if a.start_date else "",
                    "end": a.end_date.isoformat() if a.end_date else "",
                    "total_cost": a.total_cost, "days": a.days_worked,
                    "cost_per_day": a.cost_per_day,
                })
            return json.dumps(data, ensure_ascii=False)

        elif name == "get_business_info":
            return BUSINESS_KNOWLEDGE

        return f"Outil '{name}' non reconnu"
    except Exception as e:
        return f"Erreur outil {name}: {str(e)}"


# ══════════════════════════════════════════
# AGENT SYSTEM PROMPTS
# ══════════════════════════════════════════
AGENT_FACTURATION_PROMPT = """Tu es l'Agent de Facturation de Soins Expert Plus, une agence de placement en santé au Québec.

TON RÔLE:
- Surveiller les courriels entrants pour détecter les feuilles de temps (FDT) envoyées par les employés
- Matcher les courriels avec les employés dans le système (par adresse email)
- Concilier les FDT reçues avec les horaires planifiés dans Evolia
- Générer des brouillons de factures par période (Dimanche au Samedi)
- Calculer automatiquement les heures, garde, rappel, hébergement, déplacement, kilométrage
- Alerter sur les écarts entre FDT et horaires planifiés
- Répondre aux questions sur la facturation, les taux, le calendrier de paie

RÈGLES DE FACTURATION:
""" + BUSINESS_KNOWLEDGE + """

PROCESSUS DE FACTURATION:
1. Recevoir la FDT par courriel (PDF signé par l'employé + CIUSSS)
2. Vérifier la conformité (signatures, dates, heures)
3. Comparer avec les horaires planifiés dans le système
4. Calculer: services + garde (8h=1h) + hébergement (coût/jour × jours) + déplacement + km
5. Appliquer les taxes (sauf clients exemptés)
6. Générer le brouillon pour validation

Utilise les outils disponibles pour accéder aux données en temps réel. Sois proactif et précis.
Réponds toujours en français québécois professionnel."""

AGENT_RECRUTEMENT_PROMPT = """Tu es l'Agent de Recrutement de Soins Expert Plus, une agence de placement en santé au Québec.

TON RÔLE:
- Lire et résumer les besoins de clients reçus par courriel
- Suggérer des candidats disponibles en fonction de leur titre d'emploi, disponibilité et région
- Créer des horaires pour les candidats sélectionnés
- Envoyer des courriels aux candidats pour leur proposer des assignations
- Répondre aux questions répétitives (calendrier de paie, taux horaires, tarifs de déplacement)
- Préparer des soumissions pour les clients

CONNAISSANCES:
""" + BUSINESS_KNOWLEDGE + """

PROCESSUS DE RECRUTEMENT:
1. Client envoie un besoin (email ou appel) → résumer le besoin
2. Chercher des candidats disponibles (onglet Candidats) par titre et région
3. Proposer les meilleurs candidats au gestionnaire
4. Si approuvé: créer l'horaire + envoyer confirmation au candidat par courriel
5. Suivi: s'assurer que le candidat confirme sa disponibilité

Utilise les outils pour chercher des employés, lire des courriels, créer des horaires et envoyer des courriels.
Toujours demander confirmation avant d'envoyer un courriel ou de créer un horaire.
Réponds en français québécois professionnel."""

GENERAL_PROMPT = """Tu es l'assistant intelligent de Soins Expert Plus, une agence de placement en santé au Québec (9437-7827 Québec Inc. / Gestion Taief Inc.).

Tu peux:
1. Répondre aux questions sur la facturation, les taux, la paie
2. Chercher des employés et voir leurs horaires
3. Lire les courriels récents
4. Envoyer des courriels
5. Créer des quarts de travail
6. Voir le résumé de facturation
7. Suggérer des candidats

""" + BUSINESS_KNOWLEDGE + """

Sois concis, professionnel et proactif. Réponds en français."""


# ══════════════════════════════════════════
# MAIN CHAT ENDPOINT
# ══════════════════════════════════════════
@router.post("/chat")
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Clé API Anthropic non configurée. Ajouter ANTHROPIC_API_KEY dans les variables d'environnement Render.")

    # Detect agent mode from message
    message_lower = msg.message.lower()
    if any(kw in message_lower for kw in ["factur", "fdt", "feuille de temps", "paie", "paiement", "impayé", "souffrance", "concili"]):
        system_prompt = AGENT_FACTURATION_PROMPT
    elif any(kw in message_lower for kw in ["candidat", "recrutement", "besoin", "soumission", "disponib", "assignation", "placement"]):
        system_prompt = AGENT_RECRUTEMENT_PROMPT
    else:
        system_prompt = GENERAL_PROMPT

    messages = msg.history + [{"role": "user", "content": msg.message}]

    # Call Claude with tools
    async with httpx.AsyncClient(timeout=90) as client:
        try:
            # Initial call with tools
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": messages,
                    "tools": TOOLS,
                },
            )
            resp.raise_for_status()
            data = resp.json()

            # Handle tool use loop (max 5 iterations)
            iterations = 0
            while data.get("stop_reason") == "tool_use" and iterations < 5:
                iterations += 1
                tool_results = []
                assistant_content = data.get("content", [])

                for block in assistant_content:
                    if block.get("type") == "tool_use":
                        tool_name = block["name"]
                        tool_input = block.get("input", {})
                        result = await execute_tool(tool_name, tool_input, db)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block["id"],
                            "content": result,
                        })

                # Continue conversation with tool results
                messages.append({"role": "assistant", "content": assistant_content})
                messages.append({"role": "user", "content": tool_results})

                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": CLAUDE_MODEL,
                        "max_tokens": 4096,
                        "system": system_prompt,
                        "messages": messages,
                        "tools": TOOLS,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            # Extract final text response
            reply = "".join(
                block["text"] for block in data.get("content", []) if block.get("type") == "text"
            )
            return {"reply": reply, "usage": data.get("usage", {}), "agent": "facturation" if system_prompt == AGENT_FACTURATION_PROMPT else "recrutement" if system_prompt == AGENT_RECRUTEMENT_PROMPT else "general"}

        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Erreur API Claude: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
