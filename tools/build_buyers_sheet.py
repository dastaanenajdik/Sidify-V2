#!/usr/bin/env python3
"""Build the US Buyers workbook for LANTERNS & JEWELLERY (5 buyers each).

Source of the buyer records
---------------------------
usa.importers-directory.net - the US Customs bill-of-lading (B/L) importer
directory. Every company in this workbook appears there as the **US Importer /
US Buyer** of a shipment whose product description contains lanterns or
jewellery. The directory pages used are recorded, row by row, in
`SOURCE_*` below and repeated in the "Import Evidence" sheet.

Enrichment (websites, named contacts, current status) was cross-checked on
22 Oct 2026 against company websites, BBB/D&B profiles, BusinessWire/Pier 1
press releases and import-trade records.

Sheets
------
1. "US Buyers"        - the deliverable: Product Category, Buyer Name,
                        Company Name, Location, Website (+ contact & source).
2. "Import Evidence"  - raw B/L record for each buyer: the directory address,
                        the product description as filed, ports, product fit.
3. "Notes & Method"   - how the list was built, caveats, outreach tips.

Output: US_Buyers_Lanterns_and_Jewellery.xlsx in the repository root.
"""

from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PREPARED = "22 October 2026"
CHECKED = "22 Oct 2026"
DIR = "https://usa.importers-directory.net"

# ---------------------------------------------------------------------------
# Sheet 1 data. `buyer` = the named decision-maker where one is publicly
# documented, otherwise the buying desk that handles that category.
# ---------------------------------------------------------------------------
HEADERS = [
    "S.No",
    "Product Category",
    "Buyer Name",
    "Company Name",
    "Location",
    "Website",
    "Contact (Phone / E-mail)",
    "Source (directory record)",
]

