"""Chatbot route — Claude Sonnet integration with full platform context"""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models.models import Employee, Schedule, Timesheet, Invoice
from ..models.schemas import ChatMessage
from ..services.auth_service import require_admin

router = APIRouter()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-4-20250514"

SYSTEM_PROMPT = """Tu es l'assistant intelligent de Soins Expert Plus, une agence de placement en santé au Québec (9437-7827 Québec Inc. / Gestion Taief Inc.).

Tu as accès aux données de la plateforme en temps réel. Voici ce que tu sais faire:

1. **Horaires**: Ajouter, modifier, supprimer des quarts. Ex: "Ajoute Marjorie à Forestville du lundi au vendredi, 7h-15h"
2. **Employés**: Chercher des infos, voir les heures travaillées. Ex: "Combien d'heures a fait Annie ce mois-ci?"
3. **Facturation**: Générer des factures, voir les totaux. Ex: "Génère la facture de la semaine pour Sept-Îles"
4. **Vérification FDT**: Comparer les feuilles de temps vs horaires planifiés.
5. **Résumés**: Donner des résumés d'activité, statistiques, alertes.

Règles:
- Réponds toujours en français québécois professionnel
- Sois concis et direct
- Si tu dois modifier des données, confirme avant d'agir
- Utilise les taux: infirmière 86.23$/h, inf. auxiliaire 57.18$/h, PAB 50.35$/h
- Garde: 8h de garde = 1h facturable au taux de 86.23$/h
- Kilométrage: 0.525$/km
- TPS 5%, TVQ 9.975%

DONNÉES ACTUELLES DE LA PLATEFORME:
{context}
"""


async def get_platform_context(db: AsyncSession) -> str:
    """Build a context string with current platform data"""
    # Employees
    emp_result = await db.execute(select(Employee).where(Employee.is_active == True))
    employees = emp_result.scalars().all()
    emp_lines = [f"- {e.name} (ID:{e.id}, {e.position}, {e.rate}$/h)" for e in employees]

    # Recent schedules
    sched_result = await db.execute(
        select(Schedule).order_by(Schedule.date.desc()).limit(50)
    )
    schedules = sched_result.scalars().all()
    sched_summary = {}
    for s in schedules:
        key = f"{s.employee_id}"
        if key not in sched_summary:
            sched_summary[key] = {"hours": 0, "shifts": 0}
        sched_summary[key]["hours"] += s.hours
        sched_summary[key]["shifts"] += 1

    # Invoice stats
    inv_result = await db.execute(select(Invoice))
    invoices = inv_result.scalars().all()
    total_invoiced = sum(i.total for i in invoices)
    unpaid = [i for i in invoices if i.status != "paid"]

    context = f"""
EMPLOYÉS ({len(employees)}):
{chr(10).join(emp_lines)}

HORAIRES RÉCENTS: {len(schedules)} quarts chargés
{chr(10).join(f"- Employé {k}: {v['shifts']} quarts, {v['hours']}h total" for k, v in sched_summary.items())}

FACTURATION: {len(invoices)} factures, total {total_invoiced:.2f}$
Impayées: {len(unpaid)}
"""
    return context


@router.post("/chat")
async def chat(msg: ChatMessage, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Clé API Anthropic non configurée")

    context = await get_platform_context(db)
    system = SYSTEM_PROMPT.format(context=context)

    messages = msg.history + [{"role": "user", "content": msg.message}]

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 2048,
                    "system": system,
                    "messages": messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            reply = "".join(
                block["text"] for block in data.get("content", []) if block.get("type") == "text"
            )
            return {"reply": reply, "usage": data.get("usage", {})}
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Erreur API Claude: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
