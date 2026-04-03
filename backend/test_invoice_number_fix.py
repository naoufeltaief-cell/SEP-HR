"""
Test script to verify the invoice number generation fix.
Tests that MAX-based logic avoids duplicates even when invoices are deleted.
"""
import asyncio
import sys
import os

# Minimal test using a real SQLite in-memory DB to validate the SQL logic
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Integer, select, func

class Base(DeclarativeBase):
    pass

class FakeInvoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    number: Mapped[str] = mapped_column(String, unique=True)

class FakeCreditNote(Base):
    __tablename__ = "credit_notes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    number: Mapped[str] = mapped_column(String, unique=True)


async def generate_invoice_number_max(session: AsyncSession, prefix: str, model_cls, number_col):
    """Replicated logic from the fix."""
    suffix_start = len(prefix) + 2
    result = await session.execute(
        select(
            func.max(
                func.cast(func.substr(number_col, suffix_start), Integer)
            )
        ).where(number_col.like(f"{prefix}-%"))
    )
    max_seq = result.scalar()
    next_seq = 1 if max_seq is None else int(max_seq) + 1
    return f"{prefix}-{next_seq:04d}"


async def generate_invoice_number_count(session: AsyncSession, prefix: str, model_cls, number_col):
    """Old broken logic using COUNT."""
    result = await session.execute(
        select(func.count(model_cls.id)).where(number_col.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}-{count + 1:04d}"


async def run_tests():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False)
    results = []

    # ── Test 1: Empty database ──
    async with Session() as s:
        num = await generate_invoice_number_max(s, "SEP-202604", FakeInvoice, FakeInvoice.number)
        passed = num == "SEP-202604-0001"
        results.append(("Empty DB → first number", num, "SEP-202604-0001", passed))
        print(f"Test 1 (Empty DB): got={num}  expected=SEP-202604-0001  {'✅' if passed else '❌'}")

    # ── Test 2: Sequential generation ──
    async with Session() as s:
        for i in range(1, 9):
            s.add(FakeInvoice(id=str(i), number=f"SEP-202604-{i:04d}"))
        await s.commit()

    async with Session() as s:
        num = await generate_invoice_number_max(s, "SEP-202604", FakeInvoice, FakeInvoice.number)
        passed = num == "SEP-202604-0009"
        results.append(("8 invoices exist → next is 0009", num, "SEP-202604-0009", passed))
        print(f"Test 2 (Sequential): got={num}  expected=SEP-202604-0009  {'✅' if passed else '❌'}")

    # ── Test 3: Delete invoice #3, old logic produces DUPLICATE, new logic doesn't ──
    async with Session() as s:
        inv3 = await s.get(FakeInvoice, "3")
        await s.delete(inv3)
        await s.commit()

    async with Session() as s:
        num_old = await generate_invoice_number_count(s, "SEP-202604", FakeInvoice, FakeInvoice.number)
        num_new = await generate_invoice_number_max(s, "SEP-202604", FakeInvoice, FakeInvoice.number)
        old_dup = num_old == "SEP-202604-0008"  # COUNT=7 → 0008 which already exists!
        new_ok = num_new == "SEP-202604-0009"
        results.append(("After deleting #3 — OLD COUNT logic", num_old, "SEP-202604-0008 (DUPLICATE!)", old_dup))
        results.append(("After deleting #3 — NEW MAX logic", num_new, "SEP-202604-0009", new_ok))
        print(f"Test 3a (Old COUNT after delete): got={num_old}  (this is a DUPLICATE of existing 0008!) {'⚠️ BUG confirmed' if old_dup else ''}")
        print(f"Test 3b (New MAX after delete):   got={num_new}  expected=SEP-202604-0009  {'✅' if new_ok else '❌'}")

    # ── Test 4: Delete multiple invoices (gaps), MAX still correct ──
    async with Session() as s:
        for del_id in ["5", "6"]:
            obj = await s.get(FakeInvoice, del_id)
            if obj:
                await s.delete(obj)
        await s.commit()

    async with Session() as s:
        num = await generate_invoice_number_max(s, "SEP-202604", FakeInvoice, FakeInvoice.number)
        passed = num == "SEP-202604-0009"
        results.append(("After deleting #3,#5,#6 — MAX still 0009", num, "SEP-202604-0009", passed))
        print(f"Test 4 (Multiple deletes): got={num}  expected=SEP-202604-0009  {'✅' if passed else '❌'}")

    # ── Test 5: Month transition ──
    async with Session() as s:
        num = await generate_invoice_number_max(s, "SEP-202605", FakeInvoice, FakeInvoice.number)
        passed = num == "SEP-202605-0001"
        results.append(("New month (202605) → starts at 0001", num, "SEP-202605-0001", passed))
        print(f"Test 5 (Month transition): got={num}  expected=SEP-202605-0001  {'✅' if passed else '❌'}")

    # ── Test 6: Credit note number generation ──
    async with Session() as s:
        s.add(FakeCreditNote(id="c1", number="CN-202604-0001"))
        s.add(FakeCreditNote(id="c2", number="CN-202604-0002"))
        await s.commit()

    async with Session() as s:
        num = await generate_invoice_number_max(s, "CN-202604", FakeCreditNote, FakeCreditNote.number)
        passed = num == "CN-202604-0003"
        results.append(("Credit note next after 0002", num, "CN-202604-0003", passed))
        print(f"Test 6 (Credit notes): got={num}  expected=CN-202604-0003  {'✅' if passed else '❌'}")

    # ── Summary ──
    print("\n" + "=" * 60)
    all_pass = all(r[3] for r in results)
    print(f"{'ALL TESTS PASSED ✅' if all_pass else 'SOME TESTS FAILED ❌'}")
    print("=" * 60)

    await engine.dispose()
    return results


if __name__ == "__main__":
    results = asyncio.run(run_tests())
