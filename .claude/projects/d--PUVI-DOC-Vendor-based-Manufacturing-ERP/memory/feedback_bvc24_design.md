---
name: feedback-bvc24-design
description: Confirmed implementation choices for BVC24 biometric + AI allocation feature; treat as decided, do not re-litigate
metadata:
  type: feedback
---

User confirmed these decisions on 2026-05-22 when planning the BVC24 pivot (see [[project-bvc24-pivot]]). Treat as settled — don't reopen unless the user explicitly asks to revisit.

**Decisions**:
1. **Biometric mode** = real device (ZKTeco / eSSL / Mantra). Build endpoints that accept the standard device push payload (USER_ID / EMPLOYEE_CODE, timestamp, device_id, verify_mode). For local demo/testing, frontend simulates the same payload so the flow works with or without hardware attached.
2. **AI allocation** = rule-based scoring (skill-overlap × w1 − current-workload × w2 + project-priority × w3). No LLM API calls, no embeddings. Must be fast and explainable.
3. **Project scope** = full pivot to BVC24. Tailor existing models, seed data, and terminology to vending-machine manufacturing instead of building a parallel tenant.
4. **First build** = full vertical slice (fingerprint UI → API → allocation → task auto-assign) before deepening any single module.
5. **Task completion + check-out (added 2026-05-22)** = single biometric kiosk handles state machine. Every scan after check-in either marks the current task DONE (capturing END_TIME) or, if no pending task remains, performs check-out. Same fingerprint, three+ scans per day: check-in → task complete (N times) → check-out.
6. **Deadline source** = `Employee.SHIFT_END` per employee (default 18:00). Per-employee deadlines, not a hardcoded 6 PM.
7. **After task complete** = auto-assign the next-best matching task if more than 2 hours remain to shift end; otherwise return "ready to leave" so they can check-out.
8. **MD performance review** = auto-calculate a suggested increment % per employee (banded by score 0–100 from on-time rate + early-completion bonus + volume) and surface the raw breakdown alongside. MD can override; system suggests, doesn't decide.

Why: User wants a demo-ready end-to-end flow; explainability and zero external dependencies matter more than ML sophistication; one tenant focus avoids multi-tenant churn while building.

How to apply:
- When extending allocation logic, add new signals to the scoring function rather than swapping the approach.
- When wiring device integration, keep the endpoint device-agnostic (accept a normalized JSON) and document the mapping for each vendor SDK separately.
- Don't introduce LLM/embedding/vector-DB dependencies for allocation unless the user asks.
