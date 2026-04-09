"""
Soins Expert Plus — Invoice PDF Generator
Professional world-class PDF using ReportLab.
"""

from io import BytesIO
from datetime import date
from typing import Optional
from pathlib import Path
from html import escape
import os
import logging

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image, KeepTogether, Frame, PageTemplate
)
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .invoice_service import COMPANY_INFO

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Colors (refined palette)
# ──────────────────────────────────────────────
PRIMARY = colors.HexColor("#1D5A63")
PRIMARY_LIGHT = colors.HexColor("#2A7B88")
ACCENT = colors.HexColor("#E8F4F6")
BG_LIGHT = colors.HexColor("#F8FAFB")
BORDER = colors.HexColor("#D1D9DD")
TEXT_PRIMARY = colors.HexColor("#1A1A2E")
TEXT_SECONDARY = colors.HexColor("#5A6872")
TEXT_MUTED = colors.HexColor("#8B95A0")
WHITE = colors.white
RED = colors.HexColor("#D32F2F")
GREEN = colors.HexColor("#2E7D32")
GOLD = colors.HexColor("#F9A825")

# Logo path
LOGO_PATH = Path(__file__).parent.parent / "static" / "logo.png"


# ──────────────────────────────────────────────
# Styles
# ──────────────────────────────────────────────

def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name="CompanyName",
        fontSize=20,
        textColor=PRIMARY,
        spaceAfter=2,
        fontName="Helvetica-Bold",
        leading=24,
    ))
    styles.add(ParagraphStyle(
        name="CompanyDetail",
        fontSize=9,
        textColor=TEXT_SECONDARY,
        spaceAfter=1,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="InvoiceLabel",
        fontSize=28,
        textColor=PRIMARY,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
        leading=32,
    ))
    styles.add(ParagraphStyle(
        name="SectionTitle",
        fontSize=10,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        spaceBefore=12,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="CellText",
        fontSize=8,
        textColor=TEXT_PRIMARY,
        leading=11,
    ))
    styles.add(ParagraphStyle(
        name="CellTextRight",
        fontSize=8,
        textColor=TEXT_PRIMARY,
        leading=11,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="CellBold",
        fontSize=8,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        leading=11,
    ))
    styles.add(ParagraphStyle(
        name="InfoLabel",
        fontSize=9,
        textColor=PRIMARY,
        fontName="Helvetica-Bold",
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="InfoValue",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="Footer",
        fontSize=7,
        textColor=TEXT_MUTED,
        alignment=TA_CENTER,
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="TotalLabel",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="TotalValue",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="GrandTotalText",
        fontSize=13,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="MetaLabel",
        fontSize=7.5,
        textColor=TEXT_MUTED,
        fontName="Helvetica-Bold",
        leading=9,
    ))
    styles.add(ParagraphStyle(
        name="MetaValue",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        leading=11,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="CardTitle",
        fontSize=8.5,
        textColor=PRIMARY_LIGHT,
        fontName="Helvetica-Bold",
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="CardPrimary",
        fontSize=10.5,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        leading=13,
    ))
    styles.add(ParagraphStyle(
        name="CardSecondary",
        fontSize=8.5,
        textColor=TEXT_SECONDARY,
        leading=11,
    ))
    styles.add(ParagraphStyle(
        name="TableHeader",
        fontSize=8,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="TableCell",
        fontSize=8.5,
        textColor=TEXT_PRIMARY,
        leading=10,
    ))
    styles.add(ParagraphStyle(
        name="TableCellRight",
        fontSize=8.5,
        textColor=TEXT_PRIMARY,
        leading=10,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="TableCellCenter",
        fontSize=8.5,
        textColor=TEXT_PRIMARY,
        leading=10,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="TotalCardLabel",
        fontSize=9,
        textColor=TEXT_SECONDARY,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="TotalCardLabelBold",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="TotalCardValue",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        alignment=TA_RIGHT,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="TotalCardValueBold",
        fontSize=9,
        textColor=TEXT_PRIMARY,
        fontName="Helvetica-Bold",
        alignment=TA_RIGHT,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="GrandTotalLabel",
        fontSize=10.5,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        leading=13,
    ))
    styles.add(ParagraphStyle(
        name="GrandTotalValue",
        fontSize=14,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        leading=16,
        alignment=TA_RIGHT,
    ))
    return styles


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def fmt(amount):
    if amount is None:
        return "0,00 $"
    return f"{amount:,.2f} $".replace(",", " ").replace(".", ",").replace(" ", " ")


def fmt_num(val):
    if val is None:
        return "0,00"
    return f"{val:.2f}".replace(".", ",")


def section_header(text, styles, width=7.5 * inch):
    data = [[Paragraph(text, styles["SectionTitle"])]]
    t = Table(data, colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, -1), WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROUNDEDCORNERS", [4, 4, 0, 0]),
    ]))
    return t


