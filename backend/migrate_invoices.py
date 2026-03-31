"""Run: python3 migrate_invoices.py"""
import asyncio, os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

SQL = [
    "DROP TABLE IF EXISTS credit_notes CASCADE",
    "DROP TABLE IF EXISTS payments CASCADE",
    "DROP TABLE IF EXISTS invoice_audit_log CASCADE",
    "DROP TABLE IF EXISTS invoices CASCADE",
    """CREATE TABLE invoices (
        id VARCHAR PRIMARY KEY, number VARCHAR UNIQUE NOT NULL, date DATE NOT NULL,
        period_start DATE NOT NULL, period_end DATE NOT NULL,
        client_id INTEGER REFERENCES clients(id), client_name VARCHAR NOT NULL DEFAULT '',
        client_address VARCHAR DEFAULT '', client_email VARCHAR DEFAULT '', client_phone VARCHAR DEFAULT '',
        employee_id INTEGER REFERENCES employees(id), employee_name VARCHAR DEFAULT '', employee_title VARCHAR DEFAULT '',
        subtotal_services FLOAT DEFAULT 0, subtotal_garde FLOAT DEFAULT 0, subtotal_rappel FLOAT DEFAULT 0,
        subtotal_accom FLOAT DEFAULT 0, subtotal_deplacement FLOAT DEFAULT 0, subtotal_km FLOAT DEFAULT 0,
        subtotal_autres_frais FLOAT DEFAULT 0, subtotal FLOAT DEFAULT 0,
        include_tax BOOLEAN DEFAULT TRUE, tps FLOAT DEFAULT 0, tvq FLOAT DEFAULT 0, total FLOAT DEFAULT 0,
        amount_paid FLOAT DEFAULT 0, balance_due FLOAT DEFAULT 0, status VARCHAR DEFAULT 'draft',
        lines JSON DEFAULT '[]', accommodation_lines JSON DEFAULT '[]', expense_lines JSON DEFAULT '[]', extra_lines JSON DEFAULT '[]',
        notes TEXT DEFAULT '', due_date DATE, po_number VARCHAR DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        validated_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, paid_at TIMESTAMPTZ
    )""",
    "CREATE INDEX ix_inv_num ON invoices(number)",
    "CREATE INDEX ix_inv_st ON invoices(status)",
    """CREATE TABLE payments (
        id VARCHAR PRIMARY KEY, invoice_id VARCHAR NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount FLOAT NOT NULL, date DATE NOT NULL, reference VARCHAR DEFAULT '',
        method VARCHAR DEFAULT 'virement', notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "CREATE INDEX ix_pay_inv ON payments(invoice_id)",
    """CREATE TABLE invoice_audit_log (
        id VARCHAR PRIMARY KEY, invoice_id VARCHAR NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        action VARCHAR NOT NULL, old_status VARCHAR, new_status VARCHAR,
        user_id INTEGER, user_email VARCHAR DEFAULT '', details TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "CREATE INDEX ix_aud_inv ON invoice_audit_log(invoice_id)",
    """CREATE TABLE credit_notes (
        id VARCHAR PRIMARY KEY, number VARCHAR UNIQUE NOT NULL,
        invoice_id VARCHAR REFERENCES invoices(id) ON DELETE SET NULL, invoice_number VARCHAR DEFAULT '',
        client_id INTEGER REFERENCES clients(id), client_name VARCHAR DEFAULT '',
        date DATE NOT NULL, reason TEXT NOT NULL, amount FLOAT NOT NULL,
        include_tax BOOLEAN DEFAULT TRUE, tps FLOAT DEFAULT 0, tvq FLOAT DEFAULT 0, total FLOAT DEFAULT 0,
        status VARCHAR DEFAULT 'active', notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "CREATE INDEX ix_cn_num ON credit_notes(number)",
]

async def migrate():
    url = os.environ["DATABASE_URL"].replace("postgres://", "postgresql+asyncpg://")
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        for i, sql in enumerate(SQL):
            await conn.execute(text(sql))
            print(f"  OK [{i+1}/{len(SQL)}]")
    print("\nMigration complete - 4 tables created: invoices, payments, invoice_audit_log, credit_notes")

asyncio.run(migrate())
