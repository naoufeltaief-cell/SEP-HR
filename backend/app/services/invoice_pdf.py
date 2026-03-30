"""
Soins Expert Plus — Invoice PDF Generator (Phase 1)
Professional QuickBooks-style PDF using ReportLab.
"""

from io import BytesIO
from datetime import date
from typing import Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, 
    HRFlowable, Image, KeepTogether
)
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .invoice_service import COMPANY_INFO

# ──────────────────────────────────────────────
# Colors (SEP teal theme)
# ──────────────────────────────────────────────
TEAL = colors.HexColor("#2A7B88")
TEAL_LIGHT = colors.HexColor("#E8F4F6")
TEAL_DARK = colors.HexColor("#1D5A63")
GRAY_LIGHT = colors.HexColor("#F8F9FA")
GRAY_BORDER = colors.HexColor("#DEE2E6")
TEXT_DARK = colors.HexColor("#212529")
TEXT_MUTED = colors.HexColor("#6C757D")
WHITE = colors.white
RED = colors.HexColor("#DC3545")
GREEN = colors.HexColor("#28A745")


# ──────────────────────────────────────────────
# Styles
# ──────────────────────────────────────────────

def get_styles():
    styles = getSampleStyleSheet()
    
    styles.add(ParagraphStyle(
        name="InvTitle",
        fontSize=24,
        textColor=TEAL,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="InvSubtitle",
        fontSize=10,
        textColor=TEXT_MUTED,
        spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name="SectionHeader",
        fontSize=11,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        spaceBefore=14,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="CellText",
        fontSize=8,
        textColor=TEXT_DARK,
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="CellTextRight",
        fontSize=8,
        textColor=TEXT_DARK,
        leading=10,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="CellBold",
        fontSize=8,
        textColor=TEXT_DARK,
        fontName="Helvetica-Bold",
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="Footer",
        fontSize=7,
        textColor=TEXT_MUTED,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="TotalLabel",
        fontSize=9,
        textColor=TEXT_DARK,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="TotalValue",
        fontSize=9,
        textColor=TEXT_DARK,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="GrandTotal",
        fontSize=12,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    return styles


# ──────────────────────────────────────────────
# Helper: money format
# ──────────────────────────────────────────────

def fmt(amount):
    """Format amount as $X,XXX.XX"""
    if amount is None:
        return "$0.00"
    return f"${amount:,.2f}"


def fmt_num(val):
    """Format number with 2 decimals"""
    if val is None:
        return "0.00"
    return f"{val:.2f}"


# ──────────────────────────────────────────────
# Section header bar
# ──────────────────────────────────────────────

def section_header(text, styles, width=7.5*inch):
    """Create a teal section header bar"""
    data = [[Paragraph(text, styles["SectionHeader"])]]
    t = Table(data, colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, -1), WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
    ]))
    return t


# ──────────────────────────────────────────────
# Generate Invoice PDF
# ──────────────────────────────────────────────