ROWS = [
    # ------------------------------- LANTERNS -------------------------------
    dict(
        category="Lanterns",
        buyer="Buying Desk - Seasonal & Home (no category buyer named publicly)",
        company="Costco Wholesale Corporation",
        location="Issaquah, WA",
        website="https://www.costco.com",
        contact="Vendor submissions via Costco Supplier/Vendor Inquiry on costco.com",
        source=f"{DIR}/lantern-1001653566.html",
        address="999 Lake Drive, Issaquah, WA 98027",
        product="Large Solar Base Lantern, P.O. 175-0731-260 (803 cartons; shipper Matador International Inc., Taiwan)",
        export_port="Yantian, China",
        us_port="Elizabeth, NJ",
        fit="Medium - solar/garden decor lanterns",
        status="Active - membership warehouse club; new vendors via Costco vendor programme",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Home & Seasonal Decor (no category buyer named publicly)",
        company="Fred Meyer (The Kroger Co.)",
        location="Portland, OR",
        website="https://www.fredmeyer.com",
        contact="Vendor/partner enquiries via fredmeyer.com; buying office Portland, OR",
        source=f"{DIR}/lantern-1001653566.html",
        address="3800 SE 22nd Ave, Portland, OR 97202",
        product="Resin birdfeeder, straw bird house, lantern",
        export_port="Busan, South Korea",
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
        source=f"{DIR}/lantern-1001653566.html",
        address="609 Kirk Rd, St Charles, IL 60174 (HQ: 100 Pier 1 Place, Fort Worth, TX 76102)",
        product="44 ctns Metal Lantern (shipment also carried glass candle holders, stone plates, paper flowers)",
        export_port="Hong Kong",
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
        source=f"{DIR}/lantern-1001653566.html",
        address="210 Moonachie Avenue, Moonachie, NJ 07074 (current: 101 Moonachie Ave)",
        product="Lantern, steel flask, plastic container, pen",
        export_port="Ningbo, China",
        us_port="Not stated on record",
        fit="High - vintage LED lanterns in current catalogue; direct importer",
        status="Active - importer & wholesale distributor since 1985 (best-fit wholesale lead)",
    ),
    dict(
        category="Lanterns",
        buyer="Buying Desk - Hardlines / General Merchandise (no buyer named publicly)",
        company="Kmart Corporation (Transformco)",
        location="Hoffman Estates, IL",
        website="https://www.kmart.com",
        contact="Vendor enquiries via kmart.com",
        source=f"{DIR}/import_data/lantern-1001653566.html",
        address="3333 Beverly Road, Hoffman Estates, IL 60179",
        product="Rechargeable 3-in-1 lantern",
        export_port="Not stated on record",
        us_port="Not stated on record",
        fit="Low-Medium - utility/camping lanterns rather than decorative",
        status="Limited - few stores remain under Transformco; kmart.com still trading",
    ),
    # ------------------------------- JEWELLERY ------------------------------
    dict(
        category="Jewellery",
        buyer="Buying Desk - Fashion Jewellery & Accessories (no category buyer named publicly)",
        company="The Avon Company (Avon Products, Inc.)",
        location="New York, NY",
        website="https://www.avon.com",
        contact="Merchandising via avon.com; corporate office 165 Broadway, New York, NY 10006",
        source=f"{DIR}/jewelry-1001656961.html",
        address="1251 Avenue of the Americas, New York, NY 10020",
        product="Jewelry - P.O. 69175211 / 69175212 / 69175813",
        export_port="Singapore",
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
        source=f"{DIR}/jewelry-1001656961.html ; {DIR}/bracelet-1007248.html",
        address="5625 Smithway Street, Los Angeles, CA 90040",
        product="Imitation jewelry (lead & nickel free); dolphin/whale-tail pendant bracelets",
        export_port="Busan, South Korea / Yantian, China",
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
        source=f"{DIR}/jewelry-1001656961.html",
        address="3070 Kerner Blvd, Unit C, San Rafael, CA 94901 (HQ: 343 San Anselmo Ave, San Anselmo, CA 94960)",
        product="Travel jewelry, luggage tag, PVC bag, business-card case, passport cover",
        export_port="Hong Kong",
        us_port="Oakland, CA",
        fit="Medium - travel jewellery & gift accessories (wholesale to 4,000+ stores)",
        status="Active - design house, wholesaler and own retail stores",
    ),
    dict(
        category="Jewellery",
        buyer="Buying Desk - Jewellery & Accessories (no category buyer named publicly)",
        company="Dollar General Corporation",
        location="Goodlettsville, TN",
        website="https://www.dollargeneral.com",
        contact="Supplier onboarding via Dollar General supplier portal / vendor enquiry",
        source=f"{DIR}/necklace-10071.html",
        address="100 Mission Ridge, Goodlettsville, TN 37072",
        product="Fairy 'N Jewel necklace, P.O. IN2RNX",
        export_port="Yantian, China",
        us_port="Portsmouth, VA",
        fit="High - high-volume fashion jewellery and accessories",
        status="Active - ~20,000 stores; central buying from Goodlettsville",
    ),
    dict(
        category="Jewellery",
        buyer="Import Desk - wholesale showroom (no individual buyer named publicly)",
        company="Eastern Nationwide Supply Inc.",
        location="New York, NY",
        website="Not available - wholesale showroom only",
        contact="1261 Broadway, Suite 701, New York, NY 10001",
        source=f"{DIR}/necklace-10071.html",
        address="22 W 32nd St, 2nd Floor, New York, NY 10001 (current: 1261 Broadway, Suite 701)",
        product="Bangle & earring & choker necklace & earring & tie",
        export_port="Shanghai, China",
        us_port="San Pedro, CA",
        fit="High - pure-play fashion-jewellery importer in the NYC jewellery district",
        status="Active - jewellery-set imports recorded through 2026",
    ),
]

SOURCE_PROVENANCE = {
    "dir_home": f"{DIR}/",
    "lantern": f"{DIR}/lantern-1001653566.html",
    "lantern_buyers": f"{DIR}/buyer/lantern-1001653566.html",
    "lantern_data": f"{DIR}/import_data/lantern-1001653566.html",
    "jewelry": f"{DIR}/jewelry-1001656961.html",
    "bracelet": f"{DIR}/bracelet-1007248.html",
    "necklace": f"{DIR}/necklace-10071.html",
}

CONTACT_SOURCES = {
    "Pier 1 Imports (Omni Retail Enterprises)": (
        "https://www.businesswire.com/news/home/20241024431906/en/ "
        "(Omni names Cindy Kretzinger to lead Pier 1 product development & merchandising)"
    ),
    "Style Asia Inc.": (
        "https://www.bbb.org/us/nj/moonachie/profile/exporter/style-asia-inc-0221-10002213 "
        "(Ashok Pamani, President) ; https://styleasia.net/"
    ),
    "Barry-Owen Co., Inc.": (
        "https://www.dnb.com/business-directory/company-profiles.barry-owen_co_inc."
        "fd2b7c0579f5e267efa8bb2855a1a629.html (Scott Fink, President) ; https://barryowen.com/"
    ),
    "Toss Designs": (
        "https://www.dnb.com/business-directory/company-profiles.toss_designs_inc."
        "9bf965cc249886eb9c0b909652696243.html (Jennifer Hogan, key principal) ; "
        "https://www.tossdesigns.com/pages/contact-us"
    ),
}

