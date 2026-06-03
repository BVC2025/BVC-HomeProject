# =========================
# PROJECT TEMPLATE CATALOG
# =========================
# Global catalog of project categories and the sub-project
# templates inside each one. Grouped by SECTION so the UI
# can offer a 3-level pick: Section -> Category -> Sub-Project.
#
# Shape:
#   "SECTION_NAME": {
#       "Category Name": [
#           (sub_name, sub_desc, estimated_days),
#           ...
#       ]
#   }

PROJECT_TEMPLATE_CATALOG = {
    "TECHNOLOGY": {
        "Web Development": [
            ("E-commerce", "Online store with cart, checkout, payment, admin panel.", 60),
            ("Portfolio Site", "Personal/agency portfolio with project showcase.", 14),
            ("Booking System", "Calendar-based appointment booking with reminders.", 45),
            ("CMS Website", "Content-managed website with blog and pages.", 30),
            ("SaaS Dashboard", "Multi-tenant dashboard with role-based access.", 75),
        ],
        "Mobile Development": [
            ("Food Delivery App", "Customer + driver + restaurant apps with live tracking.", 90),
            ("Fitness Tracker", "Activity tracking with charts and goals.", 45),
            ("Chat Messaging App", "Real-time chat with media, calls, push.", 75),
            ("Ride Hailing App", "Two-sided rider + driver marketplace with maps.", 90),
        ],
        "AI / Machine Learning": [
            ("Chatbot", "LLM-powered chat agent with knowledge base.", 30),
            ("Recommendation Engine", "Personalised item recommendations using user behaviour.", 45),
            ("Computer Vision OCR", "Document OCR pipeline with extraction.", 60),
            ("Sentiment Analyzer", "Text classification for reviews / social posts.", 30),
        ],
        "Cloud / DevOps": [
            ("CI/CD Pipeline Setup", "GitHub Actions / Jenkins pipeline for build + deploy.", 14),
            ("Kubernetes Migration", "Containerise + orchestrate existing services.", 60),
            ("Cloud Cost Optimisation", "AWS/GCP cost audit with action plan.", 21),
        ],
        "Data Engineering": [
            ("ETL Pipeline", "Source-to-warehouse data pipeline with scheduler.", 45),
            ("Data Warehouse Setup", "Snowflake / BigQuery warehouse with star schema.", 60),
            ("Dashboard / BI Reporting", "Power BI / Metabase dashboards on warehouse.", 30),
        ],
        "Cybersecurity": [
            ("Penetration Test", "External + internal pen test with report.", 21),
            ("Security Audit", "OWASP-aligned audit of an existing application.", 21),
            ("SOC 2 Readiness", "Gap analysis + remediation plan for SOC 2.", 90),
        ]
    },
    "INDUSTRY": {
        "Healthcare": [
            ("Hospital Management System", "OPD, IPD, billing, pharmacy, lab modules.", 120),
            ("Telemedicine Platform", "Video consult + e-prescription + payments.", 75),
            ("Clinic Appointment System", "Slot booking, doctor calendar, reminders.", 45),
            ("EMR / EHR System", "Electronic medical records with role-based access.", 90),
        ],
        "Manufacturing": [
            ("Vendor-based Manufacturing ERP", "Production planning, inventory, tasks, attendance.", 120),
            ("Production Scheduler", "Machine-aware job scheduling with shifts.", 60),
            ("Inventory Tracker", "Raw material + WIP + finished goods tracking.", 45),
            ("Quality Control System", "Inspection checklists with NCR + RCA workflow.", 45),
        ],
        "Retail": [
            ("POS System", "Point-of-sale with inventory + payments.", 45),
            ("Loyalty Program", "Points, tiers, rewards engine.", 30),
            ("Inventory Management", "Multi-store stock + reorder alerts.", 45),
        ],
        "Education": [
            ("Learning Management System", "Courses, quizzes, gradebook, video hosting.", 75),
            ("School ERP", "Student, teacher, fees, exams, timetables.", 90),
            ("Online Exam Platform", "Proctored online exams with autograding.", 45),
        ],
        "Finance / Banking": [
            ("Loan Origination System", "Application, KYC, underwriting, disbursement.", 90),
            ("Wallet / UPI App", "Digital wallet with P2P + merchant payments.", 75),
            ("Stock Trading Platform", "Real-time quotes, orders, portfolios.", 120),
        ],
        "Logistics / Supply Chain": [
            ("Fleet Management", "Vehicle tracking, fuel, driver, maintenance.", 60),
            ("Warehouse Management System", "Receiving, putaway, picking, packing.", 75),
            ("Last-Mile Delivery App", "Driver app + route optimisation + POD.", 60),
        ],
        "Real Estate": [
            ("Property Listing Portal", "Search, listings, lead capture, agent panel.", 45),
            ("Rental Management System", "Tenant, lease, rent collection, maintenance.", 60),
        ]
    }
}


# =========================
# ORG PRESETS
# =========================
# A preset is a starter set of (departments + designations)
# that a tenant picks at signup. Each tenant ends up with
# editable rows in their own scope.

