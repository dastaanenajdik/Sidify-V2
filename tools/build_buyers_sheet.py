#!/usr/bin/env python3
"""Build the US Buyers workbook for LANTERNS & JEWELLERY (5 buyers each).

Output: US_Buyers_Lanterns_and_Jewellery.xlsx in the repository root.

Sheets
------
1. "US Buyers"      - S.No, Product Category, Buyer Name, Company Name,
                      Location, Website, Contact.
2. "Buyer Details"  - per-buyer address, product imported, origin, US port,
                      product fit and current status.
"""

from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PREPARED = "22 October 2026"

# `buyer` = the named decision-maker where one is publicly documented,
# otherwise the buying desk that handles that category.
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
        buyer="Buying Desk - Seasonal & Home",
        company="Costco Wholesale Corporation",
        location="Issaquah, WA",
        website="https://www.costco.com",
        contact="Vendor submissions via Costco Supplier/Vendor Inquiry on costco.com",
        address="999 Lake Drive, Issaquah, WA 98027",
        product="Large solar base lantern (803 cartons)",
        origin="China - Yantian",
        us_port="Elizabeth, NJ",
        fit="Medium - solar / garden decor lanterns",
        status="Active - membership warehouse club; new vendors via Costco vendor programme",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Home & Seasonal Decor",
        company="Fred Meyer (The Kroger Co.)",
        location="Portland, OR",
        website="https://www.fredmeyer.com",
        contact="Vendor/partner enquiries via fredmeyer.com; buying office Portland, OR",
        address="3800 SE 22nd Ave, Portland, OR 97202",
        product="Resin birdfeeder, straw bird house, lantern",
        origin="South Korea - Busan",
        us_port="Portland, OR",
        fit="Medium-High - seasonal home decor",
        status="Active - Kroger banner, ~130 stores in the Pacific Northwest",
    ),
    dict(
        category="Lanterns",
        buyer="Cindy Kretzinger - Head of Product Development & Merchandising",
        company="Pier 1 Imports (Omni Retail Enterprises)",
        location="Fort Worth, TX",
        website="https://www.pier1.com",
        contact="Product development & merchandising desk via pier1.com",
        address="100 Pier 1 Place, Fort Worth, TX 76102",
        product="Metal lanterns (44 cartons), with candle holders and other decor",
        origin="Hong Kong",
        us_port="Long Beach, CA",
        fit="High - decorative metal lanterns",
        status="Active - online-only since 2020; sourcing led by Omni Retail Enterprises",
    ),
    dict(
        category="Lanterns",
        buyer="Ashok 'Ash' Pamani - President / Owner (imports: Mahinder Pamani, Imports Manager)",
        company="Style Asia Inc.",
        location="Moonachie, NJ",
        website="https://styleasia.net",
        contact="contact@styleasia.net | +1 (201) 460-9611 | toll-free (800) 522-7465",
        address="101 Moonachie Avenue, Moonachie, NJ 07074",
        product="Lantern, steel flask, plastic container, pen",
        origin="China - Ningbo",
        us_port="Not stated",
        fit="High - vintage LED lanterns in current catalogue; direct importer",
        status="Active - importer & wholesale distributor since 1985 (best-fit wholesale lead)",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Hardlines / General Merchandise",
        company="Kmart Corporation (Transformco)",
        location="Hoffman Estates, IL",
        website="https://www.kmart.com",
        contact="Vendor enquiries via kmart.com",
        address="3333 Beverly Road, Hoffman Estates, IL 60179",
        product="Rechargeable 3-in-1 lantern",
        origin="Not stated",
        us_port="Not stated",
        fit="Low-Medium - utility / camping lanterns rather than decorative",
        status="Limited - few stores remain under Transformco; kmart.com still trading",
    ),
    # ------------------------------- JEWELLERY ------------------------------
    dict(
        category="Jewellery",
        buyer="Buying Desk - Fashion Jewellery & Accessories",
        company="The Avon Company (Avon Products, Inc.)",
        location="New York, NY",
        website="https://www.avon.com",
        contact="Merchandising via avon.com; office 165 Broadway, New York, NY 10006",
        address="165 Broadway, New York, NY 10006",
        product="Jewelry - P.O. 69175211 / 69175212 / 69175813",
        origin="Singapore",
        us_port="Los Angeles, CA",
        fit="High - fashion jewellery is a core Avon category (Beauty Plus)",
        status="Active - US business operates as The Avon Company",
    ),
    dict(
        category="Jewellery",
        buyer="Scott Fink - President",
        company="Barry-Owen Co., Inc.",
        location="Los Angeles, CA",
        website="https://barryowen.com",
        contact="scott@barryowen.com | orders@barryowen.com | +1 (323) 724-4800",
        address="5625 Smithway Street, Los Angeles, CA 90040",
        product="Imitation jewelry (lead & nickel free); pendant bracelets",
        origin="South Korea - Busan / China - Yantian",
        us_port="San Pedro, CA / Los Angeles, CA",
        fit="High - costume jewellery importer-wholesaler (also Barry-Owen Gift & Home)",
        status="Active - fresh imitation-jewellery imports recorded in 2026",
    ),
    dict(
        category="Jewellery",
        buyer="Jennifer Hogan - Founder & CEO",
        company="Toss Designs",
        location="San Anselmo, CA",
        website="https://www.tossdesigns.com",
        contact="sales@tossdesigns.com | +1 (415) 721-1037",
        address="343 San Anselmo Ave, San Anselmo, CA 94960",
        product="Travel jewelry, luggage tag, PVC bag, business-card case, passport cover",
        origin="Hong Kong",
        us_port="Oakland, CA",
        fit="Medium - travel jewellery & gift accessories (wholesale to 4,000+ stores)",
        status="Active - design house, wholesaler and own retail stores",
    ),
    dict(
        category="Jewellery",
        buyer="Buying Desk - Jewellery & Accessories",
        company="Dollar General Corporation",
        location="Goodlettsville, TN",
        website="https://www.dollargeneral.com",
        contact="Supplier onboarding via Dollar General supplier portal / vendor enquiry",
        address="100 Mission Ridge, Goodlettsville, TN 37072",
        product="'Fairy N Jewel' necklace",
        origin="China - Yantian",
        us_port="Portsmouth, VA",
        fit="High - high-volume fashion jewellery and accessories",
        status="Active - ~20,000 stores; central buying from Goodlettsville",
    ),
    dict(
        category="Jewellery",
        buyer="Import Desk - wholesale showroom",
        company="Eastern Nationwide Supply Inc.",
        location="New York, NY",
        website="Not available - wholesale showroom only",
        contact="1261 Broadway, Suite 701, New York, NY 10001",
        address="1261 Broadway, Suite 701, New York, NY 10001",
        product="Bangles, earrings, choker necklace and tie sets",
        origin="China - Shanghai",
        us_port="San Pedro, CA",
        fit="High - pure-play fashion-jewellery importer in the NYC jewellery district",
        status="Active - jewellery-set imports recorded through 2026",
    ),
]