NOTES = [
    ("How this list was built", "header"),
    (
        "1. Product pages were pulled from usa.importers-directory.net: Lantern "
        f"({SOURCE_PROVENANCE['lantern']}), its Buyers page ({SOURCE_PROVENANCE['lantern_buyers']}) "
        f"and Import-Data page ({SOURCE_PROVENANCE['lantern_data']}); Jewellery ({SOURCE_PROVENANCE['jewelry']}), "
        f"Bracelet ({SOURCE_PROVENANCE['bracelet']}) and Necklace ({SOURCE_PROVENANCE['necklace']}).",
        "body",
    ),
    (
        "2. Every company on the directory pages that appears as 'US Importer' was reviewed. "
        "Freight forwarders, NVOCCs, customs brokers and non-US consignees were removed "
        "(e.g. Panalpina, Pan Star Express, Freight Savers, Geologistics, Allied Transport System, "
        "Galaxy Freight, Perfect Express, Deltamax, Home Hardware Stores Ltd (Canada)).",
        "body",
    ),
    (
        "3. The remaining 10 real buyers (5 lanterns, 5 jewellery) were enriched with the current "
        "website, address and - where publicly documented - a named decision-maker.",
        "body",
    ),
    ("Caveats", "header"),
    (
        "- Directory records are US Customs bill-of-lading filings. They are historic: they prove the "
        "company does buy this product, but the shipment shown may not be recent. Always re-verify "
        "before outreach.",
        "body",
    ),
    (
        "- 'Buyer Name' is a named head/decision-maker only where a public source documents it "
        "(Pier 1, Style Asia, Barry-Owen, Toss Designs). Category buyers at large retailers "
        "(Costco, Fred Meyer, Kmart, Avon, Dollar General) are not published; those rows give the "
        "buying desk you must route through instead of inventing a name.",
        "body",
    ),
    (
        "- Eastern Nationwide Supply has no public website; it is a trade-only showroom in the "
        "New York jewellery district and can be approached by post/phone.",
        "body",
    ),
    ("Suggested outreach order", "header"),
    (
        "1) Style Asia Inc. - direct importer/distributor, named president & imports manager. "
        "2) Barry-Owen Co. - costume-jewellery importer, named president, actively importing in 2026. "
        "3) Eastern Nationwide Supply - pure-play fashion-jewellery importer. "
        "4) Toss Designs - smaller, design-led, fast decisions. "
        "5) Pier 1 - high fit for decorative metal lanterns, sourcing team in place. "
        "6) Large retailers (Costco, Fred Meyer, Dollar General, Avon, Kmart) - long vendor-onboarding "
        "cycles; approach with a factory audit pack, test-report compliance (CPSIA/prop 65) and FOB quotes.",
        "body",
    ),
    ("Verification dates", "header"),
    (
        f"Directory records pulled: {CHECKED}. Website / contact / status checks: {CHECKED}. "
        "Named-contact sources are on the 'Import Evidence' sheet.",
        "body",
    ),
]

