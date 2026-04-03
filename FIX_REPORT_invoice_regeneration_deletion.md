# Fix Report: Invoice Regeneration & Deletion Issues

**Date:** 2026-04-03  
**Author:** DeepAgent  

---

## Summary

This report documents four interrelated fixes addressing invoice regeneration error masking, deletion restrictions, route conflicts, and transaction management issues.

---

## Fix 1: Frontend Error Handling (SchedulesPage.jsx)

### Problem
The frontend error handler in `generateInvoice()` and `generateAllApproved()` used a broad check `msg.includes('fetch')` to detect network errors. This incorrectly classified legitimate HTTP 400 backend error messages (like "Une facture existe déjà pour cet employé/client/période") as network failures, displaying the generic "Impossible de joindre le serveur" instead of the actual error.

### Root Cause
The backend correctly returns HTTP 400 with a descriptive error message. The `apiFetch` utility throws an `Error` with the backend message. However, the word "fetch" could appear in unrelated error messages, triggering the wrong code path.

### Fix
Replaced `msg.includes('fetch')` with exact string matching against the three known browser network error messages:
- `'Failed to fetch'` (Chrome/Edge)
- `'NetworkError when attempting to fetch resource.'` (Firefox)
- `'Load failed'` (Safari)

### Files Changed
- `frontend/src/pages/SchedulesPage.jsx` (lines 114-115)

### Before
```javascript
toast?.('Erreur: ' + (msg.includes('fetch') ? 'Impossible de joindre le serveur.' : msg));
```

### After
```javascript
const isNetworkError = msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.' || msg === 'Load failed';
toast?.('Erreur: ' + (isNetworkError ? 'Impossible de joindre le serveur.' : (msg || 'Erreur réseau')));
```

---

## Fix 2: Invoice Deletion Restrictions (invoices.py, invoices_bulk.py)

### Problem
Invoices generated from approved schedules are created with status `validated`. However, the deletion endpoints only allowed deletion of `draft` or `cancelled` invoices, making it impossible to delete approved invoices even when needed.

### Fix
Added `validated` to the list of deletable statuses across all deletion endpoints:
- Single delete: `DELETE /api/invoices/{invoice_id}`
- Bulk delete: `POST /api/invoices/bulk/delete` and `POST /api/invoices/bulk-delete`

Also added proper logging for all deletion operations.

### Files Changed
- `backend/app/routers/invoices.py` (single delete endpoint)
- `backend/app/routers/invoices_bulk.py` (bulk delete endpoint)
- `frontend/src/pages/InvoicesPage.jsx` (delete button visibility and confirmation text)

### Deletable Statuses
| Status | Before | After |
|--------|--------|-------|
| draft | ✅ | ✅ |
| validated | ❌ | ✅ |
| cancelled | ✅ | ✅ |
| sent | ❌ | ❌ |
| partially_paid | ❌ | ❌ |
| paid | ❌ | ❌ |

---

## Fix 3: Route Conflicts (invoices.py → invoices_bulk.py)

### Problem
Both `invoices.py` and `invoices_bulk.py` were mounted at the same `/api/invoices` prefix in `main.py` and defined identical endpoints:
- `POST /bulk/delete` / `POST /bulk-delete`
- `POST /bulk/validate`
- `POST /bulk/send`

This caused duplicate route registrations in FastAPI, leading to unpredictable routing behavior.

### Fix
Removed all bulk action endpoints from `invoices.py` (replaced with a comment noting they moved to `invoices_bulk.py`). The `invoices_bulk.py` file is now the single source of truth for all bulk operations.

### Files Changed
- `backend/app/routers/invoices.py` — Removed ~100 lines of duplicate bulk endpoints
- `backend/app/routers/invoices_bulk.py` — Added `/bulk/delete` alias alongside existing `/bulk-delete`

