"""Seed script — populate DB with initial employees, clients, and sample schedules"""
import asyncio
from app.database import engine, Base, async_session
from app.models.models import Employee, Client, Schedule, User, new_id
from app.services.auth_service import hash_password
from datetime import date


EMPLOYEES_SEED = [
    {"id": 1, "name": "Marjorie Tremblay", "position": "Infirmière", "phone": "418-555-0101", "email": "m.tremblay@email.com", "rate": 86.23},
    {"id": 2, "name": "Annie Bouchard", "position": "Infirmière auxiliaire", "phone": "418-555-0102", "email": "a.bouchard@email.com", "rate": 57.18},
    {"id": 3, "name": "Sylvie Côté", "position": "PAB", "phone": "418-555-0103", "email": "s.cote@email.com", "rate": 50.35},
    {"id": 4, "name": "Jean-François Gagnon", "position": "Infirmier", "phone": "418-555-0104", "email": "jf.gagnon@email.com", "rate": 86.23},
    {"id": 5, "name": "Isabelle Lavoie", "position": "Infirmière", "phone": "418-555-0105", "email": "i.lavoie@email.com", "rate": 86.23},
    {"id": 6, "name": "Pierre Bergeron", "position": "PAB", "phone": "418-555-0106", "email": "p.bergeron@email.com", "rate": 50.35},
    {"id": 7, "name": "Caroline Morin", "position": "Infirmière auxiliaire", "phone": "418-555-0107", "email": "c.morin@email.com", "rate": 57.18},
    {"id": 8, "name": "Nathalie Fortin", "position": "Infirmière", "phone": "418-555-0108", "email": "n.fortin@email.com", "rate": 86.23},
    {"id": 9, "name": "Marc-André Pelletier", "position": "PAB", "phone": "418-555-0109", "email": "ma.pelletier@email.com", "rate": 50.35},
    {"id": 10, "name": "Valérie Roy", "position": "Infirmière auxiliaire", "phone": "418-555-0110", "email": "v.roy@email.com", "rate": 57.18},
]

CLIENTS_SEED = [
    {"id": 1, "name": "CISSS Côte-Nord", "address": "45 rue Père-Divet, Sept-Îles, QC G4R 3N7", "email": "direction@cissscn.ca", "phone": "418-962-9761"},
    {"id": 2, "name": "CIUSSS Saguenay–Lac-Saint-Jean", "address": "930 rue Jacques-Cartier E, Chicoutimi, QC G7H 7K9", "email": "info@ciussssaglac.ca", "phone": "418-541-1000"},
    {"id": 3, "name": "Centre de Santé Inuulitsivik", "address": "Puvirnituq, QC J0M 1P0", "email": "admin@inuulitsivik.ca", "phone": "819-988-2957", "tax_exempt": True},
    {"id": 4, "name": "Conseil Cri de la santé", "address": "Chisasibi, QC J0M 1E0", "email": "admin@creehealth.org", "phone": "819-855-2844", "tax_exempt": True},
    {"id": 5, "name": "CISSS Bas-Saint-Laurent", "address": "288 rue Pierre-Saindon, Rimouski, QC G5L 9A8", "email": "info@cissbsl.ca", "phone": "418-724-5231"},
]


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        # Check if already seeded
        from sqlalchemy import select, func
        count = await db.execute(select(func.count(Employee.id)))
        if count.scalar() > 0:
            print("Database already seeded. Skipping.")
            return

        # Employees
        for e in EMPLOYEES_SEED:
            db.add(Employee(**e))

        # Clients
        for c in CLIENTS_SEED:
            db.add(Client(**c))

        # Admin user
        db.add(User(
            id=new_id(),
            email="rh@soins-expert-plus.com",
            name="Admin RH",
            password_hash=hash_password("admin2026!"),
            role="admin",
        ))

        await db.commit()
        print(f"Seeded: {len(EMPLOYEES_SEED)} employees, {len(CLIENTS_SEED)} clients, 1 admin user")
        print("Admin login: rh@soins-expert-plus.com / admin2026!")


if __name__ == "__main__":
    asyncio.run(seed())