def _get_logo_image(max_width=1.6 * inch, max_height=0.6 * inch):
    """Try to load the logo, return Image or None."""
    try:
        if LOGO_PATH.exists():
            return Image(str(LOGO_PATH), width=max_width, height=max_height, kind='proportional')
    except Exception as e:
        logger.warning(f"Could not load logo: {e}")
    return None


def _safe_text(value, default=""):
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _fmt_date_value(value):
    if not value:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%d/%m/%Y")
    text = str(value)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return f"{text[8:10]}/{text[5:7]}/{text[0:4]}"
    return text


def _fmt_pause(value):
    if value in (None, ""):
        return "0 min"
    try:
        pause = float(value)
        # Older invoices stored schedule pause hours directly in pause_min.
        if 0 < pause < 4 and not pause.is_integer():
            pause *= 60
        if pause.is_integer():
            return f"{int(pause)} min"
        return f"{pause:.0f} min"
    except (TypeError, ValueError):
        return _safe_text(value, "0 min")


def _build_paragraph(text, style, fallback="&nbsp;"):
    safe = escape(_safe_text(text, ""))
    safe = safe.replace("\n", "<br/>")
    return Paragraph(safe or fallback, style)


def _scale_widths(raw_widths, total_width):
    total = sum(raw_widths) or 1
    factor = total_width / total
    return [width * factor for width in raw_widths]


def _build_info_card(title, primary_line, secondary_lines, width, styles):
    rows = [[_build_paragraph(title.upper(), styles["CardTitle"])]]
    rows.append([_build_paragraph(primary_line or "-", styles["CardPrimary"])])

    visible_lines = [line for line in secondary_lines if _safe_text(line)]
    for line in visible_lines:
        rows.append([_build_paragraph(line, styles["CardSecondary"])])

    while len(rows) < 5:
        rows.append([_build_paragraph("", styles["CardSecondary"])])

    card = Table(rows, colWidths=[width])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROUNDEDCORNERS", [8, 8, 8, 8]),
    ]))
    return card


def _build_data_table(columns, rows, styles, total_width):
    col_widths = _scale_widths([column["width"] for column in columns], total_width)
    header_row = [_build_paragraph(column["label"], styles["TableHeader"]) for column in columns]
    data = [header_row]

    for row in rows:
        table_row = []
        for column in columns:
            style_name = column.get("style", "TableCell")
            table_row.append(_build_paragraph(row.get(column["key"], ""), styles[style_name]))
        data.append(table_row)

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table_style = [
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("INNERGRID", (0, 1), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
    ]

    for idx, column in enumerate(columns):
        table_style.append(("ALIGN", (idx, 0), (idx, -1), column.get("align", "LEFT")))

    table.setStyle(TableStyle(table_style))
    return table


def _build_totals_card(invoice, styles, width):
    rows = []
    if getattr(invoice, "subtotal_services", 0):
        rows.append(("Services", fmt(invoice.subtotal_services), False))
    if getattr(invoice, "subtotal_garde", 0):
        rows.append(("Garde", fmt(invoice.subtotal_garde), False))
    if getattr(invoice, "subtotal_rappel", 0):
        rows.append(("Rappel", fmt(invoice.subtotal_rappel), False))
    if getattr(invoice, "subtotal_accom", 0):
        rows.append(("H\u00e9bergement", fmt(invoice.subtotal_accom), False))
    if getattr(invoice, "subtotal_deplacement", 0):
        rows.append(("D\u00e9placement", fmt(invoice.subtotal_deplacement), False))
    if getattr(invoice, "subtotal_km", 0):
        rows.append(("Kilom\u00e9trage", fmt(invoice.subtotal_km), False))
    if getattr(invoice, "subtotal_autres_frais", 0):
        rows.append(("Autres frais", fmt(invoice.subtotal_autres_frais), False))

    rows.append(("Sous-total", fmt(invoice.subtotal), True))

    if getattr(invoice, "include_tax", False) and getattr(invoice, "tps", 0) > 0:
        rows.append(("TPS (5 %)", fmt(invoice.tps), False))
        rows.append(("TVQ (9,975 %)", fmt(invoice.tvq), False))
    elif not getattr(invoice, "include_tax", False):
        rows.append(("Taxes", "Exempt\u00e9", False))

    data = []
    subtotal_index = None
    for idx, (label, value, is_bold) in enumerate(rows):
        if is_bold:
            subtotal_index = idx
        label_style = styles["TotalCardLabelBold"] if is_bold else styles["TotalCardLabel"]
        value_style = styles["TotalCardValueBold"] if is_bold else styles["TotalCardValue"]
        data.append([
            _build_paragraph(label, label_style),
            _build_paragraph(value, value_style),
        ])

    data.append([
        _build_paragraph("TOTAL", styles["GrandTotalLabel"]),
        _build_paragraph(fmt(invoice.total), styles["GrandTotalValue"]),
    ])

    card = Table(data, colWidths=[width * 0.56, width * 0.44])
    card_style = [
        ("BACKGROUND", (0, 0), (-1, -2), BG_LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -2), 14),
        ("RIGHTPADDING", (0, 0), (-1, -2), 14),
        ("TOPPADDING", (0, 0), (-1, -2), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -2), 5),
        ("BACKGROUND", (0, -1), (-1, -1), PRIMARY),
        ("TEXTCOLOR", (0, -1), (-1, -1), WHITE),
        ("LEFTPADDING", (0, -1), (-1, -1), 14),
        ("RIGHTPADDING", (0, -1), (-1, -1), 14),
        ("TOPPADDING", (0, -1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROUNDEDCORNERS", [8, 8, 8, 8]),
    ]
    if subtotal_index is not None:
        card_style.append(("LINEABOVE", (0, subtotal_index), (-1, subtotal_index), 0.75, BORDER))
    card.setStyle(TableStyle(card_style))
    return card


def _build_payment_card(invoice, width):
    pay_color = GREEN if getattr(invoice, "balance_due", 0) <= 0 else RED
    data = [
        ["Montant pay\u00e9", fmt(getattr(invoice, "amount_paid", 0))],
        ["Solde d\u00fb", fmt(getattr(invoice, "balance_due", 0))],
    ]
    table = Table(data, colWidths=[width * 0.56, width * 0.44])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica"),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 1), (-1, 1), pay_color),
        ("ROUNDEDCORNERS", [8, 8, 8, 8]),
    ]))
    return table


