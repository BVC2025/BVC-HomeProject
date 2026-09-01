"""
Supplier Purchase Order PDF (spec Parts 15/16) — visually modeled on the
user-supplied "Purchase Order_Sendka Belting & Conveyors.pdf" reference:
company header, an "Order To" / "Order Details" two-column block, a
product table (#/Item/HSN-SAC/Qty/Unit/Price-per-Unit/Amount), an
Amounts summary, Amount in Words, Terms and Conditions, and an
Authorized Signatory line.

Reuses the exact same @page/print-CSS + xhtml2pdf rendering pipeline
already established for customer quotations (project_quotation_service.
render_quotation_pdf_bytes) so this new document family visually matches
the rest of the app's PDFs, and payslip_pdf_service.amount_in_words()
for the "Amount in Words" line (same helper the payslip PDF already
uses).

Deliberate deviation from the spec's literal Amounts-summary list: there
is no Advance/Balance concept anywhere on PurchaseOrder (unlike customer
quotations, which do track an advance) — a supplier PO has no partial-
payment field in this schema, so the summary below shows Sub Total /
Discount / GST / Grand Total only. Adding an unused Advance/Balance
column purely to match the visual reference would be scope creep with
no real data behind it.
"""

import logging
from typing import Optional

from app.services.project_quotation_service import render_quotation_pdf_bytes
from app.services.payslip_pdf_service import amount_in_words
from app.services.company_settings_service import format_full_address

log = logging.getLogger(__name__)


def _inr(n) -> str:
    return "{:,.2f}".format(float(n or 0))


def build_po_pdf_html(po, supplier, lines: list, company) -> str:
    """`po`: PurchaseOrder row. `supplier`: Supplier row. `lines`: list of
    PurchaseOrderLine rows for this PO. `company`: CompanyMaster row
    (get_company_settings(db, vendor_id))."""

    company_addr = format_full_address(company)
    logo_html = f'<img src="{company.LOGO_URL}" style="height:48px; margin-bottom:6px;"/>' if company.LOGO_URL else ""

    supplier_addr = ", ".join(filter(None, [
        getattr(supplier, "ADDRESS_LINE1", None), getattr(supplier, "ADDRESS_LINE2", None),
        getattr(supplier, "CITY", None), getattr(supplier, "STATE", None), getattr(supplier, "PINCODE", None),
    ]))

    rows_html = ""
    for idx, line in enumerate(lines, start=1):
        amount = float(line.QUANTITY or 0) * float(line.UNIT_PRICE or 0)
        rows_html += f"""
        <tr>
          <td style="text-align:center;">{idx}</td>
          <td>{line.DESCRIPTION or '—'}</td>
          <td style="text-align:center;">{line.HSN_CODE or '—'}</td>
          <td style="text-align:right;">{line.QUANTITY:g}</td>
          <td style="text-align:center;">{line.UNIT or 'pcs'}</td>
          <td style="text-align:right;">{_inr(line.UNIT_PRICE)}</td>
          <td style="text-align:right; font-weight:bold;">{_inr(amount)}</td>
        </tr>
        """

    subtotal = float(po.SUBTOTAL or 0)
    discount_amount = float(po.DISCOUNT_AMOUNT or 0)
    tax_amount = float(po.TAX_AMOUNT or 0)
    grand_total = float(po.GRAND_TOTAL or 0)

    discount_row_html = ""
    if discount_amount > 0:
        discount_row_html = f"""
        <tr><td class="label">Discount ({po.DISCOUNT_PERCENT or 0:g}%)</td>
            <td style="text-align:right;">- {_inr(discount_amount)}</td></tr>
        """

    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Purchase Order {po.PO_NUMBER}</title>
