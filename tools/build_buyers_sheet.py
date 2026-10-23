#!/usr/bin/env python3
"""Build the US Buyers workbook for LANTERNS & JEWELLERY (5 buyers each).

Data refreshed on 23 Oct 2026 from usa.importers-directory.net (US Customs
bill-of-lading importer records) and cross-checked against company websites,
D&B / BBB profiles and 2026 retail trade press.

Sheets
------
1. "US Buyers"      - S.No, Product Category, Buyer Name, Company Name,
                      Location, Website, Contact.
2. "Buyer Details"  - address, product imported, origin, US port, fit, status.
"""

from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PREPARED = "23 October 2026"

HEADERS = [
    "S.No",
    "Product Category",
    "Buyer Name",
    "Company Name",
    "Location",
    "Website",
    "Contact (Phone / E-mail)",
]

ROWS = [
    # ------------------------------- LANTERNS -------------------------------
    dict(
        category="Lanterns",
        buyer="Buying Desk - Seasonal & Home Decor",
        company="World Market (Cost Plus World Market)",
        location="Alameda, CA",
        website="https://www.worldmarket.com",
        contact="1201 Marina Village Pkwy, Alameda, CA 94501 | vendor enquiries via worldmarket.com",
        address="1201 Marina Village Pkwy, Alameda, CA 94501",
        product="Paraffin candles and woodenware (1,877 cartons, PO 200323279 / 200330503)",
        origin="Hong Kong",
        us_port="Oakland, CA",
        fit="High - imported home decor, lanterns and candle accessories are core lines",
        status="Active - ~250 stores, privately held (Kingswood Capital Management)",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Seasonal / Outdoor Decor",
        company="Lowe's Companies, Inc. (L G Sourcing Inc.)",
        location="Wilkesboro, NC",
        website="https://www.lowes.com",
        contact="1605 Curtis Bridge Rd, Wilkesboro, NC 28697 | supplier onboarding via lowes.com",
        address="Lowe's sourcing: 1605 Curtis Bridge Rd, Wilkesboro, NC 28697 (HQ: Mooresville, NC)",
        product="Outdoor decor, lighted yard pieces, trees and wreaths",
        origin="China - Yantian",
        us_port="Savannah, GA",
        fit="Medium-High - solar and decorative outdoor lanterns for seasonal sets",
        status="Active - Fortune 50 home-improvement retailer, 1,700+ stores",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Seasonal Home Decor",
        company="Family Dollar Stores, Inc.",
        location="Chesapeake, VA",
        website="https://www.familydollar.com",
        contact="500 Volvo Pkwy, Chesapeake, VA 23320 | supplier onboarding via familydollar.com",
        address="500 Volvo Pkwy, Chesapeake, VA 23320 (import DC on record: 10401 Old Monroe Rd, Matthews, NC)",
        product="Candle holders and Halloween / seasonal decor assortment",
        origin="China - Ningbo",
        us_port="Portsmouth, VA",
        fit="Medium - value-priced seasonal decor and candle lanterns",
        status="Active - ~7,100 stores; standalone since 2025 (Brigade / Macellum / Arkhouse)",
    ),
    dict(
        category="Lanterns",
        buyer="Pat Dolan - Owner (A-Boy Supply Co. dba Globe Lighting)",
        company="Globe Lighting (A-Boy Supply Co.)",
        location="Portland, OR",
        website="https://www.globelighting.com",
        contact="+1 (503) 225-9009 | +1 (800) 689-1000",
        address="1919 NW 19th Ave, Portland, OR 97209",
        product="Lighting fixtures - brass table, desk and floor lamps (178 cartons)",
        origin="China - Yantian",
        us_port="Seattle, WA",
        fit="High - lighting retailer/importer; buys decorative lamps and lanterns",
        status="Active - 14 stores across OR / WA / ID under Globe Lighting & Seattle Lighting",
    ),
    dict(
        category="Lanterns",
        buyer="Cindy Kretzinger - Head of Product Development & Merchandising",
        company="Pier 1 Imports (Omni Retail Enterprises)",
        location="Fort Worth, TX",
        website="https://www.pier1.com",
        contact="100 Pier 1 Place, Fort Worth, TX 76102 | product development desk via pier1.com",
        address="100 Pier 1 Place, Fort Worth, TX 76102",
        product="Metal lanterns (44 cartons) with candle holders and decor",
        origin="Hong Kong",
        us_port="Long Beach, CA",
        fit="High - decorative metal lanterns are a signature Pier 1 category",
        status="Active - online-first brand owned by Omni Retail Enterprises",
    ),
    # ------------------------------- JEWELLERY ------------------------------
    dict(
        category="Jewellery",
        buyer="Gavin Marks - Principal / Owner",
        company="DM Merchandising, Inc.",
        location="Elmhurst, IL",
        website="https://247dm.com",
        contact="+1 (630) 782-2700 | +1 (800) 548-6784",
        address="835 N Church Ct, Elmhurst, IL 60126",
        product="Metal keychains, rings and necklaces; festival jewellery accessories",
        origin="Hong Kong",
        us_port="Los Angeles, CA",
        fit="High - fashion jewellery and accessories are a core DM category",
        status="Active - 50+ years in gifts/accessories, 3,000+ SKUs, 20+ in-house brands",
    ),
    dict(
        category="Jewellery",
        buyer="Scott Fink - President",
        company="Barry-Owen Co., Inc.",
        location="Los Angeles, CA",
        website="https://barryowen.com",
        contact="scott@barryowen.com | +1 (323) 724-4800 | (800) 682-6682",
        address="5625 Smithway Street, Los Angeles, CA 90040",
        product="Imitation jewellery (lead & nickel free) and pendant bracelets",
        origin="South Korea - Busan / China - Yantian",
        us_port="San Pedro, CA / Los Angeles, CA",
        fit="High - costume-jewellery importer-wholesaler, also runs Barry-Owen Gift & Home",
        status="Active - fresh imitation-jewellery imports recorded through 2026",
    ),
    dict(
        category="Jewellery",
        buyer="Jennifer Hogan - Founder & CEO",
        company="Toss Designs",
        location="San Anselmo, CA",
        website="https://www.tossdesigns.com",
        contact="sales@tossdesigns.com | +1 (415) 721-1037",
        address="343 San Anselmo Ave, San Anselmo, CA 94960",
        product="Travel jewellery cases, charms and gift accessories",
        origin="Hong Kong",
        us_port="Oakland, CA",
        fit="Medium - travel jewellery and gift accessories, wholesale to 4,000+ stores",
        status="Active - design house, wholesaler and own retail stores",
    ),
    dict(
        category="Jewellery",
        buyer="Buying Desk - Jewellery & Accessories",
        company="Big Lots (Variety Wholesalers, Inc.)",
        location="Columbus, OH",
        website="https://www.biglots.com",
        contact="200 E. Campus View Blvd, Suite 310, Columbus, OH 43235 | vendor enquiries via biglots.com",
        address="200 E. Campus View Blvd, Suite 310, Columbus, OH 43235",
        product="Fashion jewellery sets - bracelets, necklaces, rings, earrings, tiaras",
        origin="Hong Kong",
        us_port="Not stated",
        fit="High - impulse fashion jewellery and accessory sets",
        status="Active - 217 stores; bought out of bankruptcy by Variety Wholesalers (2025)",
    ),
    dict(
        category="Jewellery",
        buyer="Import Desk - wholesale showroom",
        company="5 And 2 Co., Inc.",
        location="Commerce, CA",
        website="Not available - wholesale showroom only",
        contact="+1 (323) 728-2255 | 2727 Supply Ave, Commerce, CA 90040",
        address="2727 Supply Ave, Commerce, CA 90040",
        product="Bracelet, necklace and earring sets (296 cartons)",
        origin="China - Shanghai",
        us_port="Los Angeles, CA",
        fit="High - pure-play fashion-jewellery importer in the LA wholesale district",
        status="Active - importer / wholesale showroom; approach by phone or in person",
    ),
]