def generate_invoice_pdf(invoice) -> BytesIO:
    """
    Generate a professional PDF for an invoice.
    Returns BytesIO buffer.
    """
    buffer = BytesIO()
    styles = get_styles()
    
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.5*inch,
        rightMargin=0.5*inch,
        topMargin=0.5*inch,
        bottomMargin=0.75*inch,
    )

    elements = []
    page_width = 7.5 * inch

    # ── HEADER: Company + Invoice info ──
    status_text = (invoice.status or "draft").upper()
    status_color = {
        "DRAFT": TEXT_MUTED,
        "VALIDATED": TEAL,
        "SENT": TEAL,
        "PARTIALLY_PAID": colors.HexColor("#FFC107"),
        "PAID": GREEN,
        "CANCELLED": RED,
    }.get(status_text, TEXT_MUTED)

    header_left = [
        Paragraph("SOINS EXPERT PLUS", styles["InvTitle"]),
        Paragraph(COMPANY_INFO["legal"], styles["InvSubtitle"]),
        Paragraph(COMPANY_INFO["address"], styles["InvSubtitle"]),
        Paragraph(f"Courriel: {COMPANY_INFO['email']}", styles["InvSubtitle"]),
        Paragraph(f"TPS: {COMPANY_INFO['tps_number']}", styles["InvSubtitle"]),
        Paragraph(f"TVQ: {COMPANY_INFO['tvq_number']}", styles["InvSubtitle"]),
    ]

    inv_date = invoice.date.strftime("%d/%m/%Y") if hasattr(invoice.date, "strftime") else str(invoice.date)
    period_start = invoice.period_start.strftime("%d/%m/%Y") if hasattr(invoice.period_start, "strftime") else str(invoice.period_start)
    period_end = invoice.period_end.strftime("%d/%m/%Y") if hasattr(invoice.period_end, "strftime") else str(invoice.period_end)

    header_right_data = [
        ["FACTURE", ""],
        ["Numéro:", invoice.number or ""],
        ["Date:", inv_date],
        ["Période:", f"{period_start} au {period_end}"],
        ["Statut:", status_text],
    ]
    if invoice.po_number:
        header_right_data.append(["Réf. PO:", invoice.po_number])
    if invoice.due_date:
        due = invoice.due_date.strftime("%d/%m/%Y") if hasattr(invoice.due_date, "strftime") else str(invoice.due_date)
        header_right_data.append(["Échéance:", due])

    right_table = Table(header_right_data, colWidths=[1.2*inch, 2*inch])
    right_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (1, 0), 16),
        ("TEXTCOLOR", (0, 0), (1, 0), TEAL),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_DARK),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("SPAN", (0, 0), (1, 0)),
    ]))

    header_table = Table(
        [[header_left, right_table]],
        colWidths=[4*inch, 3.5*inch],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 12))

    # ── HORIZONTAL LINE ──
    elements.append(HRFlowable(width=page_width, thickness=2, color=TEAL, spaceAfter=12))

    # ── CLIENT / EMPLOYEE INFO ──
    client_info = [
        Paragraph("<b>FACTURER À:</b>", ParagraphStyle("b", fontSize=9, textColor=TEAL, fontName="Helvetica-Bold")),
        Paragraph(invoice.client_name or "—", styles["CellBold"]),
    ]
    if invoice.client_address:
        client_info.append(Paragraph(invoice.client_address, styles["CellText"]))
    if invoice.client_email:
        client_info.append(Paragraph(invoice.client_email, styles["CellText"]))
    if invoice.client_phone:
        client_info.append(Paragraph(invoice.client_phone, styles["CellText"]))

    emp_info = [
        Paragraph("<b>RESSOURCE:</b>", ParagraphStyle("b", fontSize=9, textColor=TEAL, fontName="Helvetica-Bold")),
        Paragraph(invoice.employee_name or "—", styles["CellBold"]),
        Paragraph(invoice.employee_title or "", styles["CellText"]),
    ]

    info_table = Table(
        [[client_info, emp_info]],
        colWidths=[4*inch, 3.5*inch],
    )
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), TEAL_LIGHT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 16))

    # ── SERVICES TABLE ──
    lines = invoice.lines or []
    if lines:
        elements.append(section_header("SERVICES", styles, page_width))
        elements.append(Spacer(1, 4))

        svc_headers = ["Date", "Début", "Fin", "Pause", "Heures", "Taux", "Services", "Garde", "Rappel"]
        svc_data = [svc_headers]

        for l in lines:
            d = l.get("date", "")
            if len(d) > 10:
                d = d[:10]
            svc_data.append([
                d,
                l.get("start", ""),
                l.get("end", ""),
                f"{l.get('pause_min', 0):.0f} min",
                fmt_num(l.get("hours", 0)),
                fmt(l.get("rate", 0)),
                fmt(l.get("service_amount", 0)),
                fmt(l.get("garde_amount", 0)) if l.get("garde_amount", 0) else "—",
                fmt(l.get("rappel_amount", 0)) if l.get("rappel_amount", 0) else "—",
            ])

        col_widths = [0.85*inch, 0.7*inch, 0.7*inch, 0.6*inch, 0.65*inch, 0.75*inch, 0.9*inch, 0.75*inch, 0.75*inch]
        svc_table = Table(svc_data, colWidths=col_widths, repeatRows=1)
        svc_style = TableStyle([
            # Header
            ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 7),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            # Data
            ("FONTSIZE", (0, 1), (-1, -1), 7),
            ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_DARK),
            ("ALIGN", (4, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            # Alternate rows
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_LIGHT]),
            # Grid
            ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, GRAY_BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ])
        svc_table.setStyle(svc_style)
        elements.append(svc_table)
        elements.append(Spacer(1, 6))

    # ── ACCOMMODATION TABLE ──
    accom_lines = invoice.accommodation_lines or []
    if accom_lines:
        elements.append(section_header("HÉBERGEMENT", styles, page_width))
        elements.append(Spacer(1, 4))

        accom_data = [["Employé", "Période", "Jours facturés", "Coût/jour", "Montant"]]
        for a in accom_lines:
            accom_data.append([
                a.get("employee", ""),
                a.get("period", ""),
                fmt_num(a.get("days", 0)),
                fmt(a.get("cost_per_day", 0)),
                fmt(a.get("amount", 0)),
            ])

        accom_table = Table(accom_data, colWidths=[1.8*inch, 2*inch, 1*inch, 1*inch, 1.2*inch], repeatRows=1)
        accom_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_LIGHT]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(accom_table)
        elements.append(Spacer(1, 6))

    # ── EXPENSES TABLE ──
    expense_lines = invoice.expense_lines or []
    extra_lines = invoice.extra_lines or []
    all_expenses = expense_lines + extra_lines

    if all_expenses:
        elements.append(section_header("FRAIS", styles, page_width))
        elements.append(Spacer(1, 4))

        exp_data = [["Description", "Quantité", "Taux", "Montant"]]
        for e in expense_lines:
            etype = e.get("type", "")
            desc = e.get("description", "")
            if etype == "km":
                desc = desc or "Kilométrage"
            elif etype == "deplacement":
                desc = desc or "Déplacement"
            exp_data.append([
                desc,
                fmt_num(e.get("quantity", 0)),
                fmt(e.get("rate", 0)),
                fmt(e.get("amount", 0)),
            ])
        for e in extra_lines:
            exp_data.append([
                e.get("description", "Ligne additionnelle"),
                fmt_num(e.get("quantity", 1)),
                fmt(e.get("rate", 0)),
                fmt(e.get("amount", 0)),
            ])

        exp_table = Table(exp_data, colWidths=[3.5*inch, 1.2*inch, 1.2*inch, 1.2*inch], repeatRows=1)
        exp_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_LIGHT]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(exp_table)
        elements.append(Spacer(1, 6))

    # ── TOTALS SECTION ──
    elements.append(Spacer(1, 10))

    totals_data = [
        ["Sous-total Services:", fmt(invoice.subtotal_services)],
    ]
    if invoice.subtotal_garde:
        totals_data.append(["Sous-total Garde:", fmt(invoice.subtotal_garde)])
    if invoice.subtotal_rappel:
        totals_data.append(["Sous-total Rappel:", fmt(invoice.subtotal_rappel)])
    if invoice.subtotal_accom:
        totals_data.append(["Sous-total Hébergement:", fmt(invoice.subtotal_accom)])
    if invoice.subtotal_deplacement:
        totals_data.append(["Sous-total Déplacement:", fmt(invoice.subtotal_deplacement)])
    if invoice.subtotal_km:
        totals_data.append(["Sous-total Kilométrage:", fmt(invoice.subtotal_km)])
    if invoice.subtotal_autres_frais:
        totals_data.append(["Sous-total Autres frais:", fmt(invoice.subtotal_autres_frais)])

    totals_data.append(["", ""])  # spacer row
    totals_data.append(["SOUS-TOTAL:", fmt(invoice.subtotal)])

    if invoice.include_tax and invoice.tps > 0:
        totals_data.append([f"TPS (5%) — {COMPANY_INFO['tps_number']}:", fmt(invoice.tps)])
        totals_data.append([f"TVQ (9.975%) — {COMPANY_INFO['tvq_number']}:", fmt(invoice.tvq)])
    elif not invoice.include_tax:
        totals_data.append(["Taxes:", "Exempté"])

    # Blank row + spacer
    totals_left_space = Table([[""]], colWidths=[page_width * 0.55])

    totals_right = Table(totals_data, colWidths=[2.5*inch, 1.5*inch])
    totals_right.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEABOVE", (0, -1), (-1, -1), 0.5, GRAY_BORDER),
    ]))

    totals_layout = Table(
        [[totals_left_space, totals_right]],
        colWidths=[page_width * 0.5, page_width * 0.5],
    )
    totals_layout.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(totals_layout)

    # ── GRAND TOTAL BAR ──
    elements.append(Spacer(1, 6))
    grand_data = [["TOTAL:", fmt(invoice.total)]]
    grand_table = Table(grand_data, colWidths=[page_width - 2*inch, 2*inch])
    grand_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, -1), WHITE),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 13),
        ("ALIGN", (0, 0), (0, 0), "RIGHT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    elements.append(grand_table)

    # ── PAYMENT INFO (if any) ──
    if invoice.amount_paid > 0:
        elements.append(Spacer(1, 8))
        pay_data = [
            ["Montant payé:", fmt(invoice.amount_paid)],
            ["SOLDE DÛ:", fmt(invoice.balance_due)],
        ]
        pay_table = Table(pay_data, colWidths=[page_width - 2*inch, 2*inch])
        pay_color = GREEN if invoice.balance_due <= 0 else RED
        pay_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (1, 0), 9),
            ("FONTSIZE", (0, 1), (1, 1), 11),
            ("TEXTCOLOR", (0, 1), (1, 1), pay_color),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ]))
        elements.append(pay_table)

    # ── NOTES ──
    if invoice.notes:
        elements.append(Spacer(1, 16))
        elements.append(section_header("NOTES", styles, page_width))
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(invoice.notes, styles["CellText"]))

    # ── FOOTER ──
    elements.append(Spacer(1, 30))
    elements.append(HRFlowable(width=page_width, thickness=1, color=TEAL_LIGHT))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        f"Soins Expert Plus | {COMPANY_INFO['legal']} | {COMPANY_INFO['email']}",
        styles["Footer"]
    ))
    elements.append(Paragraph(
        f"TPS: {COMPANY_INFO['tps_number']} | TVQ: {COMPANY_INFO['tvq_number']}",
        styles["Footer"]
    ))
    elements.append(Paragraph(
        "Merci de votre confiance. Paiement attendu dans les 30 jours suivant la réception.",
        styles["Footer"]
    ))

    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    return buffer