### Route Registry (After Fix)
| Endpoint | Defined In |
|----------|-----------|
| `POST /api/invoices/bulk/delete` | invoices_bulk.py |
| `POST /api/invoices/bulk-delete` | invoices_bulk.py |
| `POST /api/invoices/bulk/validate` | invoices_bulk.py |
| `POST /api/invoices/bulk/send` | invoices_bulk.py |
| `POST /api/invoices/credit-notes/bulk-delete` | invoices_bulk.py |
| `POST /api/invoices/anomalies/bulk-delete` | invoices_bulk.py |
| `DELETE /api/invoices/{invoice_id}` | invoices.py |

---

## Fix 4: Transaction Management (invoices_approved.py)

### Problem
`generate_all_approved_schedules()` called `generate_invoice_from_approved_schedules()` in a loop. The inner function called `db.commit()`, permanently persisting data. When a subsequent iteration failed, the outer function called `db.rollback()`, which was ineffective since the transaction was already committed. This could also leave the SQLAlchemy session in an inconsistent state.

### Fix
1. **Extracted core logic** into `_create_invoice_from_approved(data, db, user, auto_commit=True)`:
   - When `auto_commit=True` (single endpoint): commits and refreshes as before
   - When `auto_commit=False` (bulk loop): only flushes, letting the caller manage transactions

2. **Replaced `db.rollback()` with savepoints** using `db.begin_nested()`:
   - Each iteration gets its own savepoint
   - On failure: `nested.rollback()` rolls back only that savepoint, leaving the session clean
   - On success: `nested.commit()` releases the savepoint
   - After the loop: a single `db.commit()` persists all successful invoices

### Files Changed
- `backend/app/routers/invoices_approved.py`

### Before
```python
for approval in approvals:
    try:
        inv = await generate_invoice_from_approved_schedules(...)  # commits internally
        created.append(inv)
    except HTTPException as e:
        await db.rollback()  # INEFFECTIVE — already committed!
        skipped.append(...)
```

### After
```python
for approval in approvals:
    try:
        nested = await db.begin_nested()  # savepoint
        try:
            inv = await _create_invoice_from_approved(..., auto_commit=False)  # flush only
            await nested.commit()
            created.append(inv)
        except HTTPException as e:
            await nested.rollback()  # rolls back only this savepoint
            skipped.append(...)
    except Exception as outer_err:
        skipped.append(...)

if created:
    await db.commit()  # single commit for all successes
```

---

## Test Results

All 14 tests pass:

```
test_invoice_fixes.py::TestFrontendErrorHandling::test_network_error_detected PASSED
test_invoice_fixes.py::TestFrontendErrorHandling::test_backend_error_not_masked PASSED
test_invoice_fixes.py::TestFrontendErrorHandling::test_old_logic_would_mask_errors PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_draft_deletable PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_validated_deletable PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_cancelled_deletable PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_sent_not_deletable PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_paid_not_deletable PASSED
test_invoice_fixes.py::TestDeletionStatusValidation::test_partially_paid_not_deletable PASSED
test_invoice_fixes.py::TestRouteConflicts::test_invoices_py_has_no_bulk_routes PASSED
test_invoice_fixes.py::TestRouteConflicts::test_invoices_bulk_py_has_all_bulk_routes PASSED
test_invoice_fixes.py::TestTransactionManagement::test_bulk_endpoint_uses_savepoints PASSED
test_invoice_fixes.py::TestTransactionManagement::test_single_endpoint_still_commits PASSED
test_invoice_fixes.py::TestTransactionManagement::test_no_bare_rollback_in_loop PASSED
```

---

## Production Testing Checklist

- [ ] **Regenerate invoice for already-invoiced period**: Should show "Une facture existe déjà pour cet employé/client/période" (not "Impossible de joindre le serveur")
- [ ] **Delete a validated invoice**: Should succeed (delete button visible, deletion works)
- [ ] **Bulk delete mixed-status invoices**: Draft/validated/cancelled deleted; sent/paid skipped with reason
- [ ] **Bulk generate with some duplicates**: Created invoices succeed; duplicates listed in skipped with clear reason
- [ ] **Single invoice generation**: Still works normally for fresh employee/client/period combinations
- [ ] **Frontend build**: `npx vite build` succeeds without errors
