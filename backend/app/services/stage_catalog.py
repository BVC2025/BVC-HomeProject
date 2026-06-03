"""
Manufacturing stage catalogue — the canonical 40-stage workflow
that every custom vending machine project moves through, from
machine design to project closure.

Day ranges from the business spec are converted to estimated_hours
using the midpoint of the range × 8 hours/working day. "Same Day"
items are 4 hours.

Stage types map to the existing enum used by the Gantt + employee
dashboard colour coding:
  DESIGN | MECHANICAL | ELECTRICAL | WIRING | FABRICATION
  ASSEMBLY | TESTING | QC | PACKAGING | OTHER

This catalogue is universal across all machine types (snack,
tea/coffee, medicine, cold-drink) — the manufacturing flow is the
same; only the BOM (see bom_catalog.py) differs by product.
"""

from typing import List, Dict


# Tuple shape: (sequence, name, stage_type, est_hours, description, day_range)
DEFAULT_STAGES = [
    # ---- Design & engineering (Stage 1-2) ----
    (1,  "Machine Design Started → Approved",
         "DESIGN", 40,
         "Mechanical CAD drawings, customer-specific options and final design sign-off.",
         "3–7 days"),
    (2,  "Electrical Design Completed",
         "ELECTRICAL", 24,
         "Control board layout, harness routing, sensor placement, schematics finalised.",
         "2–4 days"),

    # ---- BOM (Stage 3-4) ----
    (3,  "BOM Preparation Started",
         "OTHER", 12,
         "Bill of Materials drafted from approved drawings — every part listed with quantity and supplier hint.",
         "1–2 days"),
    (4,  "BOM Approved",
         "OTHER", 8,
         "Procurement + engineering joint sign-off on the BOM. Costs and lead times locked.",
         "1 day"),

    # ---- Procurement (Stage 5-9) ----
    (5,  "Purchase Request Raised",
         "OTHER", 8,
         "PRs raised against the approved BOM.",
         "1 day"),
    (6,  "Vendor Selected",
         "OTHER", 16,
         "Quotes evaluated, suppliers shortlisted per category.",
         "1–3 days"),
    (7,  "Purchase Order Issued",
         "OTHER", 8,
         "POs released to all selected vendors; payment terms locked.",
         "1 day"),
    (8,  "Materials Received",
         "OTHER", 80,
         "Inwarded materials from every supplier — typically the longest waiting stage.",
         "5–15 days"),
    (9,  "Material Quality Check Completed",
         "QC", 8,
         "Goods inspected against PO specs. Rejected items returned via GRN.",
         "1 day"),

    # ---- Production kickoff (Stage 10) ----
    (10, "Production Released",
         "OTHER", 4,
         "Production order issued to the shop floor — materials staged, work orders printed.",
         "same day"),

    # ---- Fabrication (Stage 11-16) ----
    (11, "Sheet Metal Cutting Completed",
         "FABRICATION", 12,
         "CNC / laser-cut every sheet metal panel per the cutting plan.",
         "1–2 days"),
    (12, "Bending Completed",
         "FABRICATION", 8,
         "Press-brake bending of all cut panels to dimensional tolerance.",
         "1 day"),
    (13, "Welding Completed",
         "FABRICATION", 20,
         "Frame and cabinet welding — TIG/MIG per drawing call-outs.",
         "2–3 days"),
    (14, "Machine Body Fabrication Completed",
         "FABRICATION", 12,
         "Body sub-assemblies finalised, fit checks pass, ready for finishing.",
         "1–2 days"),
    (15, "Powder Coating / Painting Completed",
         "FABRICATION", 20,
         "Surface prep, powder coating or wet paint, cure cycle complete.",
         "2–3 days"),
    (16, "Branding Sticker Applied",
         "FABRICATION", 8,
         "Vinyl branding, logo decals and serial-number plates applied to cured cabinet.",
         "1 day"),

    # ---- Electrical & Electronics (Stage 17-22) ----
    (17, "Electrical Components Installed",
         "ELECTRICAL", 12,
         "SMPS, MCB, contactors, terminal blocks mounted and torqued.",
         "1–2 days"),
    (18, "Wiring Completed",
         "WIRING", 12,
         "Power + signal harnesses routed, labelled and tied. Continuity checked.",
         "1–2 days"),
    (19, "Controller Installed",
         "ELECTRICAL", 8,
         "Main controller PCB mounted, addressed, smoke-tested.",
         "1 day"),
    (20, "Motors Installed",
         "ASSEMBLY", 8,
         "DC + stepper motors mounted to spirals/trays with motor drivers wired in.",
         "1 day"),
    (21, "Sensors Installed",
         "ELECTRICAL", 8,
         "Door, product, IR, limit and temperature sensors mounted and calibrated.",
         "1 day"),
    (22, "Display Installed",
         "ASSEMBLY", 8,
         "Display module + touchscreen (if applicable) fitted, ribbon cabled to controller.",
         "1 day"),

    # ---- Software (Stage 23-25) ----
    (23, "Software Development Completed",
         "ELECTRICAL", 108,
         "Firmware / control software finalised. The longest engineering stage on a custom build.",
         "7–20 days"),
    (24, "Payment Integration Completed",
         "ELECTRICAL", 28,
         "UPI QR, coin acceptor and card reader integrated with payment controller; end-to-end flow tested.",
         "2–5 days"),
    (25, "Software Installed in Machine",
         "ELECTRICAL", 8,
         "Final firmware flashed into the on-machine controller, configuration applied.",
         "1 day"),

    # ---- Assembly + Testing (Stage 26-30) ----
    (26, "Machine Assembly Completed",
         "ASSEMBLY", 12,
         "All sub-assemblies + electrical + software mated into the final unit. Ready to power on.",
         "1–2 days"),
    (27, "Functional Testing Completed",
         "TESTING", 8,
         "Full functional smoke test — boot, menu navigation, sensor read-back, motor exercise.",
         "1 day"),
    (28, "Payment Testing Completed",
         "TESTING", 8,
         "Live payment cycle — UPI / coin / card paths verified end-to-end against the live gateway.",
         "1 day"),
    (29, "Dispense Testing Completed",
         "TESTING", 8,
         "Each product slot exercised; dispense reliability across at least 20 cycles per slot.",
         "1 day"),
    (30, "Quality Check Completed",
         "QC", 12,
         "QC checklist signed off — gates the customer demo. NCRs raised for any deviations.",
         "1–2 days"),

    # ---- Customer (Stage 31-32) ----
    (31, "Customer Demo Conducted",
         "OTHER", 8,
         "On-site / video demo for the customer. Their team walks through the full flow.",
         "1 day"),
    (32, "Customer Approval Received",
         "OTHER", 16,
         "Customer signs off on the build. Triggers dispatch readiness.",
         "1–3 days"),

    # ---- Packing & Dispatch (Stage 33-35) ----
    (33, "Packing Completed",
         "PACKAGING", 8,
         "Foam, corner protectors, plywood crate, packing list affixed.",
         "1 day"),
    (34, "Invoice Generated",
         "OTHER", 4,
         "Tax invoice raised, GST e-Invoice generated, e-Way Bill (if applicable).",
         "same day"),
    (35, "Dispatch Completed",
         "PACKAGING", 8,
         "Loaded onto truck, LR/POD captured, dispatched towards customer site.",
         "1 day"),

    # ---- Installation & Handover (Stage 36-40) ----
    (36, "Installation Completed",
         "ASSEMBLY", 16,
         "Field engineers install at customer site — power, network, anchoring, calibration on location.",
         "1–3 days"),
    (37, "Customer Training Completed",
         "OTHER", 4,
         "End-user training — load/unload, daily reports, basic troubleshooting.",
         "same day"),
    (38, "Handover Completed",
         "OTHER", 4,
         "Formal handover document signed by the customer. Machine accepted.",
         "same day"),
    (39, "Warranty Activated",
         "OTHER", 4,
         "Warranty card issued, AMC contract (if any) activated, serial number registered in support system.",
         "same day"),
    (40, "Project Closed",
         "OTHER", 4,
         "All deliverables done. Internal project status flipped to CLOSED. Final P&L computed.",
         "same day"),
]


def build_stages_for_product(category: str = None) -> List[Dict]:
    """Return the full 40-stage list, one dict per stage. The
    category argument is accepted for forward compatibility (in case
    we ever want to vary the stage flow per machine type) but is
    currently ignored — all vending machine builds share the same
    workflow. The BOM differs by category; the manufacturing process
    is universal.

    Each dict matches the ProcessStage column layout expected by
    seed_default_stages_for_product:
      { sequence, stage_name, stage_type, estimated_hours, description }
    """

    out = []

    for seq, name, stype, hours, desc, day_range in DEFAULT_STAGES:

        out.append({
            "sequence":         seq,
            "stage_name":       name,
            "stage_type":       stype,
            "estimated_hours":  hours,
            "description":      f"{desc} (Typical duration: {day_range}.)"
        })

    return out


def total_estimated_days() -> float:
    """Sum of all stage hours / 8 — useful for the admin preview
    and project-target-date defaults."""

    total_h = sum(h for _, _, _, h, _, _ in DEFAULT_STAGES)

    return round(total_h / 8.0, 1)


def stage_count() -> int:

    return len(DEFAULT_STAGES)