ORG_PRESETS = {
    "MANUFACTURING": {
        "label": "Manufacturing (vending machines, factories, fabrication)",
        "departments": [
            ("Software", "SW", [
                ("Software Engineer", 60000),
                ("Senior Software Engineer", 95000),
                ("Embedded Developer", 70000),
            ]),
            ("Design", "DSN", [
                ("Product Designer", 55000),
                ("CAD Engineer", 60000),
                ("UI/UX Designer", 55000),
            ]),
            ("Procurement", "PROC", [
                ("Procurement Officer", 45000),
                ("Procurement Manager", 75000),
            ]),
            ("Welding", "WLD", [
                ("Junior Welder", 25000),
                ("Senior Welder", 45000),
                ("Welding Supervisor", 60000),
            ]),
            ("Fabrication", "FAB", [
                ("Fabricator", 30000),
                ("Senior Fabricator", 48000),
            ]),
            ("Production", "PRD", [
                ("Production Operator", 28000),
                ("Production Supervisor", 50000),
                ("Production Head", 80000),
            ]),
            ("Assembly", "ASM", [
                ("Assembly Technician", 30000),
                ("Senior Assembler", 45000),
                ("Assembly Lead", 60000),
            ]),
            ("Electrical", "ELEC", [
                ("Electrician", 35000),
                ("Senior Electrician", 50000),
            ]),
            ("Electronics", "ELTR", [
                ("Electronics Technician", 38000),
                ("Senior Electronics Engineer", 65000),
            ]),
            ("Quality Control", "QC", [
                ("QC Inspector", 40000),
                ("Senior QC Inspector", 55000),
                ("QC Manager", 75000),
            ]),
            ("Service", "SVC", [
                ("Service Engineer", 35000),
                ("Senior Service Engineer", 55000),
            ]),
            ("Installation", "INST", [
                ("Installation Technician", 32000),
                ("Installation Lead", 48000),
            ]),
            ("Packaging & Dispatch", "PKG", [
                ("Packaging Operator", 25000),
                ("Dispatch Coordinator", 38000),
            ]),
        ]
    },
    "SOFTWARE": {
        "label": "Software / IT services",
        "departments": [
            ("Frontend", "FE", [
                ("Junior Frontend Developer", 45000),
                ("Senior Frontend Developer", 95000),
            ]),
            ("Backend", "BE", [
                ("Junior Backend Developer", 50000),
                ("Senior Backend Developer", 110000),
            ]),
            ("DevOps", "OPS", [
                ("DevOps Engineer", 80000),
                ("Senior DevOps Engineer", 130000),
            ]),
            ("QA", "QA", [
                ("QA Engineer", 50000),
                ("QA Lead", 85000),
            ]),
            ("Design", "DSN", [
                ("UI Designer", 55000),
                ("UX Designer", 65000),
            ]),
            ("Product", "PRD", [
                ("Product Manager", 110000),
                ("Project Manager", 95000),
            ]),
        ]
    },
    "SERVICE": {
        "label": "Service / consulting",
        "departments": [
            ("Sales", "SLS", [
                ("Sales Executive", 40000),
                ("Sales Manager", 80000),
            ]),
            ("Operations", "OPS", [
                ("Operations Executive", 45000),
                ("Operations Manager", 85000),
            ]),
            ("Support", "SUP", [
                ("Support Agent", 30000),
                ("Senior Support Agent", 45000),
            ]),
            ("Accounts", "ACC", [
                ("Accountant", 45000),
                ("Senior Accountant", 70000),
            ]),
        ]
    }
}


# =========================
# PERMISSIONS CATALOG
# =========================
# Format: (CODE, NAME, CATEGORY, DESCRIPTION)

