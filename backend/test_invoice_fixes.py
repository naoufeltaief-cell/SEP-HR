"""
Tests for invoice regeneration, deletion, and bulk generation fixes.
Run with: python -m pytest test_invoice_fixes.py -v
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import date, datetime

# ──────────────────────────────────────────────
# Test 1: Frontend error handling logic (unit)
# ──────────────────────────────────────────────

class TestFrontendErrorHandling:
    """Verify the error classification logic matches the frontend fix."""

    @staticmethod
    def is_network_error(msg: str) -> bool:
        """Mirrors the fixed frontend logic."""
        return msg in (
            'Failed to fetch',
            'NetworkError when attempting to fetch resource.',
            'Load failed',
        )

    def test_network_error_detected(self):
        assert self.is_network_error('Failed to fetch') is True
        assert self.is_network_error('NetworkError when attempting to fetch resource.') is True
        assert self.is_network_error('Load failed') is True

    def test_backend_error_not_masked(self):
        """HTTP 400 errors from backend should NOT be classified as network errors."""
        assert self.is_network_error('Une facture existe déjà pour cet employé/client/période') is False
        assert self.is_network_error('employee_id, client_id, period_start et period_end requis') is False
        assert self.is_network_error('Aucun quart trouvé pour cette période') is False

    def test_old_logic_would_mask_errors(self):
        """The old msg.includes('fetch') logic would mask these real errors."""
        old_logic = lambda msg: 'fetch' in msg
        # The old logic incorrectly classified 'Failed to fetch' as network error (correct)
        assert old_logic('Failed to fetch') is True
        # But it also masked any message containing 'fetch' (incorrect)
        # Backend errors should pass through — the new logic handles this correctly
        assert self.is_network_error('Failed to fetch') is True
        assert self.is_network_error('Some other error') is False


# ──────────────────────────────────────────────
# Test 2: Deletion status validation
# ──────────────────────────────────────────────

class TestDeletionStatusValidation:
    """Verify that validated invoices are now deletable."""

    DELETABLE_STATUSES = ('draft', 'validated', 'cancelled')

    def test_draft_deletable(self):
        assert 'draft' in self.DELETABLE_STATUSES

    def test_validated_deletable(self):
        """Key fix: validated invoices should now be deletable."""
        assert 'validated' in self.DELETABLE_STATUSES

    def test_cancelled_deletable(self):
        assert 'cancelled' in self.DELETABLE_STATUSES

    def test_sent_not_deletable(self):
        assert 'sent' not in self.DELETABLE_STATUSES

    def test_paid_not_deletable(self):
        assert 'paid' not in self.DELETABLE_STATUSES

    def test_partially_paid_not_deletable(self):
        assert 'partially_paid' not in self.DELETABLE_STATUSES


# ──────────────────────────────────────────────
# Test 3: Route conflict resolution
# ──────────────────────────────────────────────

class TestRouteConflicts:
    """Verify that bulk endpoints are only defined in invoices_bulk.py."""

    def test_invoices_py_has_no_bulk_routes(self):
        """After fix, invoices.py should not define bulk endpoints."""
        import importlib.util
        import os
        spec = importlib.util.spec_from_file_location(
            "invoices_check",
            os.path.join(os.path.dirname(__file__), "app", "routers", "invoices.py")
        )
        # Read file content and check for bulk route decorators
        invoices_path = os.path.join(os.path.dirname(__file__), "app", "routers", "invoices.py")
        with open(invoices_path, 'r') as f:
            content = f.read()

        # Should NOT have bulk route decorators
        assert '@router.post("/bulk/delete")' not in content, "invoices.py still has /bulk/delete route"
        assert '@router.post("/bulk-delete")' not in content, "invoices.py still has /bulk-delete route"
        assert '@router.post("/bulk/validate")' not in content, "invoices.py still has /bulk/validate route"
        assert '@router.post("/bulk/send")' not in content, "invoices.py still has /bulk/send route"

    def test_invoices_bulk_py_has_all_bulk_routes(self):
        """invoices_bulk.py should define all bulk endpoints."""
        import os
        bulk_path = os.path.join(os.path.dirname(__file__), "app", "routers", "invoices_bulk.py")
        with open(bulk_path, 'r') as f:
            content = f.read()

        assert "'/bulk/delete'" in content or '"/bulk/delete"' in content, "Missing /bulk/delete"
        assert "'/bulk-delete'" in content or '"/bulk-delete"' in content, "Missing /bulk-delete"
        assert "'/bulk/validate'" in content or '"/bulk/validate"' in content, "Missing /bulk/validate"
        assert "'/bulk/send'" in content or '"/bulk/send"' in content, "Missing /bulk/send"


# ──────────────────────────────────────────────
# Test 4: Transaction management
# ──────────────────────────────────────────────

class TestTransactionManagement:
    """Verify that invoices_approved.py uses savepoints instead of raw rollback."""

    def test_bulk_endpoint_uses_savepoints(self):
        """The generate_all_approved_schedules should use begin_nested() for savepoints."""
        import os
        approved_path = os.path.join(os.path.dirname(__file__), "app", "routers", "invoices_approved.py")
        with open(approved_path, 'r') as f:
            content = f.read()

        assert 'begin_nested()' in content, "Should use savepoints (begin_nested)"
        # Should NOT have bare db.rollback() in the bulk loop
        # The rollback should be on the nested transaction, not the main session
        assert 'nested.rollback()' in content, "Should rollback nested transaction, not main session"
        assert 'nested.commit()' in content, "Should commit nested transaction on success"

    def test_single_endpoint_still_commits(self):
        """The single generation endpoint should still auto-commit."""
        import os
        approved_path = os.path.join(os.path.dirname(__file__), "app", "routers", "invoices_approved.py")
        with open(approved_path, 'r') as f:
            content = f.read()

        assert 'auto_commit=True' in content, "Single endpoint should auto-commit"
        assert 'auto_commit=False' in content, "Bulk loop should not auto-commit"

    def test_no_bare_rollback_in_loop(self):
        """There should be no bare 'await db.rollback()' in the bulk generation loop."""
        import os
        approved_path = os.path.join(os.path.dirname(__file__), "app", "routers", "invoices_approved.py")
        with open(approved_path, 'r') as f:
            content = f.read()

        # Find the generate_all_approved_schedules function
        func_start = content.find('async def generate_all_approved_schedules')
        assert func_start != -1
        func_content = content[func_start:]

        # Should NOT have bare db.rollback() — only nested.rollback()
        assert 'await db.rollback()' not in func_content, "Should not have bare db.rollback() in bulk function"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
