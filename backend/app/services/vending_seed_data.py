"""
Realistic seed data for vending-machine manufacturing — suppliers,
materials, products with full BOMs. Used by the /procurement/
reset-and-seed endpoint to wipe stale data and bootstrap a working
demo / test environment for BVC24.

Designed around what an actual Indian vending machine plant would
need: sheet steel, refrigeration, electronics, payment hardware,
glass, motors, locks, packaging. Supplier names are real companies
in the Indian B2B market but contact details are placeholder demo
values — replace with actual purchase contracts in production.
"""


# =====================================================================
# SUPPLIERS — 20 vendors covering every major BOM category
# =====================================================================
# Format: dict with all Supplier fields. CATEGORY drives quick filter
# on the Purchase page; matches the BOMItem material categories below.

SUPPLIERS = [
    # ---- Sheet metal / steel ----
    {
        "SUPPLIER_CODE": "SUP-STEEL-01",
        "COMPANY_NAME": "Tata Steel BSL Limited",
        "CONTACT_PERSON": "Ravi Subramanian",
        "PHONE": "+91 22 6665 8282",
        "EMAIL": "sales.coils@tatasteel.com",
        "ADDRESS_LINE1": "Bombay House, 24 Homi Mody Street",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400001",
        "GST_NUMBER": "27AAACT2727Q1ZZ",
        "PAN_NUMBER": "AAACT2727Q",
        "CATEGORY": "Sheet Metal",
        "PAYMENT_TERMS": "NET 45",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-STEEL-02",
        "COMPANY_NAME": "Jindal Stainless Limited",
        "CONTACT_PERSON": "Anuradha Kapoor",
        "PHONE": "+91 124 4779 000",
        "EMAIL": "sales@jindalstainless.com",
        "ADDRESS_LINE1": "Jindal Centre, Plot 4, Sector 32",
        "CITY": "Gurugram",
        "STATE": "Haryana",
        "PINCODE": "122001",
        "GST_NUMBER": "06AAACJ4324H1ZF",
        "PAN_NUMBER": "AAACJ4324H",
        "CATEGORY": "Sheet Metal",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Refrigeration ----
    {
        "SUPPLIER_CODE": "SUP-COMP-01",
        "COMPANY_NAME": "Emerson Climate Technologies India",
        "CONTACT_PERSON": "Karthik Murthy",
        "PHONE": "+91 80 6726 4000",
        "EMAIL": "india.sales@emerson.com",
        "ADDRESS_LINE1": "Knowledge City, Survey No 83/1",
        "CITY": "Hyderabad",
        "STATE": "Telangana",
        "PINCODE": "500032",
        "GST_NUMBER": "36AAACE4567G1ZX",
        "PAN_NUMBER": "AAACE4567G",
        "CATEGORY": "Refrigeration",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-COMP-02",
        "COMPANY_NAME": "Tecumseh Products India Pvt Ltd",
        "CONTACT_PERSON": "Sanjay Pillai",
        "PHONE": "+91 1800 419 1234",
        "EMAIL": "orders@tecumseh.in",
        "ADDRESS_LINE1": "Plot 18, Hyderabad Aerospace Park",
        "CITY": "Hyderabad",
        "STATE": "Telangana",
        "PINCODE": "500078",
        "GST_NUMBER": "36AABCT9876K1ZP",
        "PAN_NUMBER": "AABCT9876K",
        "CATEGORY": "Refrigeration",
        "PAYMENT_TERMS": "Advance 50%",
        "STATUS": "ACTIVE",
    },

    # ---- Electronics / Control ----
    {
        "SUPPLIER_CODE": "SUP-ELEC-01",
        "COMPANY_NAME": "Bosch Limited (Industrial Tech)",
        "CONTACT_PERSON": "Priya Iyer",
        "PHONE": "+91 80 2299 2000",
        "EMAIL": "industrial.sales@in.bosch.com",
        "ADDRESS_LINE1": "Hosur Road, Adugodi",
        "CITY": "Bengaluru",
        "STATE": "Karnataka",
        "PINCODE": "560030",
        "GST_NUMBER": "29AAACB1234P1ZD",
        "PAN_NUMBER": "AAACB1234P",
        "CATEGORY": "Electronics",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-ELEC-02",
        "COMPANY_NAME": "Schneider Electric India Pvt Ltd",
        "CONTACT_PERSON": "Arvind Nair",
        "PHONE": "+91 124 397 9000",
        "EMAIL": "in.sales@se.com",
        "ADDRESS_LINE1": "9th Floor, Tower C, DLF Building 8",
        "CITY": "Gurugram",
        "STATE": "Haryana",
        "PINCODE": "122002",
        "GST_NUMBER": "06AAACS5891D1Z8",
        "PAN_NUMBER": "AAACS5891D",
        "CATEGORY": "Electronics",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Display ----
    {
        "SUPPLIER_CODE": "SUP-DISP-01",
        "COMPANY_NAME": "LG Display India Pvt Ltd",
        "CONTACT_PERSON": "Sandeep Choudhary",
        "PHONE": "+91 120 2560 900",
        "EMAIL": "display.sales@lgdisplay.com",
        "ADDRESS_LINE1": "A-24, Sector 16",
        "CITY": "Noida",
        "STATE": "Uttar Pradesh",
        "PINCODE": "201301",
        "GST_NUMBER": "09AAACL6789F1ZA",
        "PAN_NUMBER": "AAACL6789F",
        "CATEGORY": "Display",
        "PAYMENT_TERMS": "Advance 30%",
        "STATUS": "ACTIVE",
    },

    # ---- Motors ----
    {
        "SUPPLIER_CODE": "SUP-MOTOR-01",
        "COMPANY_NAME": "Crompton Greaves Industrial",
        "CONTACT_PERSON": "Ramesh Patil",
        "PHONE": "+91 22 6755 8000",
        "EMAIL": "industrial.sales@cgglobal.com",
        "ADDRESS_LINE1": "Tata Power Building, Bandra Kurla Complex",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400051",
        "GST_NUMBER": "27AAACC2356R1Z9",
        "PAN_NUMBER": "AAACC2356R",
        "CATEGORY": "Motors",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-MOTOR-02",
        "COMPANY_NAME": "ABB India Limited (Motors)",
        "CONTACT_PERSON": "Vijayalakshmi R",
        "PHONE": "+91 80 2294 9150",
        "EMAIL": "motors.in@abb.com",
        "ADDRESS_LINE1": "Plot 5 & 6, II Phase, Peenya",
        "CITY": "Bengaluru",
        "STATE": "Karnataka",
        "PINCODE": "560058",
        "GST_NUMBER": "29AAACA8765J1ZQ",
        "PAN_NUMBER": "AAACA8765J",
        "CATEGORY": "Motors",
        "PAYMENT_TERMS": "NET 45",
        "STATUS": "ACTIVE",
    },

    # ---- Payment Hardware ----
    {
        "SUPPLIER_CODE": "SUP-PAY-01",
        "COMPANY_NAME": "Pine Labs Pvt Ltd",
        "CONTACT_PERSON": "Aditi Sharma",
        "PHONE": "+91 124 4015 666",
        "EMAIL": "vending.b2b@pinelabs.com",
        "ADDRESS_LINE1": "Unitech Cyber Park, Tower B",
        "CITY": "Gurugram",
        "STATE": "Haryana",
        "PINCODE": "122002",
        "GST_NUMBER": "06AAFCP4523E1ZW",
        "PAN_NUMBER": "AAFCP4523E",
        "CATEGORY": "Payment Hardware",
        "PAYMENT_TERMS": "NET 15",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-PAY-02",
        "COMPANY_NAME": "Innoviti Technologies",
        "CONTACT_PERSON": "Naveen Bhat",
        "PHONE": "+91 80 4901 0101",
        "EMAIL": "enterprise@innoviti.com",
        "ADDRESS_LINE1": "C-105, 4th Cross, 5th Block, Koramangala",
        "CITY": "Bengaluru",
        "STATE": "Karnataka",
        "PINCODE": "560034",
        "GST_NUMBER": "29AAFCI3478H1ZK",
        "PAN_NUMBER": "AAFCI3478H",
        "CATEGORY": "Payment Hardware",
        "PAYMENT_TERMS": "Advance 100%",
        "STATUS": "ACTIVE",
    },

    # ---- Glass & Acrylic ----
    {
        "SUPPLIER_CODE": "SUP-GLASS-01",
        "COMPANY_NAME": "Saint-Gobain India (Sekurit)",
        "CONTACT_PERSON": "Meera Rajagopal",
        "PHONE": "+91 44 4220 4000",
        "EMAIL": "sekurit.india@saint-gobain.com",
        "ADDRESS_LINE1": "5 Floor, Leela Galleria, Old Airport Road",
        "CITY": "Chennai",
        "STATE": "Tamil Nadu",
        "PINCODE": "600032",
        "GST_NUMBER": "33AAACS6543A1ZN",
        "PAN_NUMBER": "AAACS6543A",
        "CATEGORY": "Glass",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },
    {
        "SUPPLIER_CODE": "SUP-GLASS-02",
        "COMPANY_NAME": "Asahi India Glass Ltd",
        "CONTACT_PERSON": "Sumit Bansal",
        "PHONE": "+91 124 4062 212",
        "EMAIL": "industrial@aisglass.com",
        "ADDRESS_LINE1": "Bahadur Shah Zafar Marg",
        "CITY": "New Delhi",
        "STATE": "Delhi",
        "PINCODE": "110002",
        "GST_NUMBER": "07AAACA1923Q1ZH",
        "PAN_NUMBER": "AAACA1923Q",
        "CATEGORY": "Glass",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Wires / Cables ----
    {
        "SUPPLIER_CODE": "SUP-CABLE-01",
        "COMPANY_NAME": "Polycab India Limited",
        "CONTACT_PERSON": "Rakesh Joshi",
        "PHONE": "+91 22 2487 4501",
        "EMAIL": "industrial.cables@polycab.com",
        "ADDRESS_LINE1": "Polycab House, 771 Tower 2 BKC",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400051",
        "GST_NUMBER": "27AABCP9876F1ZG",
        "PAN_NUMBER": "AABCP9876F",
        "CATEGORY": "Wires",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Locks ----
    {
        "SUPPLIER_CODE": "SUP-LOCK-01",
        "COMPANY_NAME": "Godrej Locks & Architectural Fittings",
        "CONTACT_PERSON": "Sneha Deshpande",
        "PHONE": "+91 22 6796 5656",
        "EMAIL": "locks.b2b@godrej.com",
        "ADDRESS_LINE1": "Pirojshanagar, Vikhroli East",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400079",
        "GST_NUMBER": "27AAACG3478L1Z7",
        "PAN_NUMBER": "AAACG3478L",
        "CATEGORY": "Hardware",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Insulation ----
    {
        "SUPPLIER_CODE": "SUP-INSUL-01",
        "COMPANY_NAME": "Owens Corning India Pvt Ltd",
        "CONTACT_PERSON": "Imran Khan",
        "PHONE": "+91 124 4180 800",
        "EMAIL": "insulation.in@owenscorning.com",
        "ADDRESS_LINE1": "Tower D, DLF Cyber City Phase 2",
        "CITY": "Gurugram",
        "STATE": "Haryana",
        "PINCODE": "122002",
        "GST_NUMBER": "06AAACO8765D1ZX",
        "PAN_NUMBER": "AAACO8765D",
        "CATEGORY": "Insulation",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Plumbing (for coffee / water machines) ----
    {
        "SUPPLIER_CODE": "SUP-PLUMB-01",
        "COMPANY_NAME": "Jaquar & Company Pvt Ltd",
        "CONTACT_PERSON": "Vinay Mehrotra",
        "PHONE": "+91 11 3061 6666",
        "EMAIL": "industrial@jaquar.com",
        "ADDRESS_LINE1": "Plot J3, MIDC, Bhosari",
        "CITY": "Pune",
        "STATE": "Maharashtra",
        "PINCODE": "411026",
        "GST_NUMBER": "27AAACJ5673N1ZF",
        "PAN_NUMBER": "AAACJ5673N",
        "CATEGORY": "Plumbing",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Heating ----
    {
        "SUPPLIER_CODE": "SUP-HEAT-01",
        "COMPANY_NAME": "Bajaj Electricals Limited (Heaters)",
        "CONTACT_PERSON": "Deepa Krishnamurthy",
        "PHONE": "+91 22 4128 0000",
        "EMAIL": "industrial.heat@bajajelectricals.com",
        "ADDRESS_LINE1": "45/47, Veer Nariman Road",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400001",
        "GST_NUMBER": "27AAACB3450M1ZA",
        "PAN_NUMBER": "AAACB3450M",
        "CATEGORY": "Heating",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE",
    },

    # ---- Packaging ----
    {
        "SUPPLIER_CODE": "SUP-PACK-01",
        "COMPANY_NAME": "TCPL Packaging Limited",
        "CONTACT_PERSON": "Harish Goenka",
        "PHONE": "+91 22 4321 9000",
        "EMAIL": "corrugated@tcpl.in",
        "ADDRESS_LINE1": "Empire Mills, Senapati Bapat Marg",
        "CITY": "Mumbai",
        "STATE": "Maharashtra",
        "PINCODE": "400013",
        "GST_NUMBER": "27AAACT8765J1ZL",
        "PAN_NUMBER": "AAACT8765J",
        "CATEGORY": "Packaging",
        "PAYMENT_TERMS": "NET 15",
        "STATUS": "ACTIVE",
    },

    # ---- Power ----
    {
        "SUPPLIER_CODE": "SUP-POWER-01",
        "COMPANY_NAME": "Amara Raja Power Systems",
        "CONTACT_PERSON": "Krishna Reddy",
        "PHONE": "+91 8554 244 444",
        "EMAIL": "industrial@amararaja.co.in",
        "ADDRESS_LINE1": "Karakambadi, Renigunta",
        "CITY": "Tirupati",
        "STATE": "Andhra Pradesh",
        "PINCODE": "517520",
        "GST_NUMBER": "37AAACA5891G1ZT",
        "PAN_NUMBER": "AAACA5891G",
        "CATEGORY": "Power",
        "PAYMENT_TERMS": "Advance 30%",
        "STATUS": "ACTIVE",
    },
]


# =====================================================================
# MATERIALS — 35+ items mapped to supplier categories above
# =====================================================================
# Format: (material_name, default_unit_price_INR, supplier_code, unit, hsn)
# The seeder creates MaterialCatalog rows + a matching Inventory row
# starting at QUANTITY=0 so PO+GRN flow has something to land in.

MATERIALS = [
    # Sheet Metal
    ("GI Sheet 1.0mm 1250x2500", 4200, "SUP-STEEL-01", "sheet", "7210"),
    ("GI Sheet 1.5mm 1250x2500", 6300, "SUP-STEEL-01", "sheet", "7210"),
    ("SS 304 Sheet 1.0mm",        8500, "SUP-STEEL-02", "sheet", "7219"),
    ("MS Angle Bar 25x25x3mm",     180, "SUP-STEEL-01", "m",     "7216"),

    # Refrigeration
    ("Compressor 1/5 HP R134a",   8900, "SUP-COMP-01",  "nos",   "8414"),
    ("Compressor 1/3 HP R134a",  11200, "SUP-COMP-02",  "nos",   "8414"),
    ("Condenser Coil 200x300mm",  2400, "SUP-COMP-01",  "nos",   "8418"),
    ("Evaporator Coil 250x400mm", 2800, "SUP-COMP-01",  "nos",   "8418"),
    ("Refrigerant Gas R134a 1kg",  650, "SUP-COMP-02",  "kg",    "2903"),
    ("Capillary Tube 0.8mm 1.5m",   95, "SUP-COMP-02",  "nos",   "7411"),

    # Electronics
    ("Main Control PCB 240V",     3200, "SUP-ELEC-01",  "nos",   "8537"),
    ("Microcontroller STM32 IC",   420, "SUP-ELEC-01",  "nos",   "8542"),
    ("Temperature Sensor DS18B20",  85, "SUP-ELEC-02",  "nos",   "9025"),
    ("Humidity Sensor DHT22",      120, "SUP-ELEC-02",  "nos",   "9025"),
    ("Relay Module 24V 10A",       180, "SUP-ELEC-02",  "nos",   "8536"),
    ("Door Sensor Reed Switch",     45, "SUP-ELEC-02",  "nos",   "8536"),

    # Display
    ("LCD Touch Panel 10 inch",   4800, "SUP-DISP-01",  "nos",   "8528"),
    ("LCD Touch Panel 15 inch",   8200, "SUP-DISP-01",  "nos",   "8528"),
    ("LED Indicator Strip 1m",     320, "SUP-DISP-01",  "m",     "8541"),

    # Motors
    ("DC Gear Motor 24V 30 RPM",   780, "SUP-MOTOR-01", "nos",   "8501"),
    ("DC Gear Motor 24V 60 RPM",   860, "SUP-MOTOR-01", "nos",   "8501"),
    ("Spiral Coil Helix 6 turn",   240, "SUP-MOTOR-02", "nos",   "7320"),
    ("Stepper Motor NEMA 17",     1100, "SUP-MOTOR-02", "nos",   "8501"),

    # Payment Hardware
    ("Coin Acceptor Multi-coin",  3400, "SUP-PAY-01",   "nos",   "8472"),
    ("Bill Validator INR",        6800, "SUP-PAY-01",   "nos",   "8472"),
    ("NFC Payment Module",        4200, "SUP-PAY-02",   "nos",   "8517"),
    ("QR Scanner Module",         2900, "SUP-PAY-02",   "nos",   "8471"),

    # Glass
    ("Tempered Glass 600x800x6mm", 1800, "SUP-GLASS-01", "nos",  "7007"),
    ("Acrylic Panel 4mm 600x800",   950, "SUP-GLASS-02", "nos",  "3920"),

    # Wires / Cables
    ("Wiring Harness 5m 8-core",   320, "SUP-CABLE-01", "nos",   "8544"),
    ("Power Cable 3-core 1.5mm 10m", 540, "SUP-CABLE-01", "nos", "8544"),

    # Hardware / Locks
    ("Electronic Door Lock 24V",  1600, "SUP-LOCK-01",  "nos",   "8301"),
    ("Mechanical Cylinder Lock",   380, "SUP-LOCK-01",  "nos",   "8301"),
    ("Door Hinge Heavy-duty",      120, "SUP-LOCK-01",  "nos",   "8302"),
    ("Rubber Door Gasket 3m",      280, "SUP-INSUL-01", "nos",   "4016"),

    # Insulation
    ("PU Foam Insulation 50mm 1sqm", 480, "SUP-INSUL-01", "sqm", "3921"),

    # Plumbing (coffee/water variants)
    ("Water Pump 12V Self-Priming", 1200, "SUP-PLUMB-01", "nos", "8413"),
    ("Food-grade PVC Tubing 5m",     140, "SUP-PLUMB-01", "nos", "3917"),
    ("Water Filter Cartridge",       420, "SUP-PLUMB-01", "nos", "8421"),

    # Heating (coffee/hot food variants)
    ("Boiler Heating Element 1.5kW", 1450, "SUP-HEAT-01", "nos", "8516"),
    ("Thermostat 0-100C",             280, "SUP-HEAT-01", "nos", "9032"),

    # Power
    ("Power Supply SMPS 24V 10A",   1800, "SUP-POWER-01", "nos", "8504"),
    ("Cooling Fan 120mm DC 24V",     220, "SUP-POWER-01", "nos", "8414"),

    # Packaging
    ("Corrugated Box L 60x80x180cm", 380, "SUP-PACK-01", "nos",  "4819"),
    ("EPE Foam Padding 50mm 1sqm",   210, "SUP-PACK-01", "sqm",  "3920"),
    ("BVC24 Branding Sticker Set",    95, "SUP-PACK-01", "set",  "4911"),
]


# =====================================================================
# PRODUCTS — 2 realistic vending machine models with full BOMs
# =====================================================================
# Each BOM line references a material by NAME (resolved at seed time
# into MATERIAL_ID + PREFERRED_SUPPLIER_ID).

PRODUCTS = [
    {
        "MODEL_CODE": "BVC-SBC-01",
        "MODEL_NAME": "BVC24 Snack & Beverage Combo SS&B-001",
        "CATEGORY": "snack-beverage",
        "DESCRIPTION": (
            "Indoor combo vending machine — 8 columns snack + 6 chiller "
            "shelves for beverages. Touchscreen + cashless payment."
        ),
        "ESTIMATED_BUILD_DAYS": 21,
        "BOM": [
            # (material_name, quantity, unit, item_no, notes)
            ("GI Sheet 1.5mm 1250x2500",       4,  "sheet", 1, "Cabinet body"),
            ("GI Sheet 1.0mm 1250x2500",       2,  "sheet", 2, "Interior shelves"),
            ("MS Angle Bar 25x25x3mm",         12, "m",     3, "Frame reinforcement"),
            ("Compressor 1/3 HP R134a",        1,  "nos",   4, "Chiller compressor"),
            ("Condenser Coil 200x300mm",       1,  "nos",   5, ""),
            ("Evaporator Coil 250x400mm",      1,  "nos",   6, ""),
            ("Refrigerant Gas R134a 1kg",      0.8,"kg",    7, ""),
            ("Capillary Tube 0.8mm 1.5m",      1,  "nos",   8, ""),
            ("Main Control PCB 240V",          1,  "nos",   9, ""),
            ("Microcontroller STM32 IC",       1,  "nos",   10, "On the main PCB"),
            ("Temperature Sensor DS18B20",     2,  "nos",   11, "Chiller + cabinet"),
            ("Humidity Sensor DHT22",          1,  "nos",   12, ""),
            ("Relay Module 24V 10A",           4,  "nos",   13, ""),
            ("Door Sensor Reed Switch",        2,  "nos",   14, ""),
            ("LCD Touch Panel 10 inch",        1,  "nos",   15, "User UI"),
            ("LED Indicator Strip 1m",         3,  "m",     16, "Internal lighting"),
            ("DC Gear Motor 24V 30 RPM",       8,  "nos",   17, "One per snack column"),
            ("Spiral Coil Helix 6 turn",       8,  "nos",   18, "Snack delivery"),
            ("Coin Acceptor Multi-coin",       1,  "nos",   19, ""),
            ("Bill Validator INR",             1,  "nos",   20, ""),
            ("NFC Payment Module",             1,  "nos",   21, ""),
            ("QR Scanner Module",              1,  "nos",   22, "UPI payments"),
            ("Tempered Glass 600x800x6mm",     1,  "nos",   23, "Front glass"),
            ("Acrylic Panel 4mm 600x800",      1,  "nos",   24, "Inner divider"),
            ("Wiring Harness 5m 8-core",       2,  "nos",   25, ""),
            ("Power Cable 3-core 1.5mm 10m",   1,  "nos",   26, ""),
            ("Electronic Door Lock 24V",       1,  "nos",   27, ""),
            ("Mechanical Cylinder Lock",       1,  "nos",   28, "Service door"),
            ("Door Hinge Heavy-duty",          3,  "nos",   29, ""),
            ("Rubber Door Gasket 3m",          1,  "nos",   30, ""),
            ("PU Foam Insulation 50mm 1sqm",   2,  "sqm",   31, "Chiller insulation"),
            ("Power Supply SMPS 24V 10A",      1,  "nos",   32, ""),
            ("Cooling Fan 120mm DC 24V",       2,  "nos",   33, ""),
            ("Corrugated Box L 60x80x180cm",   1,  "nos",   34, "Shipping pack"),
            ("EPE Foam Padding 50mm 1sqm",     3,  "sqm",   35, ""),
            ("BVC24 Branding Sticker Set",     1,  "set",   36, ""),
        ],
    },
    {
        "MODEL_CODE": "BVC-CCP-01",
        "MODEL_NAME": "BVC24 Coffee Pro CCP-001",
        "CATEGORY": "hot-beverage",
        "DESCRIPTION": (
            "Premium hot-beverage vending machine — coffee, tea, hot "
            "chocolate. Touchscreen + cashless. Boiler + auto-clean."
        ),
        "ESTIMATED_BUILD_DAYS": 18,
        "BOM": [
            ("GI Sheet 1.5mm 1250x2500",       3,  "sheet", 1, "Cabinet"),
            ("SS 304 Sheet 1.0mm",             2,  "sheet", 2, "Food-contact panels"),
            ("MS Angle Bar 25x25x3mm",         8,  "m",     3, ""),
            ("Boiler Heating Element 1.5kW",   1,  "nos",   4, "Water heating"),
            ("Thermostat 0-100C",              2,  "nos",   5, ""),
            ("Water Pump 12V Self-Priming",    2,  "nos",   6, "Cold + hot circuits"),
            ("Food-grade PVC Tubing 5m",       1,  "nos",   7, ""),
            ("Water Filter Cartridge",         1,  "nos",   8, ""),
            ("Main Control PCB 240V",          1,  "nos",   9, ""),
            ("Microcontroller STM32 IC",       1,  "nos",   10, ""),
            ("Temperature Sensor DS18B20",     3,  "nos",   11, "Boiler + cup + cabinet"),
            ("Relay Module 24V 10A",           5,  "nos",   12, ""),
            ("Door Sensor Reed Switch",        1,  "nos",   13, ""),
            ("LCD Touch Panel 15 inch",        1,  "nos",   14, "Larger UX"),
            ("LED Indicator Strip 1m",         2,  "m",     15, ""),
            ("DC Gear Motor 24V 60 RPM",       3,  "nos",   16, "Stirrer + dispense"),
            ("Stepper Motor NEMA 17",          2,  "nos",   17, "Powder dosing"),
            ("Coin Acceptor Multi-coin",       1,  "nos",   18, ""),
            ("NFC Payment Module",             1,  "nos",   19, ""),
            ("QR Scanner Module",              1,  "nos",   20, ""),
            ("Tempered Glass 600x800x6mm",     1,  "nos",   21, ""),
            ("Wiring Harness 5m 8-core",       2,  "nos",   22, ""),
            ("Power Cable 3-core 1.5mm 10m",   1,  "nos",   23, ""),
            ("Electronic Door Lock 24V",       1,  "nos",   24, ""),
            ("Door Hinge Heavy-duty",          2,  "nos",   25, ""),
            ("Rubber Door Gasket 3m",          1,  "nos",   26, ""),
            ("Power Supply SMPS 24V 10A",      1,  "nos",   27, ""),
            ("Cooling Fan 120mm DC 24V",       2,  "nos",   28, ""),
            ("Corrugated Box L 60x80x180cm",   1,  "nos",   29, ""),
            ("EPE Foam Padding 50mm 1sqm",     2,  "sqm",   30, ""),
            ("BVC24 Branding Sticker Set",     1,  "set",   31, ""),
        ],
    },
]