PERMISSIONS_CATALOG = [
    # Employees
    ("employee.view", "View employees", "Employees", "See employee list and profiles"),
    ("employee.create", "Create employees", "Employees", "Add new employees"),
    ("employee.update", "Edit employees", "Employees", "Edit employee details"),
    ("employee.delete", "Delete employees", "Employees", "Remove employees"),

    # Departments / org
    ("org.view", "View org structure", "Organization", "See departments and designations"),
    ("org.manage", "Manage org structure", "Organization", "Create/edit departments and designations"),
    ("role.manage", "Manage roles", "Organization", "Edit roles and their permissions"),

    # Attendance
    ("attendance.view.self", "View own attendance", "Attendance", ""),
    ("attendance.view.team", "View team attendance", "Attendance", "Attendance for own department"),
    ("attendance.view.all", "View all attendance", "Attendance", ""),
    ("attendance.mark.others", "Mark attendance for others", "Attendance", "HR / admin override"),

    # Customer
    ("customer.view", "View customers", "Customers", ""),
    ("customer.manage", "Manage customers", "Customers", "Create/edit/delete customers"),
    ("quotation.manage", "Manage quotations", "Customers", "Create and approve quotations"),

    # Projects
    ("project.view", "View projects", "Projects", ""),
    ("project.create", "Create projects", "Projects", ""),
    ("project.update", "Edit projects", "Projects", ""),
    ("project.delete", "Delete projects", "Projects", ""),

    # Tasks
    ("task.view.self", "View own tasks", "Tasks", ""),
    ("task.view.team", "View team tasks", "Tasks", "Tasks across own department"),
    ("task.view.all", "View all tasks", "Tasks", ""),
    ("task.assign", "Assign tasks", "Tasks", "Assign tasks to employees"),
    ("task.update.status", "Update task status", "Tasks", "Start / Complete / Hold"),
    ("task.qc.approve", "Approve QC", "Tasks", "Move task from QC to Completed"),
    ("task.qc.reject", "Reject QC", "Tasks", "Send task back to Rework"),

    # Inventory
    ("inventory.view", "View inventory", "Inventory", ""),
    ("inventory.consume", "Consume inventory", "Inventory", "Issue materials to a task"),
    ("inventory.purchase", "Purchase / receive stock", "Inventory", "Add stock from suppliers"),

    # Manufacturing / machines
    ("machine.view", "View machines", "Manufacturing", ""),
    ("machine.update.stage", "Update machine stage", "Manufacturing", ""),

    # Reports
    ("report.export", "Export reports", "Reports", "PDF / Excel"),

    # Notifications
    ("notification.broadcast", "Broadcast notifications", "Notifications", "Send to all staff"),

    # Settings
    ("setting.modify", "Modify system settings", "Settings", ""),

    # Audit
    ("audit.view", "View audit log", "Settings", ""),

    # ---- Phase: User & Role Management (Admin Module 2) ----
    # Sales / Quotation / SO
    ("sales_order.view",   "View sales orders",      "Sales",     ""),
    ("sales_order.manage", "Manage sales orders",    "Sales",     "Create / edit / cancel / record payments"),

    # Purchase / Suppliers / GRN
    ("supplier.manage",     "Manage suppliers",      "Purchase",  ""),
    ("purchase_order.view", "View purchase orders",  "Purchase",  ""),
    ("purchase_order.manage", "Manage purchase orders", "Purchase", "Create / approve / receive GRN"),

    # Payroll
    ("payroll.view",   "View payroll runs",          "Payroll",   ""),
    ("payroll.manage", "Generate / finalise payroll", "Payroll",  ""),

    # Accounts
    ("payment.record",  "Record customer payment",   "Accounts",  ""),
    ("accounts.view",   "View financial dashboards", "Accounts",  ""),

    # Leave (admin view + decide)
    ("leave.view.all", "View all leaves",            "Leave",     ""),
    ("leave.decide",   "Approve / reject leaves",    "Leave",     ""),
]


# =========================
# STANDARD ROLES + their permissions
# =========================
# Format: (ROLE_NAME, DESCRIPTION, [permission codes])

STANDARD_ROLES = [
    ("SUPER_ADMIN", "Full access to everything", "*"),
    # "*" means all permissions

    ("ADMIN", "Day-to-day admin access", [
        "employee.view", "employee.create", "employee.update",
        "org.view", "org.manage", "role.manage",
        "attendance.view.all", "attendance.mark.others",
        "customer.view", "customer.manage", "quotation.manage",
        "project.view", "project.create", "project.update", "project.delete",
        "task.view.all", "task.assign", "task.update.status",
        "inventory.view", "inventory.purchase",
        "machine.view", "machine.update.stage",
        "report.export", "notification.broadcast",
        "setting.modify", "audit.view"
    ]),

    ("HR", "Human resources", [
        "employee.view", "employee.create", "employee.update",
        "org.view",
        "attendance.view.all", "attendance.mark.others",
        "report.export"
    ]),

    ("MANAGER", "Department manager", [
        "employee.view",
        "org.view",
        "attendance.view.team",
        "customer.view",
        "project.view", "project.create", "project.update",
        "task.view.team", "task.assign", "task.update.status",
        "inventory.view", "inventory.consume",
        "machine.view", "machine.update.stage",
        "report.export"
    ]),

    ("PRODUCTION_HEAD", "Production / manufacturing head", [
        "employee.view",
        "org.view",
        "attendance.view.team",
        "project.view", "project.update",
        "task.view.all", "task.assign", "task.update.status",
        "inventory.view", "inventory.consume", "inventory.purchase",
        "machine.view", "machine.update.stage",
        "report.export"
    ]),

    ("QC", "Quality control", [
        "employee.view",
        "attendance.view.self",
        "project.view",
        "task.view.team", "task.update.status",
        "task.qc.approve", "task.qc.reject",
        "machine.view", "machine.update.stage",
        "report.export"
    ]),

    ("EMPLOYEE", "Regular employee — own data only", [
        "attendance.view.self",
        "task.view.self", "task.update.status"
    ]),

    # ====================================================================
    # Admin Module 2 — 9 BVC24 role catalogue
    # ====================================================================

    ("MANAGING_DIRECTOR", "Read-only oversight across every module", [
        "employee.view",
        "org.view",
        "attendance.view.all",
        "customer.view",
        "project.view",
        "task.view.all",
        "inventory.view",
        "machine.view",
        "sales_order.view",
        "purchase_order.view",
        "payroll.view",
        "accounts.view",
        "leave.view.all",
        "report.export",
        "audit.view"
    ]),

    ("HR_MANAGER", "HR — full employee lifecycle + leave + payroll view", [
        "employee.view", "employee.create", "employee.update", "employee.delete",
        "org.view", "org.manage",
        "attendance.view.all", "attendance.mark.others",
        "leave.view.all", "leave.decide",
        "payroll.view",
        "report.export"
    ]),

    ("SALES_MANAGER", "Sales — customers, quotations, sales orders", [
        "customer.view", "customer.manage",
        "quotation.manage",
        "sales_order.view", "sales_order.manage",
        "project.view",
        "report.export"
    ]),

    ("PURCHASE_MANAGER", "Procurement — suppliers, POs, GRN", [
        "supplier.manage",
        "purchase_order.view", "purchase_order.manage",
        "inventory.view", "inventory.purchase",
        "report.export"
    ]),

    ("PRODUCTION_MANAGER", "Production — projects, work orders, tasks", [
        "employee.view",
        "org.view",
        "attendance.view.team",
        "project.view", "project.create", "project.update",
        "task.view.all", "task.assign", "task.update.status",
        "task.qc.approve", "task.qc.reject",
        "inventory.view", "inventory.consume",
        "machine.view", "machine.update.stage",
        "report.export"
    ]),

    ("INVENTORY_MANAGER", "Inventory + stock movement + GRN", [
        "inventory.view", "inventory.consume", "inventory.purchase",
        "purchase_order.view",
        "report.export"
    ]),

    ("ACCOUNTS_MANAGER", "Finance — payroll, payments, accounts", [
        "payroll.view", "payroll.manage",
        "sales_order.view",
        "purchase_order.view",
        "payment.record",
        "accounts.view",
        "report.export"
    ]),
]


