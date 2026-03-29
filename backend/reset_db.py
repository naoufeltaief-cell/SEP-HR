"""Reset and reseed the database - run this manually via Shell"""
import asyncio
from app.database import engine, Base, async_session
from app.models.models import Employee, Client, Schedule, User, new_id
from app.services.auth_service import hash_password
from datetime import date

async def reset_and_seed():
    # Step 1: Drop all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        print("Tables dropped")
    
    # Step 2: Recreate tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        print("Tables recreated")
    
    # Step 3: Import and run seed data
    from seed import EMPLOYEES_SEED, CLIENTS_SEED, SCHEDULES_SEED
    
    async with async_session() as db:
        # Employees
        for e in EMPLOYEES_SEED:
            db.add(Employee(**e))
        print(f"Added {len(EMPLOYEES_SEED)} employees")
        
        # Clients
        for c in CLIENTS_SEED:
            db.add(Client(**c))
        print(f"Added {len(CLIENTS_SEED)} clients")
        
        # Schedules
        for eid, d, start, end, hours, rate, loc in SCHEDULES_SEED:
            parts = d.split("-")
            db.add(Schedule(
                id=new_id(),
                employee_id=eid,
                date=date(int(parts[0]), int(parts[1]), int(parts[2])),
                start=start, end=end, hours=hours,
                billable_rate=rate, location=loc,
                status="published",
            ))
        print(f"Added {len(SCHEDULES_SEED)} schedules")
        
        # Admin user
        db.add(User(
            id=new_id(),
            email="rh@soins-expert-plus.com",
            name="Nao Taief",
            password_hash=hash_password("admin2026!"),
            role="admin",
        ))
        print("Admin: rh@soins-expert-plus.com / admin2026!")
        
        await db.commit()
        print("DONE! Database reset complete.")

if __name__ == "__main__":
    asyncio.run(reset_and_seed())
