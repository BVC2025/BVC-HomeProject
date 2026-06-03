---
name: project-bvc24-pivot
description: Project pivot from generic PUVI ERP to BVC24 Vending Machine Manufacturing ERP with biometric + AI allocation features
metadata:
  type: project
---

The existing repo (originally "PUVI-DOC / Vendor-based Manufacturing ERP") is being repurposed into an **AI-automated ERP for Bharath Vending Corporation (BVC24)** — a Coimbatore-based smart vending machine manufacturer (22+ machine categories: food, beverage, medicine, grocery, kiosk, alcohol).

Decided 2026-05-22. See [[feedback-bvc24-design]] for the implementation decisions.

**Headline features being added on top of the existing ERP**:
1. Biometric fingerprint check-in (real device integration target: ZKTeco / eSSL / Mantra) replacing the manual `/attendance/check-in` flow.
2. Rule-based AI engine that, on successful biometric check-in, auto-allocates the employee to a project (skill match + workload balance) and assigns the day's task.
3. BVC24-specific seed data: departments, designations, project categories, machine types tailored to vending-machine manufacturing.

Why: The user wants a demo-ready ERP showcasing biometric + AI automation for BVC24 (mapped to the 20-week Gantt — see [[reference-bvc24-gantt]]).

How to apply:
- Treat BVC24 as **the** target tenant — seed data, terminology, modules should reflect vending-machine manufacturing.
- The existing Employee.SKILLS (comma-separated string), Attendance, Project, Task, TaskAssignment models stay — extend them rather than rewriting.
- Vertical-slice first: fingerprint UI → API → allocation → task assigned in one demoable flow before deepening any module.
