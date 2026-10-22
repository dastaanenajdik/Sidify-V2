#!/usr/bin/env python3
"""Build the US Buyers workbook (Lanterns & Jewellery, 5 each).

Data verified on 22 Oct 2026 against company websites / trade press.
"Buyer Name" = publicly documented head/owner of the company (category-buyer
names and direct contacts are not published publicly). Each Buyer Name cell
carries a comment with its verification source URL and check date.

Output: US_Buyers_Lanterns_and_Jewellery.xlsx in the repository root.
"""

from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PREPARED = "22 October 2026"
CHECKED = "22 Oct 2026"

HEADERS = ["Product Category", "Buyer Name", "Location", "Website", "Company Name"]

ROWS = [
    # ---- Lanterns (decorative lantern / home-décor wholesalers with lantern lines) ----
    dict(
        category="Lanterns",
        buyer="Robert Wang (Co-Founder & President)",
        location="Memphis, TN",
        website="https://www.creativecoop.com",
        company="Creative Co-Op",
        source="https://www.crunchbase.com/person/robert-wang-7753",
    ),
    dict(
        category="Lanterns",
        buyer="Karl Venvertloh (President)",
        location="Quincy, IL",
        website="https://www.melroseintl.com",
        company="Melrose International",
        source="https://melroseintl.com/karl-venvertloh-appointed-as-president-of-melrose-international/",
    ),
    dict(
        category="Lanterns",
        buyer="Michelle Gee (President)",
        location="Duluth, GA",
        website="https://www.napahomeandgarden.com",
        company="Napa Home & Garden",
        source="https://trade.napahomeandgarden.com/pages/company-profile",
    ),
    dict(
        category="Lanterns",
        buyer="John Lanman (President & CEO)",
        location="Sioux Falls, SD",
        website="https://www.sullivangift.com",
        company="Sullivans",
        source="https://www.homeaccentstoday.com/people/sullivans-taps-former-precious-moments-exec-for-ceo-spot/",
    ),
    dict(
        category="Lanterns",
        buyer="Tom Gottlieb (President)",
        location="Elmsford, NY",
        website="https://www.twoscompany.com",
        company="Two's Company",
        source="https://www.dnb.com/business-directory/company-profiles.twos_company_inc.8d129222c9f4bc696c572a4ab08070f4.html",
    ),
    # ---- Jewellery ----
    dict(
        category="Jewellery",
        buyer="Amy Jain (Co-Founder & CEO)",
        location="New York, NY",
        website="https://www.baublebar.com",
        company="BaubleBar",
        source="https://www.crunchbase.com/person/amy-jain",
    ),
    dict(
        category="Jewellery",
        buyer="Rony Vardi (Founder)",
        location="Brooklyn, NY",
        website="https://www.catbirdnyc.com",
        company="Catbird",
        source="https://www.catbirdnyc.com/facts",
    ),
    dict(
        category="Jewellery",
        buyer="Marcia Maizel-Clarke (Founder)",
        location="Culver City, CA",
        website="https://www.dogeared.com",
        company="Dogeared",
        source="https://www.dogeared.com/pages/more-than-a-keepsake",
    ),
    dict(
        category="Jewellery",
        buyer="Jason Griffin Reidel (Co-Founder & CEO)",
        location="Laguna Beach, CA",
        website="https://www.gorjana.com",
        company="gorjana",
        source="https://nationaljeweler.com/ranks/sotm_top_50",
    ),
    dict(
        category="Jewellery",
        buyer="Kendra Scott (Founder & Executive Chairwoman)",
        location="Austin, TX",
        website="https://www.kendrascott.com",
        company="Kendra Scott",
        source="https://nationaljeweler.com/articles/14209-kendra-scott-returns-as-ceo-of-her-jewelry-empire",
    ),
]

FOOTER_NOTE = (
    "Note: \u201cBuyer Name\u201d is the company\u2019s publicly documented head/owner "
    "(category-buyer names and direct contacts aren\u2019t published publicly). "
    "Details verified 22 Oct 2026 against company websites and trade press \u2014 "
    "see the comment on each Buyer Name cell for its source. Re-verify before outreach."
)

TITLE_ROW = 1
HEADER_ROW = 4
FIRST_DATA_ROW = 5
LAST_DATA_ROW = FIRST_DATA_ROW + len(ROWS) - 1
NOTE_ROW = LAST_DATA_ROW + 2
LAST_COL = get_column_letter(len(HEADERS))


