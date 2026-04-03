### Deployment Summary — 2026-04-03

#### Commits Pushed to `main`

| # | Commit | Description |
|---|--------|-------------|
| 1 | `05c0436` | **Invoice regeneration error handling & deletion** — Proper error messages on regeneration failure; allow deletion of validated invoices; fix route conflicts between `invoices.py` and `invoices_bulk.py`; add savepoint-based transaction management for bulk generation |
| 2 | `9b48b9f` | **Schedule ↔ Invoice synchronization** — Added `schedule_id` to invoice line schemas; invoice edits now propagate back to schedule records (hours, km, déplacement, autre) via `_sync_invoice_to_schedules()` |
| 3 | `37c540b` | **Travel/displacement labels & accommodation editing** — Déplacement fields now show "(h)" to clarify they represent hours; full CRUD for accommodation lines in both `InvoiceEditModal` and inline edit modal on `InvoicesPage` |

#### Files Modified

| Area | Files |
|------|-------|
| Backend — Routers | `invoices.py`, `invoices_approved.py`, `invoices_bulk.py` |
| Backend — Services | `invoice_service.py` |
| Backend — Schemas | `schemas_invoice.py` |
| Frontend — Pages | `SchedulesPage.jsx`, `InvoicesPage.jsx` |
| Frontend — Components | `InvoiceEditModal.jsx` |

#### Issues Resolved

1. ✅ Invoice regeneration shows proper error messages instead of silent failures
2. ✅ Validated invoices can now be deleted (previously only draft)
3. ✅ Bidirectional schedule ↔ invoice synchronization
4. ✅ Travel/displacement fields clearly labeled as hours
5. ✅ Accommodation lines editable within invoice edit modals

#### Push Result

```
To https://github.com/naoufeltaief-cell/SEP-HR.git
   0664841..37c540b  main -> main
```

3 commits pushed successfully to `origin/main`.
