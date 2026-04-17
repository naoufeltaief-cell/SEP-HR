from __future__ import annotations

import io
import os
import sys
import unittest
from types import SimpleNamespace

from openpyxl import Workbook

ROOT = os.path.dirname(__file__)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.services.employee_compensation_import_service import (  # noqa: E402
    apply_employee_compensation_rows,
    parse_employee_compensation_file,
)


class EmployeeCompensationImportTests(unittest.TestCase):
    def _build_xlsx(self, rows: list[tuple]) -> bytes:
        workbook = Workbook()
        sheet = workbook.active
        for row in rows:
            sheet.append(list(row))
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    def test_parse_compensation_file_detects_hourly_perdiem_and_honoraires(self):
        payload = self._build_xlsx(
            [
                ("Nom de la ressource", "Taux horaire", "Perdiem", "Mode"),
                ("Alice Example", 48, 120, "perdiem par quart de 7 heures"),
                ("Bob Example", 0, None, "honoraires"),
                ("Carole Example", 40, 10, "perdiem horaire"),
            ]
        )

        rows = parse_employee_compensation_file(payload, "compensation.xlsx")

        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0].compensation_mode, "hourly")
        self.assertEqual(rows[0].perdiem_mode, "per_shift_min_hours")
        self.assertEqual(rows[0].perdiem_threshold_hours, 7.0)
        self.assertEqual(rows[1].compensation_mode, "honoraires")
        self.assertEqual(rows[1].perdiem_mode, "")
        self.assertEqual(rows[2].perdiem_mode, "hourly")

    def test_apply_compensation_rows_updates_employee_profile(self):
        employee = SimpleNamespace(
            id=1,
            name="Alice Example",
            rate=0,
            salary=0,
            perdiem=0,
            payroll_compensation_mode="",
            perdiem_mode="",
            perdiem_threshold_hours=0,
            payroll_company="",
        )
        payload = self._build_xlsx(
            [
                ("Nom de la ressource", "Taux horaire", "Perdiem", "Mode"),
                ("Alice Example", 52, 120, "perdiem par quart de 7 heures"),
            ]
        )

        rows = parse_employee_compensation_file(payload, "compensation.xlsx")
        report = apply_employee_compensation_rows([employee], rows)

        self.assertEqual(report["updated_employees"], 1)
        self.assertEqual(employee.rate, 52.0)
        self.assertEqual(employee.salary, 52.0)
        self.assertEqual(employee.perdiem, 120.0)
        self.assertEqual(employee.payroll_compensation_mode, "hourly")
        self.assertEqual(employee.perdiem_mode, "per_shift_min_hours")
        self.assertEqual(employee.perdiem_threshold_hours, 7.0)
        self.assertEqual(employee.payroll_company, "254981")


if __name__ == "__main__":
    unittest.main(verbosity=2)