TITLE = "US Buyers - Lanterns & Jewellery (source: usa.importers-directory.net)"
SUBTITLE = (
    f"Prepared: {PREPARED}  |  10 buyers: 5 Lanterns, 5 Jewellery  |  "
    "Buyer records taken from US Customs bill-of-lading entries on usa.importers-directory.net"
)

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
    ws.row_dimensions[2].height = 26
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
        "10 US buyers (5 lanterns, 5 jewellery) extracted from US Customs B/L records "
        "on usa.importers-directory.net and enriched with verified websites and contacts."
    )
    _header_zone(ws, len(HEADERS), TITLE, SUBTITLE)

    rows = [
        [
            i,
            r["category"],
            r["buyer"],
            r["company"],
            r["location"],
            r["website"],
            r["contact"],
            r["source"],
        ]
        for i, r in enumerate(ROWS, start=1)
    ]
    last = _table(
        ws,
        HEADERS,
        rows,
        widths=[6, 12, 38, 32, 20, 30, 42, 44],
        link_col=6,
        wrap_cols=(3, 4, 7, 8),
    )

    for i, r in enumerate(ROWS, start=5):
        c = ws.cell(row=i, column=6)
        if c.hyperlink:
            c.hyperlink = r["website"]
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 11

    note_row = last + 2
    ws.merge_cells(f"A{note_row}:H{note_row}")
    c = ws[f"A{note_row}"]
    c.value = (
        "All 10 companies appear on usa.importers-directory.net as the 'US Importer' of a "
        "lantern or jewellery bill-of-lading entry (see 'Import Evidence'). Freight forwarders and "
        "non-US consignees were filtered out. 'Buyer Name' is a named decision-maker only where a "
        "public source documents one; otherwise route through the buying desk listed."
    )
    c.font = Font(name="Calibri", size=9, italic=True, color="595959")
    c.alignment = LEFT_WRAP
    ws.row_dimensions[note_row].height = 34

    # ------------------------------ Sheet 2 ------------------------------
    ev = wb.create_sheet("Import Evidence")
    _header_zone(
        ev,
        len(EV_HEADERS),
        "Import Evidence - the directory (B/L) record behind every buyer",
        "Address columns are exactly as printed in the directory record; 'Current address' updates are in the Notes sheet.",
    )
    ev_rows = [
        [
            i,
            r["company"],
            r["category"],
            r["address"],
            r["product"],
            r["export_port"],
            r["us_port"],
            r["fit"],
            r["status"],
            r["source"],
        ]
        for i, r in enumerate(ROWS, start=1)
    ]
    ev_last = _table(
        ev,
        EV_HEADERS,
        ev_rows,
        widths=[6, 30, 11, 44, 46, 22, 20, 34, 38, 40],
        link_col=10,
        wrap_cols=(4, 5, 6, 8, 9, 10),
    )

    contact_row = ev_last + 2
    ev.merge_cells(f"A{contact_row}:J{contact_row}")
    c = ev[f"A{contact_row}"]
    c.value = "Named-contact sources (checked 22 Oct 2026)"
    c.font = Font(name="Calibri", size=10, bold=True, color="1F3864")
    r = contact_row + 1
    for company, src in CONTACT_SOURCES.items():
        ev.merge_cells(f"A{r}:J{r}")
        c = ev[f"A{r}"]
        c.value = f"{company}: {src}"
        c.font = Font(name="Calibri", size=9, color="595959")
        c.alignment = LEFT_WRAP
        ev.row_dimensions[r].height = 26
        r += 1

    # ------------------------------ Sheet 3 ------------------------------
    nt = wb.create_sheet("Notes & Method")
    _header_zone(
        nt,
        2,
        "Notes, method and caveats",
        "Read this before using the list for outreach.",
    )
    r = 4
    for text, kind in NOTES:
        nt.merge_cells(f"A{r}:B{r}")
        c = nt[f"A{r}"]
        c.value = text
        if kind == "header":
            c.font = Font(name="Calibri", size=11, bold=True, color="305496")
            nt.row_dimensions[r].height = 20
        else:
            c.font = Font(name="Calibri", size=10)
            c.alignment = LEFT_WRAP
            nt.row_dimensions[r].height = max(28, 15 * (len(text) // 120 + 1))
        r += 1
    nt.column_dimensions["A"].width = 60
    nt.column_dimensions["B"].width = 60

    wb.save(out_path)


EV_HEADERS = [
    "S.No",
    "Company (US Importer on record)",
    "Category",
    "Address as printed in directory",
    "Product description as filed (B/L)",
    "Export port",
    "US port",
    "Product fit",
    "Current status",
    "Directory page",
]


def validate(path: Path) -> None:
    wb = load_workbook(path)
    ws = wb["US Buyers"]

    headers = [ws.cell(row=4, column=c).value for c in range(1, len(HEADERS) + 1)]
    assert headers == HEADERS, headers

    counts = {"Lanterns": 0, "Jewellery": 0}
    print(f"{'Company':34} {'Category':10} {'Location':16} {'Website':34} Buyer")
    print("-" * 140)
    for r in range(5, 5 + len(ROWS)):
        vals = [ws.cell(row=r, column=c).value for c in range(1, 9)]
        assert all(v not in (None, "") for v in vals), f"Blank field row {r}: {vals}"
        counts[vals[1]] += 1
        print(f"{vals[3]:34} {vals[1]:10} {vals[4]:16} {str(vals[5])[:34]:34} {str(vals[2])[:40]}")

    assert counts == {"Lanterns": 5, "Jewellery": 5}, counts
    assert ws.auto_filter.ref.startswith("A4:")
    assert ws.freeze_panes == "A5"
    assert {"US Buyers", "Import Evidence", "Notes & Method"} <= set(wb.sheetnames)
    print("-" * 140)
    print(f"OK: 10 buyers (5 lanterns, 5 jewellery), 3 sheets -> {path}")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "US_Buyers_Lanterns_and_Jewellery.xlsx"
    build(out)
    validate(out)
