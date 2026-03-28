"""Invoice routes — create, update, preview, mark paid"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models.models import Invoice, Client, new_id
from ..models.schemas import InvoiceCreate, InvoiceUpdate
from ..services.auth_service import require_admin

router = APIRouter()

TPS_RATE = 0.05
TVQ_RATE = 0.09975
GARDE_RATE = 86.23
RATE_KM = 0.525


def calc_invoice_totals(inv: Invoice):
    """Recalculate subtotals, taxes, total from lines"""
    lines = inv.lines or []
    frais = inv.frais_additionnels or []
    accom = inv.accommodation_lines or []

    st_services = sum(l.get("serviceAmt", l.get("lineTotal", l.get("amount", 0))) for l in lines)
    st_garde = sum(l.get("gardeAmt", 0) for l in lines)
    st_rappel = sum(l.get("rappelAmt", 0) for l in lines)
    st_accom = sum(a.get("billedAmount", 0) for a in accom)
    st_frais = 0
    for f in frais:
        if f.get("type") == "deplacement":
            st_frais += (f.get("km", 0) * RATE_KM)
        else:
            st_frais += f.get("amount", 0)

    sub = st_services + st_garde + st_rappel + st_accom + st_frais
    tps = round(sub * TPS_RATE, 2) if inv.include_tax else 0
    tvq = round(sub * TVQ_RATE, 2) if inv.include_tax else 0
    total = round(sub + tps + tvq, 2)

    inv.subtotal_services = round(st_services, 2)
    inv.subtotal_garde = round(st_garde, 2)
    inv.subtotal_rappel = round(st_rappel, 2)
    inv.subtotal_accom = round(st_accom, 2)
    inv.subtotal_frais = round(st_frais, 2)
    inv.subtotal = round(sub, 2)
    inv.tps = tps
    inv.tvq = tvq
    inv.total = total


@router.get("/")
async def list_invoices(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Invoice).order_by(Invoice.created_at.desc()))
    return result.scalars().all()


@router.get("/{iid}")
async def get_invoice(iid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Invoice).where(Invoice.id == iid))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    return inv


@router.post("/", status_code=201)
async def create_invoice(data: InvoiceCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    # Resolve client info
    client_name = client_address = client_email = client_phone = ""
    if data.client_id:
        cr = await db.execute(select(Client).where(Client.id == data.client_id))
        client = cr.scalar_one_or_none()
        if client:
            client_name = client.name
            client_address = client.address
            client_email = client.email
            client_phone = client.phone

    inv = Invoice(
        id=new_id(), number=data.number, date=data.date,
        period_start=data.period_start, period_end=data.period_end,
        client_id=data.client_id, client_name=client_name,
        client_address=client_address, client_email=client_email, client_phone=client_phone,
        include_tax=data.include_tax, status=data.status, notes=data.notes,
        lines=data.lines, accommodation_lines=data.accommodation_lines,
        frais_additionnels=data.frais_additionnels,
    )
    calc_invoice_totals(inv)
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.put("/{iid}")
async def update_invoice(iid: str, data: InvoiceUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Invoice).where(Invoice.id == iid))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    if inv.status == "paid":
        raise HTTPException(status_code=400, detail="Impossible de modifier une facture payée")

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(inv, k, v)

    # Resolve client if changed
    if data.client_id is not None:
        cr = await db.execute(select(Client).where(Client.id == data.client_id))
        client = cr.scalar_one_or_none()
        if client:
            inv.client_name = client.name
            inv.client_address = client.address
            inv.client_email = client.email
            inv.client_phone = client.phone

    calc_invoice_totals(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.put("/{iid}/paid")
async def mark_paid(iid: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(Invoice).where(Invoice.id == iid))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    inv.status = "paid"
    await db.commit()
    return {"message": "Facture marquée payée"}


@router.get("/next-number")
async def next_invoice_number(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    result = await db.execute(select(func.count(Invoice.id)))
    count = result.scalar() or 0
    return {"number": f"GTI-2026-{str(count + 1).zfill(3)}"}
