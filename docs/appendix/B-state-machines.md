# Appendix B — State Machines

All status diagrams in one place for quick reference.

## B.1 Quotation

```
DRAFT ──send──▶ SENT ──approve──▶ APPROVED ──convert─▶ CONVERTED
   │             │                   │
   │             ├──reject──▶ REJECTED
   │             └─(customer rejects via /q/:token)
   │
   └─edit/delete (DRAFT only)

(any non-CONVERTED) ──expiry-date-passed──▶ EXPIRED
```

## B.2 Sales Order (payment-gated)

```
DRAFT
  │  /confirm  (sends advance request email)
  ▼
AWAITING_ADVANCE
  │  /payment   (MILESTONE=ADVANCE)
  │  auto-confirms when ADVANCE_RECEIVED ≥ required advance
  ▼
CONFIRMED
  │  /start-production  (spawns Projects + Work Orders)
  ▼
IN_PRODUCTION
  │  /ship
  ▼
SHIPPED
  │  /deliver
  ▼
DELIVERED
  │  /close
  ▼
CLOSED

(any non-CLOSED) ──/cancel──▶ CANCELLED
```

## B.3 Purchase Order

```
DRAFT
  │  /send  (email supplier)
  ▼
SENT
  │  /confirm
  ▼
CONFIRMED
  │  /grn  (partial)
  ▼
PARTIAL_RECEIVED
  │  /grn  (balance)  + /grn/{id}/finalize  (push to inventory)
  ▼
RECEIVED

(any non-RECEIVED) ──/cancel──▶ CANCELLED
```

## B.4 GRN

```
DRAFT ──/finalize──▶ FINAL
                       │
                       └─ stock pushed to inventory
                       └─ PO.STATUS updated
                       └─ rejection notice (optional)
```

## B.5 Work Order

```
PLANNED ──/status IN_PROGRESS──▶ IN_PROGRESS
   │                                 │
   │                                 ├── ON_HOLD
   │                                 │
   ▼                                 ▼
CANCELLED                          DONE
                                     │
                                     │ (requires all stages DONE,
                                     │  QC inspection PASS/REWORK,
                                     │  open NCRs CLOSED)
                                     ▼
                                  (machines auto-registered)
```

## B.6 Work Order Stage Progress

```
PENDING ──▶ IN_PROGRESS ──▶ DONE
              │
              ├──▶ FAILED  (with NOTES)
              │
              └──▶ SKIPPED
```

## B.7 Project

```
PENDING ──▶ IN_PROGRESS ──▶ COMPLETED
              │
              ├──▶ ON_HOLD
              │
              └──▶ CANCELLED
```

Project statuses are string-valued and admin-customisable.

## B.8 Task / TaskAssignment

```
PENDING_APPROVAL ──approve──▶ APPROVED ──accept──▶ ACCEPTED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
       │              │                    │
       │              │                    └──reject──▶ REJECTED (by employee)
       │              │
       │              └──reject──▶ REJECTED (by approver)
       │
       └──no-decision-in-7-days──▶ EXPIRED
```

## B.9 Leave Request

```
PENDING_APPROVAL ──approve via email token──▶ APPROVED
       │              │                          │
       │              │                          └─ LeaveBalance updated
       │              │
       │              └──reject──▶ REJECTED
       │
       └──/cancel──▶ CANCELLED
       └──no-decision-in-7-days──▶ EXPIRED
```

## B.10 QC Inspection

```
PENDING
   │  every result recorded via /quality/results/{id}
   │
   ▼
(awaiting finalisation)
   │  /quality/inspections/{id}/finalise
   ▼
   ├── PASS    (all results PASS)
   ├── FAIL    (any result FAIL)
   └── REWORK  (only NEEDS_REWORK without FAILs)

(FAIL or NEEDS_REWORK) ──auto──▶ NCR (status OPEN)
```

## B.11 NCR

```
OPEN ──assign──▶ IN_PROGRESS ──resolve──▶ CLOSED
                                            │
                                            └─ requires ROOT_CAUSE + CORRECTIVE_ACTION filled
                                            └─ may trigger re-inspection
```

## B.12 Machine

```
IDLE ──ship──▶ ACTIVE ──maintenance_event──▶ MAINTENANCE ──resolve──▶ ACTIVE
                  │                                              ↑
                  │                                              │
                  └─decommission──▶ (terminal, soft-delete)──────┘
```

## B.13 Customer Lead Status

```
NEW ──qualify──▶ QUALIFIED ──proposal──▶ PROPOSAL ──negotiate──▶ NEGOTIATION ──won──▶ CLOSED_WON
                                                                          │
                                                                          └─lost──▶ CLOSED_LOST
```

## B.14 Customer Requirement

```
DRAFT ──confirm──▶ CONFIRMED ──quoted──▶ QUOTED ──ordered──▶ ORDERED
                                                  │
                                                  └─cancelled──▶ CANCELLED
```

---

Next: [Appendix C — Environment Variables](./C-environment-variables.md)
