#!/usr/bin/env python3
"""Builds the blank weekly stock sheet: public/Glizz-Lounge-Stock-Sheet.xlsx

Run from the repo root:   python3 tools/make_stock_sheet.py
Needs:                    pip install openpyxl

The drink list comes from tools/stock_sheet_products.json (category -> items, in sheet order).
To add or remove a drink from the template, edit that file and run this script again.

Sheet "Stock sheet" layout (the app's upload reads columns A to D of this sheet, so keep them in place):
  A Category   B Product   C Price (KES, optional)   D Opening stock (first stock take / start of week)
  then, for each day Mon..Sun, six columns:
  Opening | Issued | Sold | Expected | Count 8am | Variance
  and three week totals at the end.
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS = ROOT / "tools" / "stock_sheet_products.json"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public" / "Glizz-Lounge-Stock-Sheet.xlsx"

SHEET = "Stock sheet"
HOWTO = "How to use"
FIRST_ROW = 6                      # first product row (rows 1-5 are headers)
HEADER_ROW = 5
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_COLS = ["Opening", "Issued", "Sold", "Expected", "Count 8am", "Variance"]
FIRST_DAY_COL = 5                  # column E
BLOCK = len(DAY_COLS)

FONT = "Arial"
f = lambda **kw: Font(name=FONT, size=kw.pop("size", 10), **kw)
fill = lambda hex_: PatternFill("solid", start_color=hex_, end_color=hex_)
INPUT = fill("FFF2CC")             # yellow: type here
CALC = fill("EDEDED")              # grey: works itself out
NAVY = fill("1F3864")
BAND = [fill("2F5597"), fill("1F3864")]
thin = Side(style="thin", color="BFBFBF")
med = Side(style="medium", color="404040")
grid = Border(left=thin, right=thin, top=thin, bottom=thin)


def day_col(day: int, part: str) -> int:
    return FIRST_DAY_COL + day * BLOCK + DAY_COLS.index(part)


def build() -> Workbook:
    cats = json.loads(PRODUCTS.read_text())
    rows = [(c["category"], name) for c in cats for name in c["items"]]
    last = FIRST_ROW + len(rows) - 1
    week_col = FIRST_DAY_COL + 7 * BLOCK            # first of the three week-total columns
    total_cols = week_col + 2

    wb = Workbook()
    ws = wb.active
    ws.title = SHEET

    # ───── title and week start ─────
    ws["A1"] = "THE GLIZZ LOUNGE — STOCK SHEET"
    ws["A1"].font = f(size=16, bold=True, color="1F3864")
    ws["A2"] = "Week starting (Monday):"
    ws["A2"].font = f(bold=True)
    ws["D2"].fill = INPUT
    ws["D2"].number_format = "dd-mmm-yyyy"
    ws["D2"].border = grid
    ws["D2"].font = f(bold=True)
    ws["E2"] = "Counted by:"
    ws["E2"].font = f(bold=True)
    ws["E2"].alignment = Alignment(horizontal="right")
    ws.merge_cells("E2:F2")
    for c in range(7, 11):
        ws.cell(row=2, column=c).fill = INPUT
        ws.cell(row=2, column=c).border = grid
    ws.merge_cells(start_row=2, start_column=7, end_row=2, end_column=10)
    ws["A3"] = ("Yellow cells = type here.  Grey cells = work themselves out.  "
                "Each day's Count is taken at 8am and becomes the next day's Opening.")
    ws["A3"].font = f(italic=True, color="595959")

    # ───── header rows (4 = day bands, 5 = column names) ─────
    for col, text in enumerate(["Category", "Product", "Price (KES)", "Opening stock"], start=1):
        c = ws.cell(row=HEADER_ROW, column=col, value=text)
        c.font = f(bold=True, color="FFFFFF")
        c.fill = NAVY
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = grid
    for d in range(7):
        c0 = day_col(d, "Opening")
        band = ws.cell(row=4, column=c0,
                       value=f'=IF($D$2="","{DAYS[d].upper()}",TEXT($D$2+{d},"ddd d mmm"))')
        band.font = f(bold=True, color="FFFFFF", size=11)
        band.alignment = Alignment(horizontal="center")
        for k in range(BLOCK):
            ws.cell(row=4, column=c0 + k).fill = BAND[d % 2]
            h = ws.cell(row=HEADER_ROW, column=c0 + k, value=DAY_COLS[k])
            h.font = f(bold=True, color="FFFFFF")
            h.fill = BAND[d % 2]
            h.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            h.border = grid
        ws.merge_cells(start_row=4, start_column=c0, end_row=4, end_column=c0 + BLOCK - 1)
    wk = ws.cell(row=4, column=week_col, value="WEEK TOTAL")
    wk.font = f(bold=True, color="FFFFFF", size=11)
    wk.alignment = Alignment(horizontal="center")
    for k, text in enumerate(["Issued", "Sold", "Variance"]):
        ws.cell(row=4, column=week_col + k).fill = NAVY
        h = ws.cell(row=HEADER_ROW, column=week_col + k, value=text)
        h.font = f(bold=True, color="FFFFFF")
        h.fill = NAVY
        h.alignment = Alignment(horizontal="center", vertical="center")
        h.border = grid
    ws.merge_cells(start_row=4, start_column=week_col, end_row=4, end_column=week_col + 2)
    ws.row_dimensions[HEADER_ROW].height = 30

    # ───── product rows ─────
    prev_cat = None
    for i, (cat, name) in enumerate(rows):
        r = FIRST_ROW + i
        top = med if cat != prev_cat else thin
        prev_cat = cat
        a = ws.cell(row=r, column=1, value=cat)
        a.font = f(bold=True, size=9, color="404040")
        b = ws.cell(row=r, column=2, value=name)
        b.font = f()
        price = ws.cell(row=r, column=3)
        price.fill = INPUT
        price.number_format = "#,##0"
        opening = ws.cell(row=r, column=4)
        opening.fill = INPUT
        opening.number_format = "0.##"
        for col in range(1, 5):
            c = ws.cell(row=r, column=col)
            c.border = Border(left=thin, right=thin, bottom=thin, top=top)

        for d in range(7):
            o, iss, sold, exp, cnt, var = (day_col(d, p) for p in DAY_COLS)
            O, I, S, E, C, V = (f"{L(x)}{r}" for x in (o, iss, sold, exp, cnt, var))
            if d == 0:
                ws.cell(row=r, column=o, value=f'=IF($D{r}="","",$D{r})')
            else:
                prev_count = f"{L(day_col(d - 1, 'Count 8am'))}{r}"
                ws.cell(row=r, column=o, value=f'=IF({prev_count}="","",{prev_count})')
            ws.cell(row=r, column=exp, value=f'=IF(AND({O}="",{I}="",{S}=""),"",N({O})+N({I})-N({S}))')
            ws.cell(row=r, column=var, value=f'=IF({C}="","",{C}-N({E}))')
            for col in (o, exp, var):
                ws.cell(row=r, column=col).fill = CALC
            for col in (iss, sold, cnt):
                ws.cell(row=r, column=col).fill = INPUT
            for col in range(o, o + BLOCK):
                c = ws.cell(row=r, column=col)
                c.number_format = "0.##;-0.##;0"
                c.font = f(bold=(col == cnt))
                c.alignment = Alignment(horizontal="center")
                c.border = Border(left=thin, right=thin, bottom=thin, top=top)

        for k, part in enumerate(["Issued", "Sold", "Variance"]):
            refs = ",".join(f"{L(day_col(d, part))}{r}" for d in range(7))
            c = ws.cell(row=r, column=week_col + k, value=f'=IF(COUNT({refs})=0,"",SUM({refs}))')
            c.fill = CALC
            c.number_format = "0.##;-0.##;0"
            c.font = f(bold=True)
            c.alignment = Alignment(horizontal="center")
            c.border = Border(left=thin, right=thin, bottom=thin, top=top)

    # ───── variance highlighting: red = short, amber = over ─────
    red = PatternFill("solid", start_color="F8CBAD", end_color="F8CBAD")
    amber = PatternFill("solid", start_color="FFE699", end_color="FFE699")
    var_cols = [day_col(d, "Variance") for d in range(7)] + [week_col + 2]
    for col in var_cols:
        top_left = f"{L(col)}{FIRST_ROW}"
        rng = f"{top_left}:{L(col)}{last}"
        ws.conditional_formatting.add(rng, FormulaRule(
            formula=[f"AND(ISNUMBER({top_left}),{top_left}<0)"], fill=red, font=Font(name=FONT, color="9C0006", bold=True)))
        ws.conditional_formatting.add(rng, FormulaRule(
            formula=[f"AND(ISNUMBER({top_left}),{top_left}>0)"], fill=amber, font=Font(name=FONT, color="7F6000", bold=True)))

    # ───── input checks: numbers only, zero or more ─────
    def numbers_only(cols):
        dv = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                            showErrorMessage=True, errorTitle="Numbers only",
                            error="Type a number, 0 or more. Leave the cell empty if there is nothing to enter.")
        for c in cols:
            dv.add(f"{L(c)}{FIRST_ROW}:{L(c)}{last}")
        ws.add_data_validation(dv)

    numbers_only([3, 4] + [day_col(d, p) for d in range(7) for p in ("Issued", "Sold", "Count 8am")])
    dv_date = DataValidation(type="date", operator="greaterThan", formula1="36526", allow_blank=True,
                             showErrorMessage=True, errorTitle="Date", error="Type the Monday date, e.g. 02/11/2026.")
    dv_date.add("D2")
    ws.add_data_validation(dv_date)

    # ───── sizing, freeze, filter, print ─────
    for col, w in {1: 14, 2: 34, 3: 10, 4: 11}.items():
        ws.column_dimensions[L(col)].width = w
    for d in range(7):
        for part, w in zip(DAY_COLS, (9, 8, 8, 9, 10, 9)):
            ws.column_dimensions[L(day_col(d, part))].width = w
    for k in range(3):
        ws.column_dimensions[L(week_col + k)].width = 10
    ws.freeze_panes = ws.cell(row=FIRST_ROW, column=FIRST_DAY_COL)
    ws.auto_filter.ref = f"A{HEADER_ROW}:{L(total_cols)}{last}"
    ws.sheet_view.zoomScale = 90
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.print_title_rows = f"1:{HEADER_ROW}"
    ws.print_title_cols = "A:B"

    # ───── How to use ─────
    h = wb.create_sheet(HOWTO)
    h.sheet_view.showGridLines = False
    h.column_dimensions["A"].width = 3
    h.column_dimensions["B"].width = 20
    for col in "CDEFGH":
        h.column_dimensions[col].width = 14
    h.column_dimensions["I"].width = 40
    lines = [
        ("THE GLIZZ LOUNGE — how to use the stock sheet", "title"),
        ("", None),
        ("FIRST STOCK TAKE (done once)", "head"),
        ("1.  Count every drink on the counter. Type the number in the yellow 'Opening stock' column (D) of the 'Stock sheet' tab. Leave it empty if you have none.", None),
        ("2.  Do not rename the columns or the tab. To remove a drink you do not sell, delete its row. To add a drink, type it in a new row at the bottom with its Category.", None),
        ("3.  'Price (KES)' is optional and is only used for NEW drinks. Drinks without a price stay hidden from waiters until you set one in Products & prices.", None),
        ("4.  Save the file, then in the app open Stock sheet > Upload filled sheet. Check the preview and press Load. A drink that already has opening stock in the system is skipped.", None),
        ("", None),
        ("EVERY DAY AT 8 AM", "head"),
        ("1.  Type the Monday date once at the top (cell D2). The day headings fill in by themselves.", None),
        ("2.  Issued = what was issued to the counter since the last count.   Sold = what the POS sold since the last count (take it from the POS sales report).", None),
        ("3.  Count 8am = what you physically count. Then Variance = Count - Expected, where Expected = Opening + Issued - Sold.", None),
        ("4.  Red variance = short. Amber variance = over. Empty = not counted yet. Tomorrow's Opening is today's Count automatically.", None),
        ("5.  New week: save a copy, copy Sunday's Count column and Paste Special > Values into 'Opening stock' (column D), then clear Issued, Sold and Count.", None),
        ("", None),
        ("EXAMPLE ONLY (this is not in your data)", "head"),
    ]
    for i, (text, kind) in enumerate(lines, start=1):
        c = h.cell(row=i, column=2, value=text)
        c.font = f(size=16, bold=True, color="1F3864") if kind == "title" else f(bold=(kind == "head"), color="1F3864" if kind == "head" else "000000")
    ex = len(lines) + 1
    for col, text in enumerate(["Drink", "Opening", "Issued", "Sold", "Expected", "Count 8am", "Variance"], start=2):
        c = h.cell(row=ex, column=col, value=text)
        c.font = f(bold=True, color="FFFFFF")
        c.fill = NAVY
        c.alignment = Alignment(horizontal="center")
    sample = ["TUSKER LAGER", 24, 12, 20, f"=C{ex+1}+D{ex+1}-E{ex+1}", 15, f"=G{ex+1}-F{ex+1}"]
    for col, v in enumerate(sample, start=2):
        c = h.cell(row=ex + 1, column=col, value=v)
        c.font = f()
        c.alignment = Alignment(horizontal="center" if col > 2 else "left")
        c.border = grid
    h.cell(row=ex + 2, column=2,
           value="24 opening + 12 issued - 20 sold = 16 expected. Counted 15, so the variance is -1 (one bottle short).").font = f(italic=True, color="595959")

    wb.calculation.fullCalcOnLoad = True
    wb.properties.creator = "The Glizz Lounge POS"
    wb.properties.title = "Stock sheet"
    return wb


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    build().save(OUT)
    print("wrote", OUT)