MATERIAL_CATALOG = [
    "Steel Bolt",
    "Hex Nut",
    "Washer",
    "Screw Driver",
    "Drill Bit",
    "Safety Gloves",
    "Safety Helmet",
    "Face Mask",
    "Safety Goggles",
    "Bearing Set",
    "Copper Wire",
    "PVC Pipe",
    "Electrical Fuse",
    "Motor Switch",
    "Machine Oil",
    "Hydraulic Oil",
    "Rubber Seal",
    "Plastic Gear",
    "Cutting Blade",
    "Measuring Tape",
    "Hammer",
    "Adjustable Spanner",
    "Allen Key Set",
    "Welding Rod",
    "Cable Tie",
    "Industrial Adhesive",
    "Sand Paper",
    "Paint Spray",
    "Air Filter",
    "Water Filter",
    "Conveyor Belt",
    "Gear Motor",
    "Ball Bearing",
    "Spring Washer",
    "Lock Nut",
    "Digital Multimeter",
    "Insulation Tape",
    "Power Relay",
    "Sensor Switch",
    "Pneumatic Tube"
]


EMPLOYEES = [
    {
        "EMPLOYEE_ID": "EMP001",
        "EMPLOYEE_NAME": "Arjun Kumar",
        "DEPARTMENT": "Design",
        "PASSWORD": "emp001",
        "ROLE": "DESIGNER"
    },
    {
        "EMPLOYEE_ID": "EMP002",
        "EMPLOYEE_NAME": "Ravi Shankar",
        "DEPARTMENT": "Procurement",
        "PASSWORD": "emp002",
        "ROLE": "PROCUREMENT_OFFICER"
    },
    {
        "EMPLOYEE_ID": "EMP003",
        "EMPLOYEE_NAME": "Suresh Babu",
        "DEPARTMENT": "Fabrication",
        "PASSWORD": "emp003",
        "ROLE": "FABRICATOR"
    },
    {
        "EMPLOYEE_ID": "EMP004",
        "EMPLOYEE_NAME": "Karthik Raj",
        "DEPARTMENT": "Welding",
        "PASSWORD": "emp004",
        "ROLE": "WELDER"
    },
    {
        "EMPLOYEE_ID": "EMP005",
        "EMPLOYEE_NAME": "Manoj Kumar",
        "DEPARTMENT": "Assembly",
        "PASSWORD": "emp005",
        "ROLE": "ASSEMBLER"
    },
    {
        "EMPLOYEE_ID": "EMP006",
        "EMPLOYEE_NAME": "Vignesh R",
        "DEPARTMENT": "Electrical",
        "PASSWORD": "emp006",
        "ROLE": "ELECTRICIAN"
    },
    {
        "EMPLOYEE_ID": "EMP007",
        "EMPLOYEE_NAME": "Dinesh K",
        "DEPARTMENT": "Electronics",
        "PASSWORD": "emp007",
        "ROLE": "ELECTRONICS_TECH"
    },
    {
        "EMPLOYEE_ID": "EMP008",
        "EMPLOYEE_NAME": "Praveen S",
        "DEPARTMENT": "Software",
        "PASSWORD": "emp008",
        "ROLE": "SOFTWARE_ENGINEER"
    },
    {
        "EMPLOYEE_ID": "EMP009",
        "EMPLOYEE_NAME": "Hari Prasad",
        "DEPARTMENT": "Quality Control",
        "PASSWORD": "emp009",
        "ROLE": "QC_INSPECTOR"
    },
    {
        "EMPLOYEE_ID": "EMP010",
        "EMPLOYEE_NAME": "Sanjay M",
        "DEPARTMENT": "Packaging & Dispatch",
        "PASSWORD": "emp010",
        "ROLE": "PACKAGING_LEAD"
    }
]