# ──────────────────────────────────────────────
# Generate Invoice PDF
# ──────────────────────────────────────────────

def _legacy_generate_invoice_pdf(invoice) -> BytesIO:
    buffer = BytesIO()
    styles = get_styles()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.75 * inch,
    )

    elements = []
    page_width = 6.8 * inch  # 8 - 0.6*2

    # ── STATUS CONFIG ──
    status_text = (invoice.status or "draft").upper()
    status_display = {
        "DRAFT": "BROUILLON",
        "VALIDATED": "VALIDÉE",
        "SENT": "ENVOYÉE",
        "PARTIALLY_PAID": "PARTIELLE",
        "PAID": "PAYÉE",
        "CANCELLED": "ANNULÉE",
    }.get(status_text, status_text)

    # ── HEADER ──
    logo_img = _get_logo_image()
    company_block = []
    if logo_img:
        company_block.append(logo_img)
        company_block.append(Spacer(1, 6))
    else:
        company_block.append(Paragraph("SOINS EXPERT PLUS", styles["CompanyName"]))

    company_block.append(_build_paragraph(COMPANY_INFO["address"], styles["CompanyDetail"]))
    if COMPANY_INFO.get("phone"):
        company_block.append(_build_paragraph(COMPANY_INFO["phone"], styles["CompanyDetail"]))
    company_block.append(_build_paragraph(COMPANY_INFO["email"], styles["CompanyDetail"]))

    # Right side: Invoice label & meta
    inv_date = invoice.date.strftime("%d/%m/%Y") if hasattr(invoice.date, "strftime") else str(invoice.date)
    period_start = invoice.period_start.strftime("%d/%m/%Y") if hasattr(invoice.period_start, "strftime") else str(invoice.period_start)
    period_end = invoice.period_end.strftime("%d/%m/%Y") if hasattr(invoice.period_end, "strftime") else str(invoice.period_end)

    right_data = [
        [Paragraph("FACTURE", styles["InvoiceLabel"]), ""],
        ["", ""],
        [Paragraph("<b>Numéro</b>", ParagraphStyle("rl", fontSize=9, textColor=TEXT_SECONDARY, alignment=TA_RIGHT)),
         Paragraph(f"<b>{invoice.number or ''}</b>", ParagraphStyle("rv", fontSize=9, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_RIGHT))],
        [Paragraph("Date", ParagraphStyle("rl2", fontSize=9, textColor=TEXT_SECONDARY, alignment=TA_RIGHT)),
         Paragraph(inv_date, ParagraphStyle("rv2", fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_RIGHT))],
        [Paragraph("Période", ParagraphStyle("rl3", fontSize=9, textColor=TEXT_SECONDARY, alignment=TA_RIGHT)),
         Paragraph(f"{period_start} — {period_end}", ParagraphStyle("rv3", fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_RIGHT))],
    ]

    if invoice.po_number:
        right_data.append([
            Paragraph("Réf. PO", ParagraphStyle("rl4", fontSize=9, textColor=TEXT_SECONDARY, alignment=TA_RIGHT)),
            Paragraph(invoice.po_number, ParagraphStyle("rv4", fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_RIGHT)),
        ])
    if invoice.due_date:
        due = invoice.due_date.strftime("%d/%m/%Y") if hasattr(invoice.due_date, "strftime") else str(invoice.due_date)
        right_data.append([
            Paragraph("Échéance", ParagraphStyle("rl5", fontSize=9, textColor=TEXT_SECONDARY, alignment=TA_RIGHT)),
            Paragraph(due, ParagraphStyle("rv5", fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_RIGHT)),
        ])

    right_table = Table(right_data, colWidths=[1.3 * inch, 1.8 * inch])
    right_table.setStyle(TableStyle([
        ("SPAN", (0, 0), (1, 0)),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))

    header_table = Table(
        [[company_block, right_table]],
        colWidths=[page_width * 0.5, page_width * 0.5],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 8))

    # ── ACCENT LINE ──
    elements.append(HRFlowable(width=page_width, thickness=2, color=PRIMARY, spaceAfter=14))

    # ── CLIENT / EMPLOYEE INFO CARDS ──
    client_content = []
    client_content.append(Paragraph("FACTURER À", styles["InfoLabel"]))
    client_content.append(Spacer(1, 4))
    client_content.append(Paragraph(f"<b>{invoice.client_name or '—'}</b>", styles["CellBold"]))
    if invoice.client_address:
        client_content.append(Paragraph(invoice.client_address, styles["CellText"]))
    if invoice.client_email:
        client_content.append(Paragraph(invoice.client_email, styles["CellText"]))
    if invoice.client_phone:
        client_content.append(Paragraph(invoice.client_phone, styles["CellText"]))

    emp_content = []
    emp_content.append(Paragraph("RESSOURCE", styles["InfoLabel"]))
    emp_content.append(Spacer(1, 4))
    emp_content.append(Paragraph(f"<b>{invoice.employee_name or '—'}</b>", styles["CellBold"]))
    if invoice.employee_title:
        emp_content.append(Paragraph(invoice.employee_title, styles["CellText"]))

    info_table = Table(
        [[client_content, emp_content]],
        colWidths=[page_width * 0.55, page_width * 0.45],
    )
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 16))

    # ── SERVICES TABLE ──
    lines = invoice.lines or []
    if lines:
        elements.append(section_header("SERVICES", styles, page_width))

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

        col_widths = [0.78 * inch, 0.62 * inch, 0.62 * inch, 0.58 * inch, 0.58 * inch, 0.72 * inch, 0.82 * inch, 0.72 * inch, 0.72 * inch]
        svc_table = Table(svc_data, colWidths=col_widths, repeatRows=1)
        svc_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 7),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("FONTSIZE", (0, 1), (-1, -1), 7),
            ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_PRIMARY),
            ("ALIGN", (4, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, PRIMARY),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        elements.append(svc_table)
        elements.append(Spacer(1, 8))

    # ── ACCOMMODATION TABLE ──
    accom_lines = invoice.accommodation_lines or []
    if accom_lines:
        elements.append(section_header("HÉBERGEMENT", styles, page_width))

        accom_data = [["Employé", "Période", "Jours", "Coût/jour", "Montant"]]
        for a in accom_lines:
            accom_data.append([
                a.get("employee", ""),
                a.get("period", ""),
                fmt_num(a.get("days", 0)),
                fmt(a.get("cost_per_day", 0)),
                fmt(a.get("amount", 0)),
            ])

        accom_table = Table(accom_data, colWidths=[1.6 * inch, 1.8 * inch, 0.9 * inch, 1.0 * inch, 1.1 * inch], repeatRows=1)
        accom_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, PRIMARY),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        elements.append(accom_table)
        elements.append(Spacer(1, 8))

    # ── EXPENSES TABLE ──
    expense_lines = invoice.expense_lines or []
    extra_lines = invoice.extra_lines or []
    all_expenses = expense_lines + extra_lines

    if all_expenses:
        elements.append(section_header("FRAIS", styles, page_width))

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
            quantity = e.get("quantity", e.get("hours_delta", 1))
            exp_data.append([
                e.get("description", "Ligne additionnelle"),
                fmt_num(quantity),
                fmt(e.get("rate", 0)),
                fmt(e.get("amount", 0)),
            ])

        exp_table = Table(exp_data, colWidths=[3.2 * inch, 1.1 * inch, 1.1 * inch, 1.1 * inch], repeatRows=1)
        exp_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, PRIMARY),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        elements.append(exp_table)
        elements.append(Spacer(1, 8))

    # ── TOTALS SECTION ──
    elements.append(Spacer(1, 12))

    totals_data = []
    if invoice.subtotal_services:
        totals_data.append(["Services", fmt(invoice.subtotal_services)])
    if invoice.subtotal_garde:
        totals_data.append(["Garde", fmt(invoice.subtotal_garde)])
    if invoice.subtotal_rappel:
        totals_data.append(["Rappel", fmt(invoice.subtotal_rappel)])
    if invoice.subtotal_accom:
        totals_data.append(["Hébergement", fmt(invoice.subtotal_accom)])
    if invoice.subtotal_deplacement:
        totals_data.append(["Déplacement", fmt(invoice.subtotal_deplacement)])
    if invoice.subtotal_km:
        totals_data.append(["Kilométrage", fmt(invoice.subtotal_km)])
    if invoice.subtotal_autres_frais:
        totals_data.append(["Autres frais", fmt(invoice.subtotal_autres_frais)])

    totals_data.append(["", ""])
    totals_data.append(["SOUS-TOTAL", fmt(invoice.subtotal)])

    if invoice.include_tax and invoice.tps > 0:
        totals_data.append([f"TPS (5%)", fmt(invoice.tps)])
        totals_data.append([f"TVQ (9,975%)", fmt(invoice.tvq)])
    elif not invoice.include_tax:
        totals_data.append(["Taxes", "Exempté"])

    totals_right = Table(totals_data, colWidths=[2.2 * inch, 1.4 * inch])
    totals_right.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_PRIMARY),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), BG_LIGHT),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))

    totals_layout = Table(
        [["", totals_right]],
        colWidths=[page_width - 3.8 * inch, 3.8 * inch],
    )
    totals_layout.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(totals_layout)

    # ── GRAND TOTAL BAR ──
    elements.append(Spacer(1, 8))
    grand_data = [[
        Paragraph("TOTAL", ParagraphStyle("gt_l", fontSize=13, textColor=WHITE, fontName="Helvetica-Bold", alignment=TA_RIGHT)),
        Paragraph(fmt(invoice.total), ParagraphStyle("gt_r", fontSize=14, textColor=WHITE, fontName="Helvetica-Bold", alignment=TA_RIGHT)),
    ]]
    grand_table = Table(grand_data, colWidths=[page_width - 2.2 * inch, 2.2 * inch])
    grand_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PRIMARY),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    elements.append(grand_table)

    # ── PAYMENT INFO ──
    if invoice.amount_paid > 0:
        elements.append(Spacer(1, 10))
        pay_data = [
            ["Montant payé", fmt(invoice.amount_paid)],
            ["SOLDE DÛ", fmt(invoice.balance_due)],
        ]
        pay_table = Table(pay_data, colWidths=[page_width - 2.2 * inch, 2.2 * inch])
        pay_color = GREEN if invoice.balance_due <= 0 else RED
        pay_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (1, 0), 9),
            ("FONTSIZE", (0, 1), (1, 1), 12),
            ("TEXTCOLOR", (0, 1), (1, 1), pay_color),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ]))
        elements.append(pay_table)

    # ── NOTES ──
    if invoice.notes:
        elements.append(Spacer(1, 16))
        elements.append(section_header("NOTES", styles, page_width))
        elements.append(Spacer(1, 4))
        notes_table = Table([[Paragraph(invoice.notes, styles["CellText"])]], colWidths=[page_width])
        notes_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BG_LIGHT),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        elements.append(notes_table)

    # ── FOOTER ──
    elements.append(Spacer(1, 30))
    elements.append(HRFlowable(width=page_width, thickness=0.5, color=BORDER))
    elements.append(Spacer(1, 6))
    legacy_footer_parts = [
        "Soins Expert Plus",
        COMPANY_INFO["address"].replace("\n", "  •  "),
        COMPANY_INFO.get("email", ""),
        COMPANY_INFO.get("phone", ""),
    ]
    elements.append(Paragraph(
        "  •  ".join([part for part in legacy_footer_parts if part]),
        styles["Footer"]
    ))
    elements.append(Paragraph(
        f"TPS: {COMPANY_INFO['tps_number']}  •  TVQ: {COMPANY_INFO['tvq_number']}",
        styles["Footer"]
    ))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        "Merci de votre confiance. Paiement attendu dans les 30 jours suivant la réception de la facture.",
        styles["Footer"]
    ))

    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    return buffer


