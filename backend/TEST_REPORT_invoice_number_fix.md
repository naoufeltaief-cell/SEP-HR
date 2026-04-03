# Test Report — Invoice Number Duplicate Fix

**Date:** 2026-04-03  
**File Modified:** `backend/app/services/invoice_service.py`  
**Functions Fixed:** `generate_invoice_number()`, `generate_credit_note_number()`

---

### Root Cause

Both functions used `COUNT(*)` to determine the next sequence number:

```python
# OLD (broken)
result = await db.execute(select(func.count(Invoice.id)).where(Invoice.number.like(f"{prefix}%")))
count = result.scalar() or 0
return f"{prefix}-{count + 1:04d}"
```

When an invoice is deleted, `COUNT` decreases, causing the next generated number to collide with an existing one.

**Example:** Invoices 0001–0008 exist. Delete #3 → COUNT=7 → next = 0008 → **DUPLICATE ERROR**.

### Fix Applied

Replaced `COUNT` with `MAX` on the extracted numeric suffix:

```python
# NEW (fixed)
result = await db.execute(
    select(func.max(func.cast(func.substr(Invoice.number, suffix_start), Integer)))
    .where(Invoice.number.like(f"{prefix}-%"))
)
max_seq = result.scalar()
next_seq = 1 if max_seq is None else int(max_seq) + 1
```

This always increments from the highest existing sequence, regardless of gaps from deletions.

### Test Results

| # | Scenario | Expected | Got | Status |
|---|----------|----------|-----|--------|
| 1 | Empty database | SEP-202604-0001 | SEP-202604-0001 | ✅ |
| 2 | 8 invoices exist sequentially | SEP-202604-0009 | SEP-202604-0009 | ✅ |
| 3a | After deleting #3 — OLD COUNT logic | SEP-202604-0008 (DUPLICATE!) | SEP-202604-0008 | ⚠️ Bug confirmed |
| 3b | After deleting #3 — NEW MAX logic | SEP-202604-0009 | SEP-202604-0009 | ✅ |
| 4 | After deleting #3, #5, #6 (multiple gaps) | SEP-202604-0009 | SEP-202604-0009 | ✅ |
| 5 | New month (202605) starts fresh | SEP-202605-0001 | SEP-202605-0001 | ✅ |
| 6 | Credit note generation (CN- prefix) | CN-202604-0003 | CN-202604-0003 | ✅ |

**Result: ALL TESTS PASSED ✅**

### Additional Changes
- Added `Integer` import from SQLAlchemy
- Added logging to both functions for traceability
- Same fix applied to `generate_credit_note_number()` which had the identical bug
