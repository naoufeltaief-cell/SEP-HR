# Fix Report — Schedule ↔ Invoice Synchronization

## Problem

When editing an invoice in the **Détails → onglet Facturation** view (modifying shifts or adding expenses), the underlying **schedule records** were **not updated**, creating a data discrepancy between invoices and schedules.

### Root Cause

Invoice generation is a **one-way denormalization**: Schedule → Invoice.  
At generation time, schedule data (hours, start/end, pause, km, deplacement, etc.) is copied into JSON arrays on the Invoice model (`lines`, `expense_lines`). However, **no back-link** was stored, and **no sync logic** existed to push changes back to the source Schedule records when invoice lines were edited.

## Solution

### 1. Added `schedule_id` to invoice line items

**Files modified:**
- `backend/app/models/schemas_invoice.py` — Added `schedule_id: Optional[str] = None` to `InvoiceServiceLine` and `InvoiceExpenseLine` Pydantic schemas.

This creates a traceable link from each invoice line back to its source Schedule record.

### 2. Store `schedule_id` during invoice generation

**Files modified:**
- `backend/app/routers/invoices_approved.py` — Added `'schedule_id': s.id` to each service line and expense line dict during approved invoice generation.
- `backend/app/services/invoice_service.py` — Added `"schedule_id": s.id` to each service line and expense line dict in `generate_invoices_from_timesheets()`.

Both invoice generation paths now tag every line with its source schedule ID.

### 3. Added sync-back logic on invoice update

**File modified:**
- `backend/app/routers/invoices.py` — Added `_sync_invoice_to_schedules()` helper function, called from `update_invoice()` after `recalculate_invoice()`.

The sync function:
1. Collects all `schedule_id` references from service lines and expense lines
2. Fetches the corresponding Schedule records in a single query
3. For each referenced schedule:
   - **Service line fields synced**: `start`, `end`, `pause`, `hours`, `garde_hours`, `rappel_hours`
   - **Expense fields synced**: `km`, `deplacement`, `autre_dep` (aggregated per schedule)
4. If expense lines were removed from the invoice, the schedule's expense fields are reset to 0
5. Lines without `schedule_id` (manually added) are silently skipped

### Backward Compatibility

- **Existing invoices**: Invoices generated before this fix have lines without `schedule_id`. The sync function silently skips these — no errors, no data loss.
- **Frontend**: The edit modal uses `{ ...l, ... }` spread syntax which automatically preserves the `schedule_id` field through edits. New manually-added lines correctly omit `schedule_id`.
- **Future invoices**: All newly generated invoices will carry `schedule_id` in their lines, enabling full bidirectional sync.

## Files Modified

| File | Change |
|------|--------|
| `backend/app/models/schemas_invoice.py` | Added `schedule_id` to `InvoiceServiceLine` and `InvoiceExpenseLine` |
| `backend/app/routers/invoices_approved.py` | Store `schedule_id: s.id` in service/expense lines |
| `backend/app/services/invoice_service.py` | Store `schedule_id: s.id` in service/expense lines |
| `backend/app/routers/invoices.py` | Added `_sync_invoice_to_schedules()` + call from `update_invoice()` |

## Testing Checklist

- [ ] Edit an invoice's service line hours → verify the corresponding schedule's hours updated
- [ ] Edit an invoice's start/end time → verify schedule's start/end updated
- [ ] Add an expense line (km) to invoice → verify schedule's km field updated
- [ ] Remove an expense line → verify schedule's km/deplacement reset to 0
- [ ] Edit a manually-added line (no schedule_id) → verify no errors
- [ ] Generate a new invoice → verify all lines contain schedule_id
- [ ] Verify the Horaires (schedule) view reflects changes made in Facturation