# 30-day task plan per employee
# Each tuple: (day_number, task_name, task_details)

TASKS = {
    "EMP001": [
        ("Project kickoff meeting", "Define vending machine type, production quantity, and project objectives."),
        ("CAD dimension planning", "Prepare base CAD dimensions and tolerances for the cabinet."),
        ("3D model preparation", "Build 3D solid model of the cabinet enclosure."),
        ("Component layout design", "Lay out internal components inside the cabinet."),
        ("Design review meeting", "Walk through preliminary design with stakeholders."),
        ("Cabinet structural design", "Finalize the structural drawing of cabinet body."),
        ("Cooling system design", "Design refrigeration airflow and condenser placement."),
        ("Display panel layout", "Design display window cutout and panel placement."),
        ("Component placement optimization", "Optimize internal component fitment."),
        ("Final design approval", "Get sign-off on the consolidated design pack."),
        ("Manufacturing drawing preparation", "Convert design to manufacturing drawings."),
        ("Tolerance specification", "Apply GD&T tolerances to drawings."),
        ("Material selection finalization", "Finalize sheet metal grades and finishes."),
        ("Coordinate fabrication drawings", "Hand over fabrication drawings to shop floor."),
        ("Welding drawing preparation", "Mark weld symbols on assembly drawings."),
        ("Assembly drawing review", "Cross-check assembly drawings with shop floor."),
        ("Wiring diagram coordination", "Align cabinet design with electrical wiring."),
        ("Component fitment check", "Verify component fit in 3D mockup."),
        ("Design change tracking", "Log ECRs raised during production."),
        ("Quality drawing review", "Provide drawings to QC for inspection plan."),
        ("Final assembly drawing", "Issue final assembly drawing set."),
        ("Documentation prep", "Compile design documentation package."),
        ("Manual cover design", "Design product manual cover and layout."),
        ("User interface mockup", "Create UI mockup for vending screen."),
        ("Design validation", "Run design validation against requirements."),
        ("Design issue resolution", "Address issues raised by QC and production."),
        ("Field test design feedback", "Capture design feedback from pilot units."),
        ("Production handover docs", "Hand over master design dossier to production."),
        ("Design archive preparation", "Archive design files in PLM system."),
        ("Project closure documentation", "Close design phase with final report.")
    ],
    "EMP002": [
        ("Supplier list preparation", "Compile list of approved suppliers for materials."),
        ("Vendor contact collection", "Collect vendor contact details and PO terms."),
        ("Quotation request", "Send RFQs to shortlisted vendors."),
        ("Price comparison analysis", "Compare vendor quotes and select best option."),
        ("Vendor negotiation", "Negotiate price and delivery terms."),
        ("Purchase order release", "Release POs for raw materials."),
        ("Sheet metal procurement", "Order MS sheets and SS sheets."),
        ("Hardware procurement", "Order fasteners and hardware kits."),
        ("Electronics procurement", "Order PCBs and electronic modules."),
        ("Software license procurement", "Procure required software licenses."),
        ("Display unit procurement", "Order LCD display modules."),
        ("Sensor procurement", "Order proximity and temperature sensors."),
        ("Cooling unit procurement", "Order refrigeration compressors."),
        ("Coin/Note acceptor procurement", "Order coin and note acceptor units."),
        ("Cable & connector procurement", "Order cables and connector kits."),
        ("Packaging material order", "Order cartons and foam packaging."),
        ("Delivery tracking", "Track inbound deliveries from vendors."),
        ("Quality inspection coordination", "Coordinate IQC for incoming materials."),
        ("Spare parts procurement", "Order spares for first batch production."),
        ("Vendor invoice processing", "Process vendor invoices for payment."),
        ("Logistics coordination", "Coordinate with logistics for movements."),
        ("Stock verification", "Verify stock against PO and GRN."),
        ("Supplier performance review", "Review supplier OTIF performance."),
        ("Backup vendor identification", "Identify alternate vendors for risk."),
        ("Cost analysis report", "Prepare cost analysis report for procurement."),
        ("Material movement coordination", "Coordinate material movement to shop."),
        ("Vendor payment processing", "Release final payments to vendors."),
        ("Procurement records update", "Update procurement records in ERP."),
        ("Vendor feedback collection", "Collect feedback from internal users."),
        ("Procurement closure report", "Submit procurement closure report.")
    ],
    "EMP003": [
        ("Material requirement analysis", "Analyze material requirements based on BOM."),
        ("Sheet metal stock verification", "Verify sheet metal stock available in store."),
        ("Cutting plan preparation", "Prepare cutting plan to minimize wastage."),
        ("CNC machine setup", "Set up CNC machine for sheet cutting."),
        ("Sheet cutting operation", "Cut sheets as per cutting plan."),
        ("Bending operation", "Bend cut sheets as per drawing."),
        ("Drilling operation", "Drill holes for mounting points."),
        ("Cabinet body fabrication", "Fabricate cabinet body structure."),
        ("Door panel fabrication", "Fabricate cabinet door panels."),
        ("Frame structure fabrication", "Fabricate internal frame."),
        ("Internal shelf fabrication", "Fabricate internal storage shelves."),
        ("Display window cutting", "Cut display window opening."),
        ("Edge finishing", "Deburr and finish sheet metal edges."),
        ("Surface preparation", "Prepare surface for powder coating."),
        ("Powder coating", "Apply powder coating finish to cabinet."),
        ("Quality check on fabricated parts", "Inspect fabricated parts dimensionally."),
        ("Painting touch-up", "Touch up paint defects."),
        ("Defect rectification", "Rectify any fabrication defects."),
        ("Component fit testing", "Test fit components to fabricated parts."),
        ("Sub-assembly fabrication", "Fabricate cabinet sub-assemblies."),
        ("Custom bracket fabrication", "Fabricate custom mounting brackets."),
        ("Cooling vent fabrication", "Fabricate cooling vents and grilles."),
        ("Lock mechanism fabrication", "Fabricate lock mechanism housing."),
        ("Final fabrication review", "Review all fabricated parts for completeness."),
        ("Fabrication area cleanup", "Clean fabrication shop area."),
        ("Production batch prep", "Prepare for next production batch."),
        ("Fabrication report", "Submit fabrication completion report."),
        ("Machine maintenance", "Maintain CNC and bending machines."),
        ("Tools inventory check", "Audit fabrication tools inventory."),
        ("Fabrication closeout", "Close out fabrication phase.")
    ],
    "EMP004": [
        ("Fabrication tool inspection", "Inspect all welding tools and fixtures."),
        ("Welding machine maintenance", "Maintain MIG and TIG welding machines."),
        ("Welding rod stock check", "Check welding rod and wire stock."),
        ("Frame joint welding", "Weld cabinet frame joints."),
        ("Body shell welding", "Weld cabinet body shell."),
        ("Internal structure welding", "Weld internal cabinet structure."),
        ("Cabinet back panel welding", "Weld back panel to cabinet."),
        ("Door frame welding", "Weld cabinet door frames."),
        ("Coin tray welding", "Weld coin tray assembly."),
        ("Support bracket welding", "Weld support brackets to cabinet."),
        ("Sheet seam welding", "Weld seams on cabinet sheets."),
        ("Refrigeration mount welding", "Weld refrigeration unit mounts."),
        ("Display frame welding", "Weld display panel frame."),
        ("Bottom plate welding", "Weld cabinet bottom plate."),
        ("Top cover welding", "Weld cabinet top cover."),
        ("Spot welding operations", "Perform spot welding on sheet joins."),
        ("TIG welding details", "TIG weld stainless steel details."),
        ("MIG welding production", "MIG weld main structural parts."),
        ("Weld grinding", "Grind welds smooth for finishing."),
        ("Joint inspection", "Inspect welded joints visually."),
        ("Defect repair welding", "Repair any defective welds."),
        ("Final pass welding", "Complete final pass welds."),
        ("Weld bead cleanup", "Clean weld beads and spatter."),
        ("Hot work permit closure", "Close hot work permits."),
        ("Welding QC review", "Review welding quality with QC."),
        ("Sub-assembly welding", "Weld sub-assemblies for next stage."),
        ("Documentation update", "Update welding records."),
        ("Helmet & PPE check", "Audit welding PPE."),
        ("Workshop cleaning", "Clean welding workshop."),
        ("Welding completion report", "Submit welding closure report.")
    ],
    "EMP005": [
        ("Assembly workflow planning", "Plan assembly line workflow and stations."),
        ("Cabinet assembly planning", "Plan cabinet assembly sequence."),
        ("Sub-assembly preparation", "Prepare sub-assembly kits."),
        ("Cabinet body assembly", "Assemble cabinet body structure."),
        ("Door installation", "Install cabinet doors."),
        ("Internal shelf installation", "Install internal storage shelves."),
        ("Cooling unit installation", "Install refrigeration cooling unit."),
        ("Display panel mounting", "Mount display panel to cabinet."),
        ("Coin mechanism mounting", "Mount coin acceptor mechanism."),
        ("Note acceptor installation", "Install note acceptor module."),
        ("Dispenser tray fitting", "Fit product dispenser trays."),
        ("Cable routing", "Route cables through cabinet."),
        ("Heater installation", "Install heating element for hot products."),
        ("Lock & key fitting", "Fit door lock and keys."),
        ("Front fascia attachment", "Attach front fascia panel."),
        ("Backplate attachment", "Attach back panel cover."),
        ("Lighting installation", "Install interior LED lighting."),
        ("Branding sticker application", "Apply brand stickers to cabinet."),
        ("Functional check", "Functional check of assembled unit."),
        ("Sub-assembly cross-check", "Cross-check all sub-assemblies."),
        ("Mechanical adjustment", "Adjust mechanical alignments."),
        ("Vibration test", "Vibration test assembled unit."),
        ("Hinge alignment", "Align door hinges."),
        ("Gasket sealing", "Apply gaskets and sealing."),
        ("Mechanical integration with electrical", "Coordinate with electrical team."),
        ("Pre-final assembly review", "Pre-final assembly review."),
        ("Final fitting", "Final fitting and touch-up."),
        ("Assembly QC", "Submit unit for assembly QC."),
        ("Defect rectification", "Rectify any defects from QC."),
        ("Assembly completion sign-off", "Get sign-off on completed assembly.")
    ],
    "EMP006": [
        ("Electrical requirement planning", "Plan electrical requirements per unit."),
        ("Wiring diagram preparation", "Prepare wiring diagrams."),
        ("Cable cutting & labeling", "Cut and label cables per drawing."),
        ("Main power cable installation", "Install main power cable."),
        ("Switchboard wiring", "Wire switchboard panel."),
        ("Lighting circuit", "Wire lighting circuit."),
        ("Refrigeration power line", "Wire refrigeration power line."),
        ("Display power supply", "Wire display power supply."),
        ("Earthing setup", "Set up earthing grid."),
        ("Surge protector installation", "Install surge protection devices."),
        ("Junction box wiring", "Wire all junction boxes."),
        ("Sensor wiring", "Wire all sensors to control box."),
        ("Motor wiring", "Wire all motors."),
        ("Compressor wiring", "Wire compressor electrical."),
        ("Heater circuit wiring", "Wire heater element circuit."),
        ("PCB power connection", "Connect PCB to power supply."),
        ("Inverter installation", "Install inverter module."),
        ("UPS hookup", "Hook up UPS for control panel."),
        ("Continuity test", "Perform continuity test on all wiring."),
        ("Insulation resistance test", "Perform IR test on wiring."),
        ("Polarity check", "Check polarity on all outlets."),
        ("Voltage stabilizer mounting", "Mount voltage stabilizer."),
        ("Load testing", "Perform load test on unit."),
        ("Cable management", "Tie and dress all cables neatly."),
        ("Conduit installation", "Install conduits for cable runs."),
        ("Junction box closure", "Close and seal junction boxes."),
        ("Final earthing verification", "Verify earthing resistance."),
        ("Electrical safety audit", "Perform electrical safety audit."),
        ("Circuit labelling", "Label all circuits clearly."),
        ("Electrical sign-off", "Get sign-off on electrical work.")
    ],
    "EMP007": [
        ("PCB component analysis", "Analyze PCB components and BOM."),
        ("Sensor requirement listing", "List sensor requirements."),
        ("Controller board prep", "Prepare main controller board."),
        ("PCB layout verification", "Verify PCB layout against schematic."),
        ("Component soldering", "Solder through-hole components."),
        ("SMD placement", "Place and reflow SMD components."),
        ("Sensor calibration", "Calibrate proximity and temperature sensors."),
        ("Coin counter setup", "Set up coin counter electronics."),
        ("Note validator config", "Configure note validator settings."),
        ("Display driver setup", "Set up display driver IC."),
        ("Communication module setup", "Set up communication module."),
        ("Bluetooth pairing", "Pair Bluetooth modules with controller."),
        ("WiFi module config", "Configure WiFi module."),
        ("GSM module setup", "Set up GSM module for SMS alerts."),
        ("Keypad wiring", "Wire and test keypad input."),
        ("Capacitive sensor setup", "Set up capacitive touch sensors."),
        ("RFID reader setup", "Set up RFID reader interface."),
        ("Camera module install", "Install internal camera module."),
        ("PCB power-on test", "Power-on test the PCB."),
        ("Firmware upload", "Flash firmware onto controller."),
        ("I/O verification", "Verify all I/O pins functioning."),
        ("Sensor signal check", "Check sensor signals on scope."),
        ("Noise filter installation", "Install EMI noise filters."),
        ("PCB protective coating", "Apply conformal coating on PCB."),
        ("Vibration sensor mounting", "Mount vibration sensor."),
        ("PCB enclosure", "Place PCB in protective enclosure."),
        ("Continuity & isolation test", "Test continuity and isolation."),
        ("Electronics QC", "Submit electronics for QC inspection."),
        ("PCB documentation", "Update PCB documentation."),
        ("Electronics sign-off", "Get sign-off on electronics work.")
    ],
    "EMP008": [
        ("Software requirement gathering", "Gather software requirements from stakeholders."),
        ("UI design planning", "Plan UI screens and user flow."),
        ("Database schema design", "Design database schema for vending data."),
        ("User flow design", "Map user flow from start to dispense."),
        ("Sprint planning", "Plan development sprints."),
        ("Frontend layout coding", "Code frontend layouts."),
        ("Login module", "Code login and authentication."),
        ("Product selection screen", "Build product selection UI."),
        ("Payment integration", "Integrate payment gateway."),
        ("Coin counter logic", "Code coin counter business logic."),
        ("Note validator integration", "Integrate note validator API."),
        ("Inventory sync logic", "Sync local inventory to cloud."),
        ("Refund processing", "Build refund processing flow."),
        ("Receipt printing", "Implement receipt printing."),
        ("Cloud sync setup", "Set up cloud sync service."),
        ("Admin panel", "Build admin web panel."),
        ("Reporting dashboard", "Create reporting dashboard."),
        ("API integration", "Integrate backend APIs."),
        ("Diagnostic module", "Build diagnostic self-test module."),
        ("OTA update logic", "Implement OTA update mechanism."),
        ("Multi-language support", "Add multi-language UI support."),
        ("Theming", "Add theme switching support."),
        ("Unit testing", "Run unit tests for all modules."),
        ("Integration testing", "Run integration tests end-to-end."),
        ("UAT preparation", "Prepare UAT environment and scripts."),
        ("Bug fixing", "Fix bugs reported during UAT."),
        ("Performance tuning", "Tune software for performance."),
        ("Security review", "Run security review and fix findings."),
        ("Release packaging", "Package final release build."),
        ("Software handover", "Hand over software to deployment team.")
    ],
    "EMP009": [
        ("Quality checklist preparation", "Prepare QC checklist for all stages."),
        ("Inspection parameter setup", "Define inspection parameters."),
        ("Incoming material inspection", "Inspect incoming raw materials."),
        ("Vendor part check", "Check vendor parts for compliance."),
        ("First piece inspection", "Inspect first piece off production."),
        ("Process audit", "Audit production process stages."),
        ("Welding inspection", "Inspect welded joints."),
        ("Fabrication inspection", "Inspect fabricated parts."),
        ("Painting inspection", "Inspect paint finish."),
        ("Assembly stage check", "Stage-wise check during assembly."),
        ("Electrical safety test", "Run electrical safety tests."),
        ("Earthing & polarity test", "Test earthing and polarity."),
        ("Component reliability check", "Verify component reliability tests."),
        ("PCB functional test", "Functionally test PCBs."),
        ("Sensor calibration verify", "Verify sensor calibration."),
        ("Coin acceptor test", "Test coin acceptor performance."),
        ("Note acceptor test", "Test note acceptor with samples."),
        ("Refrigeration cycle test", "Test refrigeration cycle."),
        ("Door operation test", "Test door operation cycles."),
        ("Vibration & drop test", "Run vibration and drop tests."),
        ("Temperature stress test", "Run temperature stress test."),
        ("Humidity test", "Run humidity exposure test."),
        ("User interface test", "Test UI for end-user flow."),
        ("Mechanical endurance test", "Run mechanical endurance test."),
        ("Reporting NCR", "Report non-conformances raised."),
        ("Root cause analysis", "Run RCA on failures."),
        ("Corrective action review", "Review corrective actions."),
        ("Final inspection report", "Prepare final inspection report."),
        ("QC documentation", "Update QC documentation pack."),
        ("Quality sign-off", "Sign off the unit as quality-passed.")
    ],
    "EMP010": [
        ("Packaging material planning", "Plan packaging material requirements."),
        ("Dispatch area preparation", "Prepare dispatch area for loading."),
        ("Carton inventory check", "Check carton inventory in store."),
        ("Foam padding stock", "Verify foam padding stock."),
        ("Wrapping material order", "Order stretch wrap and tape."),
        ("Labelling design", "Design shipping labels."),
        ("Barcode generation", "Generate barcodes for tracking."),
        ("Pallet readiness", "Make pallets ready for loading."),
        ("Lifting equipment check", "Check forklift and lifting gear."),
        ("Loading zone marking", "Mark loading zones in dispatch."),
        ("Truck arrival schedule", "Schedule truck arrivals."),
        ("Inner packing", "Pack units in inner carton."),
        ("External packing", "Outer carton packing."),
        ("Box sealing", "Seal cartons with tape."),
        ("Carton stacking", "Stack cartons on pallets."),
        ("Address label fixing", "Affix address labels."),
        ("Invoice attachment", "Attach invoice copy to dispatch."),
        ("Manifest preparation", "Prepare shipping manifest."),
        ("Customs documentation", "Prepare customs paperwork."),
        ("Insurance paperwork", "Complete insurance paperwork."),
        ("Vehicle loading", "Load units onto vehicle."),
        ("Dispatch confirmation", "Confirm dispatch with customer."),
        ("Transit tracking", "Track in-transit shipments."),
        ("POD collection", "Collect proof of delivery."),
        ("Customer feedback collection", "Collect customer feedback."),
        ("Reverse logistics handling", "Handle any reverse logistics."),
        ("Spare packaging audit", "Audit spare packaging stock."),
        ("Empty pallet return", "Manage empty pallet returns."),
        ("Dispatch reconciliation", "Reconcile dispatch records."),
        ("Dispatch closure report", "Submit dispatch closure report.")
    ]
}