<style>
  @page {{ size: A4; margin: 16mm 14mm; }}
  body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #0f172a; }}
  h1, h2, h3 {{ margin: 0; }}
  .header {{ background-color: #C8102E; color: white; padding: 14px 18px; }}
  .header h1 {{ font-size: 18pt; }}
  .header .num {{ font-size: 9pt; opacity: 0.9; }}
  table {{ width: 100%; border-collapse: collapse; }}
  .meta td {{ padding: 4px 8px; vertical-align: top; }}
  .label {{ color: #64748b; font-size: 8pt; }}
  .items th {{ background-color: #fef2f2; color: #8B0B1F; padding: 8px; text-align: left; font-size: 9pt; border-bottom: 1px solid #fecaca; }}
  .items td {{ padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }}
  .summary td {{ padding: 4px 8px; font-size: 9.5pt; }}
  .summary .label {{ color: #475569; font-size: 9.5pt; }}
  .summary .grand-total td {{ font-weight: bold; font-size: 11pt; border-top: 1px solid #0f172a; padding-top: 8px; }}
  .words {{ margin-top: 10px; font-size: 9pt; font-style: italic; color: #334155; }}
  .terms {{ margin-top: 16px; background-color: #f8fafc; padding: 10px 12px; border-left: 3px solid #C8102E; font-size: 9pt; white-space: pre-wrap; }}
  .signature {{ margin-top: 32px; font-size: 9.5pt; text-align: right; }}
  .footer {{ margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; text-align: center; }}
</style>
</head>
<body>
  <div class="header">
    {logo_html}
    <h1>PURCHASE ORDER</h1>
    <div class="num">{po.PO_NUMBER} &middot; {po.PO_DATE}</div>
  </div>

  <table class="meta" style="margin-top: 14px;">
    <tr>
      <td style="width: 50%;">
        <div class="label">ORDER TO</div>
        <div style="font-weight:bold;">{supplier.COMPANY_NAME or ''}</div>
        <div>{supplier_addr}</div>
        {(f"<div>GSTIN: {supplier.GST_NUMBER}</div>") if getattr(supplier, 'GST_NUMBER', None) else ''}
        {(f"<div>{supplier.PHONE}</div>") if getattr(supplier, 'PHONE', None) else ''}
      </td>
      <td style="width: 50%; text-align: right;">
        <div class="label">ORDER DETAILS</div>
        <div>PO Number: <strong>{po.PO_NUMBER}</strong></div>
        <div>PO Date: {po.PO_DATE}</div>
        <div>Expected Delivery: {po.EXPECTED_DELIVERY_DATE or '—'}</div>
        {(f"<div>Delivery Address: {po.DELIVERY_ADDRESS}</div>") if po.DELIVERY_ADDRESS else ''}
      </td>
    </tr>
  </table>

  <table class="items" style="margin-top: 18px;">
    <thead><tr>
      <th style="width:26px; text-align:center;">#</th>
      <th>Item</th>
      <th style="width:70px; text-align:center;">HSN/SAC</th>
      <th style="width:50px; text-align:right;">Qty</th>
      <th style="width:50px; text-align:center;">Unit</th>
      <th style="width:80px; text-align:right;">Price/Unit</th>
      <th style="width:90px; text-align:right;">Amount</th>
    </tr></thead>
    <tbody>{rows_html or '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No items</td></tr>'}</tbody>
  </table>

  <table class="summary" style="margin-top: 10px; width: 260px; margin-left: auto;">
    <tr><td class="label">Sub Total</td><td style="text-align:right;">{_inr(subtotal)}</td></tr>
    {discount_row_html}
    <tr><td class="label">GST ({po.TAX_PERCENT or 0:g}%)</td><td style="text-align:right;">{_inr(tax_amount)}</td></tr>
    <tr class="grand-total"><td>Total</td><td style="text-align:right;">&#8377; {_inr(grand_total)}</td></tr>
  </table>

  <div class="words">Amount in words: {amount_in_words(grand_total).capitalize()}</div>

  {(f'<div class="terms"><strong>Terms and Conditions</strong><br/>{po.TERMS_AND_CONDITIONS}</div>') if po.TERMS_AND_CONDITIONS else ''}

  <div class="signature">
    <p>For {company.LEGAL_NAME or ''},</p>
    <p style="margin-top:36px; font-weight:bold;">Authorized Signatory</p>
  </div>

  <div class="footer">{company.LEGAL_NAME or ''} &middot; {company_addr}</div>
</body>
</html>
"""


def render_po_pdf_bytes(po, supplier, lines: list, company) -> tuple[Optional[bytes], Optional[str]]:
    html = build_po_pdf_html(po, supplier, lines, company)
    return render_quotation_pdf_bytes(html)