# ──────────────────────────────────────────────
# Generate Credit Note PDF
# ──────────────────────────────────────────────

def generate_invoice_pdf(invoice) -> BytesIO:
    buffer = BytesIO()
    styles = get_styles()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.75 * inch,
    )

    elements = []
    page_width = doc.width
    left_col_width = page_width * 0.56
    right_col_width = page_width - left_col_width

    def _has_amount(value):
        try:
            return float(value or 0) != 0
        except (TypeError, ValueError):
            return bool(_safe_text(value))

    status_text = _safe_text(getattr(invoice, "status", "draft"), "draft").upper()
    status_display = {
        "DRAFT": "BROUILLON",
        "VALIDATED": "VALID\u00c9E",
        "SENT": "ENVOY\u00c9E",
        "PARTIALLY_PAID": "PARTIELLEMENT PAY\u00c9E",
        "PAID": "PAY\u00c9E",
        "CANCELLED": "ANNUL\u00c9E",
    }.get(status_text, status_text or "BROUILLON")

    invoice_date = _fmt_date_value(getattr(invoice, "date", None)) or "-"
    period_parts = [
        part
        for part in [
            _fmt_date_value(getattr(invoice, "period_start", None)),
            _fmt_date_value(getattr(invoice, "period_end", None)),
        ]
        if part
    ]
    period_text = " au ".join(period_parts) or "-"

    company_block = []
    logo_img = _get_logo_image(max_width=1.85 * inch, max_height=0.72 * inch)
    if logo_img:
        company_block.append(logo_img)
        company_block.append(Spacer(1, 8))
    else:
        company_block.append(
            Paragraph(
                _safe_text(COMPANY_INFO.get("name"), "Soins Expert Plus"),
                styles["CompanyName"],
            )
        )

    company_legal = _safe_text(COMPANY_INFO.get("legal"))
    company_address = _safe_text(COMPANY_INFO.get("address"))
    company_phone = _safe_text(COMPANY_INFO.get("phone"))
    company_email = _safe_text(COMPANY_INFO.get("email"))

    if company_legal:
        company_block.append(_build_paragraph(company_legal, styles["CompanyDetail"]))
    if company_address:
        company_block.append(_build_paragraph(company_address, styles["CompanyDetail"]))
    if company_phone:
        company_block.append(_build_paragraph(company_phone, styles["CompanyDetail"]))
    if company_email:
        company_block.append(_build_paragraph(company_email, styles["CompanyDetail"]))

    meta_pairs = [
        ("Num\u00e9ro", _safe_text(getattr(invoice, "number", None), "-")),
        ("Date", invoice_date),
        ("P\u00e9riode", period_text),
        ("Statut", status_display),
    ]

    po_number = _safe_text(getattr(invoice, "po_number", None))
    if po_number:
        meta_pairs.append(("R\u00e9f. PO", po_number))

    due_date = _fmt_date_value(getattr(invoice, "due_date", None))
    if due_date:
        meta_pairs.append(("\u00c9ch\u00e9ance", due_date))

    meta_label_width = min(0.95 * inch, right_col_width * 0.34)
    meta_rows = [
        [
            _build_paragraph(label, styles["MetaLabel"]),
            _build_paragraph(value, styles["MetaValue"]),
        ]
        for label, value in meta_pairs
    ]
    meta_table = Table(
        meta_rows,
        colWidths=[meta_label_width, right_col_width - meta_label_width],
    )
    meta_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    right_block = [
        Paragraph("FACTURE", styles["InvoiceLabel"]),
        Spacer(1, 10),
        meta_table,
    ]

    header_table = Table(
        [[company_block, right_block]],
        colWidths=[left_col_width, right_col_width],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width=page_width, thickness=2, color=PRIMARY, spaceAfter=16))

    card_gap = 0.16 * inch
    card_width = (page_width - card_gap) / 2
    client_card = _build_info_card(
        "Facturer \u00e0",
        _safe_text(getattr(invoice, "client_name", None), "-"),
        [
            _safe_text(getattr(invoice, "client_address", None)),
            _safe_text(getattr(invoice, "client_email", None)),
            _safe_text(getattr(invoice, "client_phone", None)),
        ],
        card_width,
        styles,
    )
    resource_card = _build_info_card(
        "Ressource factur\u00e9e",
        _safe_text(getattr(invoice, "employee_name", None), "-"),
        [
            _safe_text(getattr(invoice, "employee_title", None)),
        ],
        card_width,
        styles,
    )

    info_table = Table(
        [[client_card, Spacer(card_gap, 1), resource_card]],
        colWidths=[card_width, card_gap, card_width],
    )
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (1, 0), (1, 0), WHITE),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 18))

    lines = getattr(invoice, "lines", None) or []
    if lines:
        any_garde = any(_has_amount(line.get("garde_amount")) for line in lines)
        any_rappel = any(_has_amount(line.get("rappel_amount")) for line in lines)

        service_columns = [
            {"key": "date", "label": "Date", "width": 1.15, "style": "TableCell"},
            {"key": "schedule", "label": "Horaire", "width": 1.2, "style": "TableCellCenter", "align": "CENTER"},
            {"key": "pause", "label": "Pause", "width": 0.78, "style": "TableCellCenter", "align": "CENTER"},
            {"key": "hours", "label": "Heures", "width": 0.8, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "rate", "label": "Taux", "width": 0.96, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "service_amount", "label": "Services", "width": 1.04, "style": "TableCellRight", "align": "RIGHT"},
        ]
        if any_garde:
            service_columns.append({"key": "garde_amount", "label": "Garde", "width": 0.96, "style": "TableCellRight", "align": "RIGHT"})
        if any_rappel:
            service_columns.append({"key": "rappel_amount", "label": "Rappel", "width": 0.96, "style": "TableCellRight", "align": "RIGHT"})

        service_rows = []
        for line in lines:
            start_time = _safe_text(line.get("start"))
            end_time = _safe_text(line.get("end"))
            if start_time and end_time:
                schedule = f"{start_time} - {end_time}"
            else:
                schedule = start_time or end_time or "-"

            row = {
                "date": _fmt_date_value(line.get("date")) or "-",
                "schedule": schedule,
                "pause": _fmt_pause(line.get("pause_min")),
                "hours": fmt_num(line.get("hours", 0)),
                "rate": fmt(line.get("rate", 0)),
                "service_amount": fmt(line.get("service_amount", 0)),
            }
            if any_garde:
                row["garde_amount"] = fmt(line.get("garde_amount", 0)) if _has_amount(line.get("garde_amount")) else "-"
            if any_rappel:
                row["rappel_amount"] = fmt(line.get("rappel_amount", 0)) if _has_amount(line.get("rappel_amount")) else "-"
            service_rows.append(row)

        elements.append(section_header("SERVICES", styles, page_width))
        elements.append(_build_data_table(service_columns, service_rows, styles, page_width))
        elements.append(Spacer(1, 10))

    accommodation_lines = getattr(invoice, "accommodation_lines", None) or []
    if accommodation_lines:
        accommodation_columns = [
            {"key": "employee", "label": "Employ\u00e9", "width": 1.45, "style": "TableCell"},
            {"key": "period", "label": "P\u00e9riode", "width": 1.8, "style": "TableCell"},
            {"key": "days", "label": "Jours", "width": 0.75, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "cost_per_day", "label": "Co\u00fbt / jour", "width": 1.0, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "amount", "label": "Montant", "width": 1.05, "style": "TableCellRight", "align": "RIGHT"},
        ]
        accommodation_rows = [
            {
                "employee": _safe_text(line.get("employee"), "-"),
                "period": _safe_text(line.get("period"), "-"),
                "days": fmt_num(line.get("days", 0)),
                "cost_per_day": fmt(line.get("cost_per_day", 0)),
                "amount": fmt(line.get("amount", 0)),
            }
            for line in accommodation_lines
        ]

        elements.append(section_header("H\u00c9BERGEMENT", styles, page_width))
        elements.append(_build_data_table(accommodation_columns, accommodation_rows, styles, page_width))
        elements.append(Spacer(1, 10))

    expense_lines = getattr(invoice, "expense_lines", None) or []
    extra_lines = getattr(invoice, "extra_lines", None) or []
    if expense_lines or extra_lines:
        expense_columns = [
            {"key": "description", "label": "Description", "width": 2.95, "style": "TableCell"},
            {"key": "quantity", "label": "Quantit\u00e9", "width": 0.9, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "rate", "label": "Taux", "width": 1.0, "style": "TableCellRight", "align": "RIGHT"},
            {"key": "amount", "label": "Montant", "width": 1.0, "style": "TableCellRight", "align": "RIGHT"},
        ]
        expense_rows = []
        for line in expense_lines:
            expense_type = _safe_text(line.get("type"))
            description = _safe_text(line.get("description"))
            if expense_type == "km":
                description = description or "Kilom\u00e9trage"
            elif expense_type == "deplacement":
                description = description or "D\u00e9placement"
            else:
                description = description or "Frais"

            expense_rows.append({
                "description": description,
                "quantity": fmt_num(line.get("quantity", 0)),
                "rate": fmt(line.get("rate", 0)),
                "amount": fmt(line.get("amount", 0)),
            })

        for line in extra_lines:
            quantity = line.get("quantity", line.get("hours_delta", 1))
            expense_rows.append({
                "description": _safe_text(line.get("description"), "Ligne additionnelle"),
                "quantity": fmt_num(quantity),
                "rate": fmt(line.get("rate", 0)),
                "amount": fmt(line.get("amount", 0)),
            })

        elements.append(section_header("FRAIS", styles, page_width))
        elements.append(_build_data_table(expense_columns, expense_rows, styles, page_width))
        elements.append(Spacer(1, 14))

    totals_card_width = page_width * 0.47
    totals_layout = Table(
        [[Spacer(1, 1), _build_totals_card(invoice, styles, totals_card_width)]],
        colWidths=[page_width - totals_card_width, totals_card_width],
    )
    totals_layout.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(totals_layout)

    if getattr(invoice, "amount_paid", 0) > 0:
        elements.append(Spacer(1, 10))
        payment_layout = Table(
            [[Spacer(1, 1), _build_payment_card(invoice, totals_card_width)]],
            colWidths=[page_width - totals_card_width, totals_card_width],
        )
        payment_layout.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(payment_layout)

    notes = _safe_text(getattr(invoice, "notes", None))
    if notes:
        elements.append(Spacer(1, 18))
        elements.append(section_header("NOTES", styles, page_width))
        notes_table = Table(
            [[_build_paragraph(notes, styles["TableCell"])]],
            colWidths=[page_width],
        )
        notes_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BG_LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ("ROUNDEDCORNERS", [8, 8, 8, 8]),
        ]))
        elements.append(notes_table)

    elements.append(Spacer(1, 28))
    elements.append(HRFlowable(width=page_width, thickness=0.5, color=BORDER))
    elements.append(Spacer(1, 7))

    company_name = _safe_text(COMPANY_INFO.get("name"), "Soins Expert Plus")
    footer_identity = company_name
    if company_legal:
        footer_identity = f"{company_name} | {company_legal}"

    footer_contact_parts = [
        part
        for part in [company_address.replace("\n", " | ") if company_address else "", company_email, company_phone]
        if part
    ]
    footer_contact = " | ".join(footer_contact_parts)

    elements.append(Paragraph(footer_identity, styles["Footer"]))
    if footer_contact:
        elements.append(Paragraph(footer_contact, styles["Footer"]))
    elements.append(Paragraph(
        f"TPS : {_safe_text(COMPANY_INFO.get('tps_number'), '-')} | TVQ : {_safe_text(COMPANY_INFO.get('tvq_number'), '-')}",
        styles["Footer"],
    ))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        "Merci de votre confiance. Paiement attendu dans les 30 jours suivant la r\u00e9ception de la facture.",
        styles["Footer"],
    ))

    doc.build(elements)
    buffer.seek(0)
    return buffer