def build(out_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "US Buyers"

    wb.properties.title = "US Buyers — Lanterns & Jewellery"
    wb.properties.creator = "Market Research"
    wb.properties.description = (
        "10 US buyers (5 Lanterns, 5 Jewellery): Buyer Name, Location, "
        "Website, Company Name. Verified 22 Oct 2026."
    )

    left = Alignment(horizontal="left", vertical="center")
    left_wrap = Alignment(horizontal="left", vertical="center", wrap_text=True)
    thin = Side(style="thin", color="BFBFBF")
    cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # --- Header zone (title + prepared date above the table) ---
    ws.merge_cells(f"A{TITLE_ROW}:{LAST_COL}{TITLE_ROW}")
    c = ws[f"A{TITLE_ROW}"]
    c.value = "US Buyers \u2014 Lanterns & Jewellery"
    c.font = Font(name="Calibri", size=15, bold=True, color="1F3864")
    c.alignment = left
    ws.row_dimensions[TITLE_ROW].height = 22

    ws.merge_cells(f"A2:{LAST_COL}2")
    c = ws["A2"]
    c.value = f"Prepared: {PREPARED}  |  10 US buyers \u2014 5 Lanterns, 5 Jewellery"
    c.font = Font(name="Calibri", size=10, italic=True, color="595959")
    c.alignment = left

    ws.row_dimensions[3].height = 8  # spacer

    # --- Column headers ---
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="305496")
    for col, title in enumerate(HEADERS, start=1):
        c = ws.cell(row=HEADER_ROW, column=col, value=title)
        c.font = header_font
        c.fill = header_fill
        c.alignment = left
        c.border = cell_border
    ws.row_dimensions[HEADER_ROW].height = 20

    # --- Data rows (values left-aligned; Website cells are full typed URLs + hyperlinks) ---
    body_font = Font(name="Calibri", size=11)
    link_font = Font(name="Calibri", size=11, color="0563C1", underline="single")
    band_fill = PatternFill("solid", fgColor="F2F2F2")

    for i, row in enumerate(ROWS):
        r = FIRST_DATA_ROW + i
        values = [row["category"], row["buyer"], row["location"], row["website"], row["company"]]
        for col, value in enumerate(values, start=1):
            c = ws.cell(row=r, column=col, value=value)
            c.font = link_font if col == 4 else body_font
            c.alignment = left
            c.border = cell_border
            if i % 2 == 1:
                c.fill = band_fill
            if col == 4:
                c.hyperlink = value
        ws.cell(row=r, column=2).comment = Comment(
            f"Source: {row['source']}\nChecked: {CHECKED}",
            "Research",
            width=340,
            height=70,
        )

    # --- Footer note ---
    ws.merge_cells(f"A{NOTE_ROW}:{LAST_COL}{NOTE_ROW}")
    c = ws[f"A{NOTE_ROW}"]
    c.value = FOOTER_NOTE
    c.font = Font(name="Calibri", size=9, italic=True, color="595959")
    c.alignment = left_wrap
    ws.row_dimensions[NOTE_ROW].height = 30

    # --- Sheet behaviour: filter/sort, frozen header, widths, print setup ---
    ws.auto_filter.ref = f"A{HEADER_ROW}:{LAST_COL}{LAST_DATA_ROW}"
    ws.freeze_panes = f"A{FIRST_DATA_ROW}"

    for col_letter, width in zip("ABCDE", [17, 38, 18, 38, 26]):
        ws.column_dimensions[col_letter].width = width

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{TITLE_ROW}:{HEADER_ROW}"
    ws.print_area = f"A{TITLE_ROW}:{LAST_COL}{NOTE_ROW}"

    wb.save(out_path)


def validate(path: Path) -> None:
    wb = load_workbook(path)
    ws = wb["US Buyers"]

    headers = [ws.cell(row=HEADER_ROW, column=c).value for c in range(1, 6)]
    assert headers == HEADERS, headers

    counts = {"Lanterns": 0, "Jewellery": 0}
    print(f"{'Company':26} {'Category':10} {'Buyer (head/owner)':44} {'Location':18} Website")
    print("-" * 130)
    for r in range(FIRST_DATA_ROW, LAST_DATA_ROW + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, 6)]
        assert all(vals), f"Blank field in row {r}: {vals}"
        link = ws.cell(row=r, column=4).hyperlink
        assert link is not None and link.target == vals[3], f"Missing/broken hyperlink row {r}"
        assert ws.cell(row=r, column=2).comment is not None, f"Missing source comment row {r}"
        counts[vals[0]] += 1
        print(f"{vals[4]:26} {vals[0]:10} {vals[1]:44} {vals[2]:18} {vals[3]}")

    assert counts == {"Lanterns": 5, "Jewellery": 5}, counts
    assert ws.auto_filter.ref == f"A{HEADER_ROW}:{LAST_COL}{LAST_DATA_ROW}"
    assert ws.freeze_panes == f"A{FIRST_DATA_ROW}"
    print("-" * 130)
    print(f"OK: 10 data rows (5 Lanterns, 5 Jewellery), hyperlinks + source comments verified -> {path}")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "US_Buyers_Lanterns_and_Jewellery.xlsx"
    build(out)
    validate(out)
