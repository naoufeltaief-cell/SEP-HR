# Deployment Summary — Soins Expert Plus (SEP-HR)

**Date:** 2026-04-03  
**Deployed to:** GitHub `main` branch → Render (auto-deploy)  
**Production URL:** https://soins-expert-frontend.onrender.com/

---

## Git Commits Pushed

| Commit Hash | Description |
|-------------|-------------|
| `dfbfcba` | fix: use MAX instead of COUNT for invoice/credit note number generation |
| `81686ac` | fix: prevent schedule modifications from being overwritten during save |
| `af1ddd7` | docs: add fix report for schedule save issue |
| `c65b6b4` | feat: add CSV/Excel import/export for schedules |

All 4 commits pushed to `origin/main` on **2026-04-03**.

---

## Changes Summary

### Fix 1 — Invoice Number Generation (Duplicate Key Error)
**File:** `backend/app/services/invoice_service.py`  
**Root Cause:** `COUNT`-based logic produced duplicate numbers when invoices were deleted (gaps in sequence).  
**Fix:** Replaced with `MAX(CAST(SUBSTR(number, offset) AS INTEGER))` to always generate the next number after the highest existing one.  
**Also fixed:** Credit note number generation with the same logic.

### Fix 2 — Schedule Modifications Not Saving
**File:** `frontend/src/pages/SchedulesPage.jsx`  
**Root Cause:** `useEffect` in `ApprovalPanel` was overwriting local editable state with stale data from parent refresh during async save.  
**Fix:**
- Added `isSavingRef` guard to prevent `useEffect` overwrites during save
- Implemented proper `async/await` with optimistic UI updates
- Added rollback on error and toast notifications for user feedback

### Fix 3 — CSV/Excel Import/Export for Schedules
**Files:** `backend/app/routers/schedules.py`, `frontend/src/pages/SchedulesPage.jsx`, `backend/requirements.txt`  
**New Endpoints:**
- `POST /api/schedules/import-csv` — Upload CSV/Excel files with schedule data
- `GET /api/schedules/export-csv` — Download schedules as CSV or Excel
**Frontend:** Import and Export buttons with modals (drag-and-drop, filters, format selection)  
**Dependencies added:** `pandas`, `openpyxl`

---

## Deployment Monitoring

Render has **auto-deploy enabled**. After pushing to `main`:

1. **Check Render Dashboard** — Navigate to https://dashboard.render.com and open both the frontend and backend services
2. **Watch Build Logs** — Monitor for build errors, especially:
   - Backend: `pip install` should succeed with new `pandas` and `openpyxl` dependencies
   - Frontend: `npm run build` (or `npx vite build`) should succeed
3. **Estimated Time:** 2–3 minutes per service
4. **Verify** both services show "Live" status with the latest commit hash

---

## Production Testing Checklist

**Login:** `rh@soins-expert-plus.com` / `admin2026!`

### ✅ Test 1: Invoice Generation from Approved Schedules

1. Login with admin credentials
2. Navigate to **Horaires** tab
3. Find an approved schedule (e.g., for the period **2026-04-05 to 2026-04-11**)
4. Click **"Générer la facture approuvée"**
5. **Verify:**
   - ❏ No "duplicate key" or 500 error occurs
   - ❏ Invoice is created successfully
   - ❏ Invoice number follows `SEP-YYYYMM-XXXX` format
   - ❏ Invoice appears in the **Facturation** tab
6. **Repeat test:** Generate a second invoice for a different schedule in the same month
   - ❏ Invoice number increments correctly (e.g., `SEP-202604-0001` → `SEP-202604-0002`)

### ✅ Test 2: Schedule Modifications Save Correctly

1. Navigate to **Horaires** tab
2. Click **"Détail"** on any schedule
3. **Test shift editing:**
   - Modify start time, end time, or pause for an existing shift
   - Click **"Sauver"**
   - ❏ Toast notification confirms save
   - ❏ Values persist on page (no revert to old values)
4. **Test adding a new shift:**
   - Click **"+ Ajouter ligne"**
   - Fill in date, start, end, pause
   - Click **"Sauver"**
   - ❏ New shift appears and persists
5. **Test expenses/mileage:**
   - Add KM, déplacement, or autre values to a shift line
   - Click **"Sauver"**
   - ❏ Values persist after save
6. **Test accommodation:**
   - Add a quick accommodation entry
   - Click **"Ajouter"**
   - ❏ Accommodation appears in the list
7. **Full refresh test:**
   - Make changes → save → **refresh the entire page** (F5)
   - ❏ All saved changes are still present

### ✅ Test 3: CSV/Excel Import/Export

#### Export Test
1. Navigate to **Horaires** tab
2. Click **"Exporter"** button (in the page header)
3. Set date range (e.g., `2026-03-01` to `2026-04-03`)
4. Optionally select an employee or client filter
5. Select format: **CSV**
6. Click **"Exporter"**
   - ❏ File downloads successfully
   - ❏ File contains expected columns and data
7. Repeat with **Excel** format
   - ❏ `.xlsx` file downloads and opens correctly

#### Import Test
1. Click **"Importer"** button
2. Upload a CSV file (drag-and-drop or click to select)
   - Use the file `par_quart_2025-01-01-2026-07-31.csv` or a previously exported file
3. Click **"Importer"**
   - ❏ Progress indicator shows during import
   - ❏ Results summary appears (success count, error count)
   - ❏ Error details are shown for any invalid rows
4. Close the modal and verify imported schedules appear in the list
5. Repeat with an **Excel** file (`.xlsx`)

---

## Rollback Instructions

If any issues are found in production:

### Quick Rollback (revert to previous state)
```bash
git revert c65b6b4 af1ddd7 81686ac dfbfcba --no-commit
git commit -m "revert: rollback 3 fixes due to production issues"
git push origin main
```

### Selective Rollback (revert individual fixes)
```bash
# Revert only import/export feature
git revert c65b6b4 af1ddd7

# Revert only schedule save fix
git revert 81686ac

# Revert only invoice number fix
git revert dfbfcba
```

### Emergency: Hard reset to previous state
```bash
git reset --hard 3a8e84f
git push --force origin main
```
⚠️ **Use hard reset only as a last resort** — it rewrites history.

---

## Related Documentation

| Document | Description |
|----------|-------------|
| `TEST_REPORT_invoice_number_fix.md` | Unit test results for invoice number fix |
| `FIX_REPORT_schedule_save.md` | Detailed fix report for schedule save issue |
| `IMPORT_EXPORT_GUIDE.md` | User guide for CSV/Excel import/export |
