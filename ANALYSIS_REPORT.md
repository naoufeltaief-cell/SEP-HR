# SEP-HR Codebase Analysis Report

## 1. Duplicate Invoice Number Issue

### Root Cause: Race condition + count-based number generation

**File:** `backend/app/services/invoice_service.py`, lines 39-43

```python
async def generate_invoice_number(db: AsyncSession) -> str:
    today = date.today(); prefix = f"SEP-{today.strftime('%Y%m')}"
    result = await db.execute(select(func.count(Invoice.id)).where(Invoice.number.like(f"{prefix}%")))
    count = result.scalar() or 0
    return f"{prefix}-{count + 1:04d}"
```

**The problem:** The function counts existing invoices with the prefix (e.g., `SEP-202604-%`) and returns `count + 1`. This approach has **two critical flaws**:

1. **Race condition:** If two invoice generation requests run concurrently (e.g., via `generate-all-approved-schedules` at line 150 of `invoices_approved.py`), both calls read the same count before either commits, generating the same number. The bulk endpoint at line 167 calls the single-invoice endpoint in a loop *within the same transaction*, but each call does `db.commit()` independently (line 145). However, the count-based approach is still fragile.

2. **Stale count after deletions/cancellations:** If invoice `SEP-202604-0005` was deleted from the DB but `SEP-202604-0006`, `0007`, `0008` still exist, the count is 3, so the next number generated would be `SEP-202604-0004` — but if `0004` also exists, it would create `SEP-202604-0004` (duplicate). More critically: **the count of rows with matching prefix ≠ the max sequence number**. If there are 8 invoices (`0001` through `0008`), count=8, next=`0009`. But if `0003` was deleted, count=7, next=`0008` — **which already exists!**

3. **CSV import amplification:** After bulk importing schedule data via CSV, many invoices may have been generated. If any were subsequently deleted or cancelled, the count will be lower than the highest existing sequence number, causing collisions on next generation.

**Error in logs:** `Key (number)=(SEP-202604-0008) already exists.` confirms this — the count-based generation produced a number that already existed in the DB.

### Recommended Fix

Replace count-based logic with **max sequence extraction**:

```python
async def generate_invoice_number(db: AsyncSession) -> str:
    today = date.today()
    prefix = f"SEP-{today.strftime('%Y%m')}"
    # Extract the max sequence number from existing invoices
    result = await db.execute(
        select(func.max(
            func.cast(func.substr(Invoice.number, len(prefix) + 2), Integer)
        )).where(Invoice.number.like(f"{prefix}-%"))
    )
    max_seq = result.scalar() or 0
    return f"{prefix}-{max_seq + 1:04d}"
```

Additionally, add a retry mechanism with `FOR UPDATE` or use a DB sequence to prevent race conditions.

---

## 2. Schedule Modifications Not Saved

### Root Cause: Frontend saves work correctly BUT the parent view doesn't refresh inline shifts

**Analysis of the save flow:**

1. **Frontend `saveShiftLine` function** (SchedulesPage.jsx, line 132-149):
   - For existing shifts: calls `api.updateSchedule(shift.id, payload)` which maps to `PUT /api/schedules/{sid}`
   - The payload includes: `start, end, pause, hours, km, deplacement, autre_dep, notes`
   - After saving, calls `onRefreshParent()` which triggers the parent `reload()` function

2. **Backend `update_schedule`** (schedules.py, line 178-188):
   - Receives `ScheduleUpdate` which correctly includes all editable fields
   - Uses `data.model_dump(exclude_unset=True)` to only update provided fields
   - Calls `db.commit()` and `db.refresh()` — **this works correctly**

3. **The actual problem** is in the **ApprovalPanel's shift display after save**:
   - Line 142-143: After `updateSchedule`, `saved` is set from the API response
   - But `onRefreshParent()` (line 145) reloads `schedules` in the **parent** component
   - The `useEffect` at line 127 re-initializes `editableShifts` from the parent's `shifts` prop
   - **However**, the `shifts` prop is computed from `getClientWeekShifts()` which reads from the parent's `schedules` state
   - The **timing issue**: `onRefreshParent()` is `async` but is called without `await` — so the parent reloads schedules asynchronously, and the `useEffect` may fire with stale data depending on React's batch update cycle