TITLE = "US Buyers - Lanterns & Jewellery"
SUBTITLE = f"Prepared: {PREPARED}  |  10 buyers: 5 Lanterns, 5 Jewellery"

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

    # ------------------------------ Sheet 1 ------------------------------
    ws = wb.active
    ws.title = "US Buyers"
    wb.properties.title = "US Buyers - Lanterns & Jewellery"
    wb.properties.creator = "Market Research"
    wb.properties.description = (
        "10 US buyers: 5 lanterns, 5 jewellery - name, company, location, website and contact."
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
        widths=[6, 12, 38, 32, 20, 30, 46],
        link_col=6,
        wrap_cols=(3, 4, 7),
    )

    # ------------------------------ Sheet 2 ------------------------------
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
        widths=[6, 30, 11, 38, 44, 24, 20, 36, 40],
        wrap_cols=(4, 5, 6, 8, 9),
    )

    wb.save(out_path)


def validate(path: Path) -> None:
    wb = load_workbook(path)
    ws = wb["US Buyers"]

    headers = [ws.cell(row=4, column=c).value for c in range(1, len(HEADERS) + 1)]
    assert headers == HEADERS, headers

    counts = {"Lanterns": 0, "Jewellery": 0}
    print(f"{'Company':34} {'Category':10} {'Location':20} {'Website':36} Buyer")
    print("-" * 150)
    for r in range(5, 5 + len(ROWS)):
        vals = [ws.cell(row=r, column=c).value for c in range(1, 8)]
        assert all(v not in (None, "") for v in vals), f"Blank field row {r}: {vals}"
        counts[vals[1]] += 1
        print(f"{vals[3]:34} {vals[1]:10} {vals[4]:20} {str(vals[5])[:36]:36} {str(vals[2])[:40]}")

    assert counts == {"Lanterns": 5, "Jewellery": 5}, counts
    assert ws.freeze_panes == "A5"
    assert wb.sheetnames == ["US Buyers", "Buyer Details"], wb.sheetnames

    # nothing anywhere in the workbook should reference a source or a directory
    for sheet in wb:
        for row in sheet.iter_rows():
            for cell in row:
                text = str(cell.value or "").lower()
                assert "source" not in text, cell.coordinate
                assert "importers-directory" not in text, cell.coordinate
                assert cell.hyperlink is None or "importers-directory" not in str(cell.hyperlink.target)

    print("-" * 150)
    print(f"OK: 10 buyers (5 lanterns, 5 jewellery), no source column / note / heading -> {path}")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "US_Buyers_Lanterns_and_Jewellery.xlsx"
    build(out)
    validate(out)