TITLE = "US Buyers - Lanterns & Jewellery"
SUBTITLE = (
    f"Prepared: {PREPARED}  |  10 buyers: 5 Lanterns, 5 Jewellery  |  "
    "US Customs import records, re-verified today"
)

DETAIL_HEADERS = [
    "S.No",
    "Company Name",
    "Product Category",
    "Address",
    "Product Imported",
    "Origin / Export",
    "US Port of Entry",
    "Product Fit",
    "Current Status",
]

THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
BAND = PatternFill("solid", fgColor="F2F2F2")
HDR_FILL = PatternFill("solid", fgColor="305496")
HDR_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
BODY = Font(name="Calibri", size=10)
LINK = Font(name="Calibri", size=10, color="0563C1", underline="single")
LEFT = Alignment(horizontal="left", vertical="top")
LEFT_WRAP = Alignment(horizontal="left", vertical="top", wrap_text=True)


def _header_zone(ws, ncols, title, subtitle):
    last = get_column_letter(ncols)
    ws.merge_cells(f"A1:{last}1")
    c = ws["A1"]
    c.value = title
    c.font = Font(name="Calibri", size=14, bold=True, color="1F3864")
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 22

    ws.merge_cells(f"A2:{last}2")
    c = ws["A2"]
    c.value = subtitle
    c.font = Font(name="Calibri", size=9, italic=True, color="595959")
    c.alignment = LEFT_WRAP
    ws.row_dimensions[2].height = 18
    ws.row_dimensions[3].height = 6