4. **More critically**: The `toggleBillingPanel` function (line 108) loads approval/review data when opening the detail panel. If the user modifies shifts, saves them, and then checks the approval panel again, the **Approval Panel's shifts are from the parent's `schedules` state** which updates via `reload()`. The save **does work** — but the user may perceive changes as lost if:
   - The `reload()` hasn't completed before the UI re-renders
   - The panel collapses/re-opens, which triggers a fresh load

5. **Confirmed working path**: `PUT /api/schedules/{sid}` → `setattr(sched, k, v)` → `db.commit()` → data IS saved to DB.

### Likely User Experience Issue

The "not saved" perception likely comes from:
- **After clicking "Sauver" on a shift line**, the `onRefreshParent()` triggers a full reload. During reload, the panel may flash/reset, making it look like changes were lost.
- **The `useEffect` at line 127** reinitializes `editableShifts` from the new `shifts` prop — if `shifts` hasn't been updated yet (async timing), it reverts to old values momentarily.

### Recommended Fix

- Add `await` before `onRefreshParent()` in `saveShiftLine` (line 145)
- Alternatively, optimistically update `editableShifts` from the API response before refreshing the parent
- Add a success indicator (toast) after save to confirm to user

---

## 3. CSV/Excel Import/Export Functionality

### Current State: **No import/export for schedules exists**

**Findings:**
- **No backend import endpoint** exists in any router file for schedule CSV/Excel import
- **No backend export endpoint** exists for schedule CSV/Excel export
- **Frontend has no import/export UI** on the SchedulesPage
- The **only CSV export** in the app is in `InvoicesPage.jsx` (lines 1813-1827) for invoice reports — this is purely client-side CSV generation for reports, not schedule data
- The uploaded CSV file (`par_quart_2025-01-01-2026-07-31.csv`) was likely imported directly into the database via a manual script or SQL, not through the application

### CSV File Structure (5,734 rows)

| Column | Example | Maps to Schedule field |
|--------|---------|----------------------|
| Prénom | AISSATA | → Employee name (lookup) |
| Nom | ANGA KABA | → Employee name (lookup) |
| Numero_employe | 131 | → employee_id (needs mapping) |
| Courriel | email@... | → Employee email |
| Date_du_quart | 2025-01-01 | → `date` |
| Heure_debut | 7:00 | → `start` |
| Heure_fin | 15:15 | → `end` |
| Heures_travaillees | 7.5 | → `hours` |
| Taux_horaire | 60 | → `billable_rate` |
| Temps de Préparation | 0 | → Could map to pause or deplacement |
| Cout | 450 | → (computed, not stored) |
| Position | Infirmier.ère | → Employee position (for rate lookup) |
| Lieu | MDAMA RDL | → `location` (needs client mapping) |
| Statut | quart assigné | → `status` (needs mapping) |
| Note, Note_employe, Note_interne | — | → `notes` |

### Recommended Implementation

**Backend:** Create `POST /api/schedules/import-csv` endpoint that:
1. Accepts multipart file upload
2. Parses CSV with proper encoding (UTF-8 with BOM)
3. Maps employee names/numbers to existing employee IDs
4. Maps location names to client IDs
5. Creates Schedule records in bulk
6. Returns summary (created, skipped, errors)

**Backend:** Create `GET /api/schedules/export-csv` endpoint that:
1. Accepts date range query parameters
2. Exports all schedules in the CSV format matching the import format

**Frontend:** Add import/export buttons to SchedulesPage header.

---

## Summary of Issues & Priority

| Issue | Severity | Root Cause | Fix Complexity |
|-------|----------|-----------|----------------|
| Duplicate invoice numbers | **Critical** | Count-based generation instead of max-sequence | Low — change `COUNT` to `MAX` in `generate_invoice_number()` |
| Schedule modifications "not saved" | **Medium** | Async timing in parent refresh after save; data IS saved to DB | Low — add `await` + optimistic UI update |
| Missing CSV import/export | **Feature** | Not implemented | Medium — new endpoints + frontend UI |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/app/services/invoice_service.py:39-43` | Invoice number generation (BUG) |
| `backend/app/routers/invoices_approved.py:43-147` | Generate invoice from approved schedules |
| `backend/app/routers/schedules.py:178-188` | Schedule update endpoint (works correctly) |
| `frontend/src/pages/SchedulesPage.jsx:132-149` | Shift save logic in ApprovalPanel |
| `frontend/src/pages/SchedulesPage.jsx:127` | useEffect that resets editableShifts from props |
| `backend/app/models/schemas.py:117-132` | ScheduleUpdate schema (complete) |