def generate_credit_note_pdf(credit_note) -> BytesIO:
    buffer = BytesIO()
    styles = get_styles()

    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.75 * inch,
    )

    elements = []
    page_width = 6.8 * inch

    # Header with logo
    logo_img = _get_logo_image()
    if logo_img:
        elements.append(logo_img)
        elements.append(Spacer(1, 6))
    else:
        elements.append(Paragraph("SOINS EXPERT PLUS", styles["CompanyName"]))

    elements.append(Spacer(1, 8))
    elements.append(HRFlowable(width=page_width, thickness=2, color=RED))
    elements.append(Spacer(1, 10))

    # Credit note info
    cn_date = credit_note.date.strftime("%d/%m/%Y") if hasattr(credit_note.date, "strftime") else str(credit_note.date)
    info_data = [
        ["NOTE DE CRÉDIT", ""],
        ["Numéro:", credit_note.number],
        ["Date:", cn_date],
        ["Client:", credit_note.client_name or ""],
        ["Facture réf.:", credit_note.invoice_number or ""],
    ]
    info_table = Table(info_data, colWidths=[1.5 * inch, 4 * inch])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (1, 0), 18),
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
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(credit_note.reason or "", styles["CellText"]))
    elements.append(Spacer(1, 16))

    # Amounts
    totals_data = [
        ["Montant:", fmt(credit_note.amount)],
    ]
    if credit_note.include_tax and credit_note.tps > 0:
        totals_data.append(["TPS (5%):", fmt(credit_note.tps)])
        totals_data.append(["TVQ (9,975%):", fmt(credit_note.tvq)])
    totals_data.append(["TOTAL CRÉDIT:", fmt(credit_note.total)])

    totals_table = Table(totals_data, colWidths=[4 * inch, 2 * inch])
    totals_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 14),
        ("TEXTCOLOR", (0, -1), (-1, -1), RED),
        ("LINEABOVE", (0, -1), (-1, -1), 1, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(totals_table)

    # Footer
    elements.append(Spacer(1, 40))
    elements.append(HRFlowable(width=page_width, thickness=0.5, color=BORDER))
    elements.append(Spacer(1, 6))
    legacy_footer_parts = [
        "Soins Expert Plus",
        COMPANY_INFO["address"].replace("\n", "  •  "),
        COMPANY_INFO.get("email", ""),
        COMPANY_INFO.get("phone", ""),
    ]
    elements.append(Paragraph(
        "  •  ".join([part for part in legacy_footer_parts if part]),
        styles["Footer"]
    ))

    doc.build(elements)
    buffer.seek(0)
    return buffer
