# Fix Report: Schedule Modifications Save Issue

**File:** `frontend/src/pages/SchedulesPage.jsx`  
**Component:** `ApprovalPanel`  
**Date:** 2026-04-03  

---

### Root Cause

When a user edited a shift in the `ApprovalPanel` detail view and clicked **Sauver**, the `saveShiftLine` function:

1. Called `api.updateSchedule()` — which **correctly saved** to the database
2. Called `onRefreshParent()` (the parent's `reload()` function) — which fetched fresh data from the API
3. The fresh data updated the `schedules` state in the parent, changing the `shifts` prop passed to `ApprovalPanel`
4. The `useEffect(() => { setEditableShifts(...) }, [shifts])` **immediately overwrote** `editableShifts` with the new prop — but due to React's async batching, this could happen **before** the reload response arrived, using **stale data**
5. Result: the UI appeared to revert the user's changes, even though they were saved in the database

This same pattern affected `removeShiftLine` and `saveQuickAccommodation`.

---

### Changes Made

#### 1. `isSavingRef` guard on useEffect (Critical Fix)
```jsx
const isSavingRef = React.useRef(false);

// BEFORE: Always overwrites
useEffect(() => { setEditableShifts((shifts || []).map(normalizeEditableShift)); }, [shifts]);

// AFTER: Skips overwrite during active save operations
useEffect(() => { if (isSavingRef.current) return; setEditableShifts((shifts || []).map(normalizeEditableShift)); }, [shifts]);
```

#### 2. `saveShiftLine` — Full rewrite with error handling & optimistic updates
- **Snapshot** editableShifts before save (for rollback)
- Set `isSavingRef.current = true` before API call
- **Optimistic update**: immediately update local state with API response (`saved`) for both new and existing shifts
- **Error rollback**: restore snapshot if API call fails
- **Toast notifications**: success ("Quart ajouté"/"Quart modifié") and error messages
- Reset `isSavingRef.current = false` in finally block

#### 3. `removeShiftLine` — Same pattern
- Snapshot + optimistic removal + rollback on error + toast messages

#### 4. `saveQuickAccommodation` — Error handling + toast
- Added try/catch with user-facing error messages
- Added success toast ("Hébergement ajouté")

#### 5. `toast` prop threading
- Added `toast` to `ApprovalPanel` props
- Passed `toast={toast}` from parent `SchedulesPage` to `ApprovalPanel`

---

### Functions Fixed

| Function | Issue | Fix |
|---|---|---|
| `saveShiftLine` | No error handling, useEffect overwrite | isSavingRef guard, snapshot/rollback, toast |
| `removeShiftLine` | No error handling, useEffect overwrite | isSavingRef guard, optimistic removal, snapshot/rollback, toast |
| `saveQuickAccommodation` | No error feedback | try/catch with toast |
| `useEffect([shifts])` | Overwrites during save | isSavingRef guard |

---

### Build Verification

✅ `npx vite build` — 1514 modules transformed, build successful  
✅ Bracket balance check — all balanced  
✅ Git committed: `81686ac`