# ──────────────────────────────────────────────
# Generate Credit Note PDF
# ──────────────────────────────────────────────

def generate_credit_note_pdf(credit_note) -> BytesIO:
    """Generate PDF for a credit note"""
    buffer = BytesIO()
    styles = get_styles()

    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        leftMargin=0.5*inch, rightMargin=0.5*inch,
        topMargin=0.5*inch, bottomMargin=0.75*inch,
    )

    elements = []
    page_width = 7.5 * inch

    # Header
    elements.append(Paragraph("SOINS EXPERT PLUS", styles["InvTitle"]))
    elements.append(Paragraph(COMPANY_INFO["legal"], styles["InvSubtitle"]))
    elements.append(Spacer(1, 12))
    elements.append(HRFlowable(width=page_width, thickness=2, color=RED))
    elements.append(Spacer(1, 8))

    # Credit note info
    cn_date = credit_note.date.strftime("%d/%m/%Y") if hasattr(credit_note.date, "strftime") else str(credit_note.date)
    info_data = [
        ["NOTE DE CRÉDIT", ""],
        ["Numéro:", credit_note.number],
        ["Date:", cn_date],
        ["Client:", credit_note.client_name or ""],
        ["Facture réf.:", credit_note.invoice_number or ""],
    ]
    info_table = Table(info_data, colWidths=[1.5*inch, 4*inch])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (1, 0), 16),
        ("TEXTCOLOR", (0, 0), (1, 0), RED),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("SPAN", (0, 0), (1, 0)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 16))

    # Reason
    elements.append(Paragraph("<b>Raison:</b>", styles["CellBold"]))
    elements.append(Paragraph(credit_note.reason or "", styles["CellText"]))
    elements.append(Spacer(1, 16))

    # Amounts
    totals_data = [
        ["Montant:", fmt(credit_note.amount)],
    ]
    if credit_note.include_tax and credit_note.tps > 0:
        totals_data.append([f"TPS (5%):", fmt(credit_note.tps)])
        totals_data.append([f"TVQ (9.975%):", fmt(credit_note.tvq)])
    totals_data.append(["TOTAL CRÉDIT:", fmt(credit_note.total)])

    totals_table = Table(totals_data, colWidths=[4*inch, 2*inch])
    totals_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 13),
        ("TEXTCOLOR", (0, -1), (-1, -1), RED),
        ("LINEABOVE", (0, -1), (-1, -1), 1, GRAY_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(totals_table)

    # Footer
    elements.append(Spacer(1, 40))
    elements.append(HRFlowable(width=page_width, thickness=1, color=TEAL_LIGHT))
    elements.append(Paragraph(
        f"Soins Expert Plus | {COMPANY_INFO['legal']} | {COMPANY_INFO['email']}",
        styles["Footer"]
    ))

    doc.build(elements)
    buffer.seek(0)
    return buffer
