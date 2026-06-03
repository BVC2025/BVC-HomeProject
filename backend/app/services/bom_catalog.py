"""
Structured BOM catalog for BVC24 vending-machine variants.

Pure data + tiny resolver helpers. Drives the
POST /production/bom/reset-and-seed endpoint and the auto-seed
on POST /production/models, so every ProductModel gets a BOM that
actually matches its CATEGORY (snack, cold drink, tea/coffee,
medicine) instead of the legacy hard-coded C 608 R1 dump.

Item dict shape:
    {
        "category":       str,    # functional grouping for reporting
        "material_name":  str,    # what shows up in the BOM line
        "quantity":       float,  # per-unit qty
        "unit":           str,    # pcs / m / kg / set / sqm / l
        "item_type":      str,    # always "PURCHASE" for now
        "supplier_hint":  str|None  # matches Supplier.CATEGORY for auto-link
    }
"""

from typing import Dict, List, Optional


# ----------------------------------------------------------------
# UNIVERSAL — every machine variant ships with these.
# Groups: MECHANICAL, ELECTRICAL, ELECTRONICS, PAYMENT, IOT,
# SENSORS, BRANDING.
# ----------------------------------------------------------------

UNIVERSAL_ITEMS: List[Dict] = [
    # ----- MECHANICAL (cabinet, door, frame, mobility) -----
    {"category": "MECHANICAL",  "material_name": "MS Sheet 1.5mm",                 "quantity": 4.0,   "unit": "sheet", "item_type": "PURCHASE", "supplier_hint": "Sheet Metal"},
    {"category": "MECHANICAL",  "material_name": "SS Sheet 0.8mm",                 "quantity": 2.0,   "unit": "sheet", "item_type": "PURCHASE", "supplier_hint": "Sheet Metal"},
    {"category": "MECHANICAL",  "material_name": "Glass Door Tempered 6mm",        "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Glass"},
    {"category": "MECHANICAL",  "material_name": "Door Lock Electronic 24V",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "MECHANICAL",  "material_name": "Door Hinge Heavy-duty",          "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "MECHANICAL",  "material_name": "Rubber Gasket 3m",               "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "MECHANICAL",  "material_name": "Mounting Brackets Aluminum",     "quantity": 8.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "MECHANICAL",  "material_name": "Fasteners Nut Bolt Screw Set",   "quantity": 100.0, "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "MECHANICAL",  "material_name": "Caster Wheels 4-pack",           "quantity": 1.0,   "unit": "set",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},

    # ----- ELECTRICAL (supply, protection, wiring) -----
    {"category": "ELECTRICAL",  "material_name": "SMPS 24V 10A",                   "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Power"},
    {"category": "ELECTRICAL",  "material_name": "MCB 16A 3-phase",                "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Fuse 10A",                       "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Relay Module 24V 10A",           "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Contactor 24V",                  "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Terminal Blocks DIN",            "quantity": 2.0,   "unit": "set",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Wiring Harness 5m",              "quantity": 2.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Wires"},
    {"category": "ELECTRICAL",  "material_name": "Power Cable 3-core 10m",         "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Wires"},
    {"category": "ELECTRICAL",  "material_name": "Switches Push 24V",              "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "LED Indicator Strip 1m",         "quantity": 2.0,   "unit": "m",     "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRICAL",  "material_name": "Cooling Fan 120mm 24V DC",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Power"},

    # ----- ELECTRONICS (control + display) -----
    {"category": "ELECTRONICS", "material_name": "Main Controller PCB 240V",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRONICS", "material_name": "Microcontroller Board STM32",    "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRONICS", "material_name": "Display Module 10-inch LCD",     "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Display"},
    {"category": "ELECTRONICS", "material_name": "RTC Module Real-time Clock",     "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "ELECTRONICS", "material_name": "USB Interface Module",           "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},

    # ----- PAYMENT -----
    {"category": "PAYMENT",     "material_name": "QR Scanner UPI",                 "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Payment Hardware"},
    {"category": "PAYMENT",     "material_name": "Coin Acceptor Multi-coin",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Payment Hardware"},
    {"category": "PAYMENT",     "material_name": "Currency Note Acceptor",         "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Payment Hardware"},
    {"category": "PAYMENT",     "material_name": "Payment Controller PCB",         "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},

    # ----- IOT (connectivity baseline) -----
    {"category": "IOT",         "material_name": "WiFi Module 802.11n",            "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "IOT",         "material_name": "Cloud Communication Board",      "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "IOT",         "material_name": "Antenna 4G LTE",                 "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},

    # ----- SENSORS (universal baseline) -----
    {"category": "SENSORS",     "material_name": "Door Sensor Reed Switch",        "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "SENSORS",     "material_name": "IR Sensor Proximity",            "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "SENSORS",     "material_name": "Limit Switch Mechanical",        "quantity": 2.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},

    # ----- BRANDING -----
    {"category": "BRANDING",    "material_name": "Vinyl Sticker Custom Print 1sqm","quantity": 1.0,   "unit": "sqm",   "item_type": "PURCHASE", "supplier_hint": "Packaging"},
    {"category": "BRANDING",    "material_name": "Brand Logo Acrylic",             "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "BRANDING",    "material_name": "Acrylic Name Plate",             "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
    {"category": "BRANDING",    "material_name": "LED Branding Strip 1m",          "quantity": 1.0,   "unit": "m",     "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "BRANDING",    "material_name": "Paint/Powder Coating 1L",        "quantity": 1.0,   "unit": "l",     "item_type": "PURCHASE", "supplier_hint": "Hardware"},
]


# ----------------------------------------------------------------
# Machine-specific add-ons. Each key contributes COOLING (where
# applicable) + DISPENSING + extra SENSORS for that machine type.
# ----------------------------------------------------------------

_COOLING_ITEMS: List[Dict] = [
    {"category": "COOLING",     "material_name": "Compressor 1/3 HP R134a",        "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Refrigeration"},
    {"category": "COOLING",     "material_name": "Condenser Coil 200x300mm",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Refrigeration"},
    {"category": "COOLING",     "material_name": "Evaporator Coil 250x400mm",      "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Refrigeration"},
    {"category": "COOLING",     "material_name": "Cooling Fan for Condenser",      "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Power"},
    {"category": "COOLING",     "material_name": "Temperature Sensor DS18B20",     "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    {"category": "COOLING",     "material_name": "Thermostat 0-100C",              "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Heating"},
    {"category": "COOLING",     "material_name": "Copper Tubing 3/8 inch 10m",     "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Refrigeration"},
    {"category": "COOLING",     "material_name": "Refrigerant Gas R134a 1kg",      "quantity": 0.8,   "unit": "kg",    "item_type": "PURCHASE", "supplier_hint": "Refrigeration"},
]


MACHINE_SPECIFIC_ITEMS: Dict[str, List[Dict]] = {
    # ----- SNACK -----
    "snack": _COOLING_ITEMS + [
        {"category": "DISPENSING",  "material_name": "Spiral Coil Helix 6-turn",       "quantity": 8.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "DC Motor 24V 30 RPM",            "quantity": 8.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "Motor Driver Board L298N",       "quantity": 8.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "DISPENSING",  "material_name": "Product Tray 8-column",          "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
        {"category": "DISPENSING",  "material_name": "Delivery Chute Stainless",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Sheet Metal"},
        {"category": "DISPENSING",  "material_name": "Product Sensor Optical",         "quantity": 8.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        # Stock-level verification per tray
        {"category": "SENSORS",     "material_name": "Weight Sensor Load Cell 5kg",    "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    ],

    # ----- COLD_DRINK -----
    "cold_drink": _COOLING_ITEMS + [
        {"category": "DISPENSING",  "material_name": "Spiral Coil Helix 6-turn",       "quantity": 6.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "DC Motor 24V 30 RPM",            "quantity": 6.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "Motor Driver Board L298N",       "quantity": 6.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "DISPENSING",  "material_name": "Bottle/Can Tray 6-row",          "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
        {"category": "DISPENSING",  "material_name": "Product Sensor Optical",         "quantity": 6.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    ],

    # ----- TEA / COFFEE (no compressor cooling — heating instead) -----
    "tea_coffee": [
        {"category": "DISPENSING",  "material_name": "Water Pump 12V Self-priming",    "quantity": 2.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Plumbing"},
        {"category": "DISPENSING",  "material_name": "Heating Element 1.5kW",          "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Heating"},
        {"category": "DISPENSING",  "material_name": "Mixing Chamber Stainless",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Sheet Metal"},
        {"category": "DISPENSING",  "material_name": "Cup Dispenser Motor 24V",        "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "Stepper Motor NEMA 17",          "quantity": 2.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "Food-grade Tubing PVC 5m",       "quantity": 2.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Plumbing"},
        {"category": "DISPENSING",  "material_name": "Water Filter Cartridge",         "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Plumbing"},
        # Boiler + outlet + cabinet temperature monitoring
        {"category": "SENSORS",     "material_name": "Temperature Sensor DS18B20",     "quantity": 3.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "SENSORS",     "material_name": "Product Sensor Optical",         "quantity": 3.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    ],

    # ----- MEDICINE (precision dispense + storage temp monitoring) -----
    "medicine": [
        {"category": "DISPENSING",  "material_name": "Stepper Motor NEMA 17",          "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Motors"},
        {"category": "DISPENSING",  "material_name": "Motor Driver Board L298N",       "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "DISPENSING",  "material_name": "Small Product Tray 4-cell",      "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Hardware"},
        {"category": "DISPENSING",  "material_name": "Delivery Chute Stainless",       "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Sheet Metal"},
        # Dose verification + safe storage monitoring
        {"category": "SENSORS",     "material_name": "Product Sensor Weight",          "quantity": 4.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "SENSORS",     "material_name": "Weight Sensor Load Cell 5kg",    "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
        {"category": "SENSORS",     "material_name": "Temperature Sensor DS18B20",     "quantity": 1.0,   "unit": "pcs",   "item_type": "PURCHASE", "supplier_hint": "Electronics"},
    ],
}


# ----------------------------------------------------------------
# CATEGORY → machine type mapping. Case-insensitive, whitespace
# tolerant. Anything not on this list falls through to "generic"
# (universal items only — no machine-specific add-ons).
# ----------------------------------------------------------------

_CATEGORY_TO_MACHINE_TYPE: Dict[str, str] = {
    # snack family
    "snack": "snack",
    "snack-beverage": "snack",
    "snack-combo": "snack",
    "snack-food": "snack",
    # cold drink family
    "cold-drink": "cold_drink",
    "cold-beverage": "cold_drink",
    "beverage": "cold_drink",
    "bottle": "cold_drink",
    "can": "cold_drink",
    # tea / coffee family
    "tea": "tea_coffee",
    "coffee": "tea_coffee",
    "tea-coffee": "tea_coffee",
    "hot-beverage": "tea_coffee",
    "hot-drink": "tea_coffee",
    # medicine family
    "medicine": "medicine",
    "pharmaceutical": "medicine",
    "pharma": "medicine",
    "health-care": "medicine",
    "healthcare": "medicine",
}


def detect_machine_type(category_string: Optional[str]) -> str:
    """Map ProductModel.CATEGORY to one of:
    'snack' | 'cold_drink' | 'tea_coffee' | 'medicine' | 'generic'.

    Forgiving on input: case-insensitive, trims whitespace, treats
    underscores and spaces as hyphens so 'Snack Beverage', 'snack_beverage'
    and 'snack-beverage' all resolve identically.
    """

    if not category_string:

        return "generic"

    key = category_string.strip().lower().replace("_", "-").replace(" ", "-")

    # Collapse runs of hyphens so 'snack--beverage' still hits.
    while "--" in key:

        key = key.replace("--", "-")

    return _CATEGORY_TO_MACHINE_TYPE.get(key, "generic")


def build_bom_for_product(category_string: Optional[str]) -> List[Dict]:
    """Combine UNIVERSAL_ITEMS + the matching MACHINE_SPECIFIC_ITEMS
    block into a single flat list of dicts ready to insert as BOMItem
    rows. Returns a fresh list each call (safe to mutate)."""

    machine_type = detect_machine_type(category_string)

    specific = MACHINE_SPECIFIC_ITEMS.get(machine_type, [])

    # Copy each dict so callers can mutate (e.g. attach ITEM_NO)
    # without poisoning the module-level constants.
    return [dict(item) for item in (UNIVERSAL_ITEMS + specific)]