def _table(ws, headers, rows, header_row=4, widths=None, link_col=None, wrap_cols=()):
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=col, value=h)
        c.font = HDR_FONT
        c.fill = HDR_FILL
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        c.border = BORDER
    ws.row_dimensions[header_row].height = 30

    first = header_row + 1
    for i, values in enumerate(rows):
        r = first + i
        lines = 1
        for col, value in enumerate(values, start=1):
            c = ws.cell(row=r, column=col, value=value)
            c.font = BODY
            c.alignment = LEFT_WRAP if col in wrap_cols else LEFT
            c.border = BORDER
            if i % 2 == 1:
                c.fill = BAND
            if link_col and col == link_col and isinstance(value, str) and value.startswith("http"):
                c.hyperlink = value
                c.font = LINK
            if col in wrap_cols and widths and col <= len(widths) and isinstance(value, str):
                per_line = max(int(widths[col - 1]) - 2, 8)
                lines = max(lines, -(-len(value) // per_line))
        ws.row_dimensions[r].height = min(15 * lines + 4, 96)
    last = first + len(rows) - 1

    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(headers))}{last}"
    ws.freeze_panes = f"A{first}"
    for idx, width in enumerate(widths or [], start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{header_row}:{header_row}"
    return last


def build(out_path: Path) -> None:
    wb = Workbook()

    ws = wb.active
    ws.title = "US Buyers"
    wb.properties.title = "US Buyers - Lanterns & Jewellery"
    wb.properties.creator = "Market Research"
    wb.properties.description = (
        "10 US buyers: 5 lanterns, 5 jewellery - name, company, location, website, contact."
    )
    _header_zone(ws, len(HEADERS), TITLE, SUBTITLE)

    rows = [
        [i, r["category"], r["buyer"], r["company"], r["location"], r["website"], r["contact"]]
        for i, r in enumerate(ROWS, start=1)
    ]
    _table(
        ws,
        HEADERS,
        rows,
        widths=[6, 12, 38, 34, 20, 32, 46],
        link_col=6,
        wrap_cols=(3, 4, 7),
    )

    dt = wb.create_sheet("Buyer Details")
    _header_zone(dt, len(DETAIL_HEADERS), "Buyer details", "Address, product and fit for each buyer.")
    detail_rows = [
        [
            i,
            r["company"],
            r["category"],
            r["address"],
            r["product"],
            r["origin"],
            r["us_port"],
            r["fit"],
            r["status"],
        ]
        for i, r in enumerate(ROWS, start=1)
    ]
    _table(
        dt,
        DETAIL_HEADERS,
        detail_rows,
        widths=[6, 32, 11, 40, 44, 24, 20, 38, 42],
        wrap_cols=(4, 5, 6, 8, 9),
    )

    wb.save(out_path)


def validate(path: Path) -> None:
    wb = load_workbook(path)
    ws = wb["US Buyers"]

    headers = [ws.cell(row=4, column=c).value for c in range(1, len(HEADERS) + 1)]
    assert headers == HEADERS, headers

    counts = {"Lanterns": 0, "Jewellery": 0}
    print(f"{'Company':40} {'Category':10} {'Location':22} {'Website':34} Buyer")
    print("-" * 155)
    for r in range(5, 5 + len(ROWS)):
        vals = [ws.cell(row=r, column=c).value for c in range(1, 8)]
        assert all(v not in (None, "") for v in vals), f"Blank field row {r}: {vals}"
        counts[vals[1]] += 1
        print(f"{vals[3]:40} {vals[1]:10} {vals[4]:22} {str(vals[5])[:34]:34} {str(vals[2])[:38]}")

    assert counts == {"Lanterns": 5, "Jewellery": 5}, counts
    assert ws.freeze_panes == "A5"
    assert wb.sheetnames == ["US Buyers", "Buyer Details"], wb.sheetnames

    for sheet in wb:
        for row in sheet.iter_rows():
            for cell in row:
                text = str(cell.value or "").lower()
                assert "source" not in text, cell.coordinate
                assert "importers-directory" not in text, cell.coordinate
                assert cell.hyperlink is None or "importers-directory" not in str(cell.hyperlink.target)

    print("-" * 155)
    print(f"OK: 10 buyers (5 lanterns, 5 jewellery), refreshed {PREPARED} -> {path}")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "US_Buyers_Lanterns_and_Jewellery.xlsx"
    build(out)
    validate(out)
