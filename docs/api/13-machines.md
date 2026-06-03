# API — 13 Machines

| Method | Path | Purpose |
|---|---|---|
| POST | `/machines/create-machine` | Manual create `{ MACHINE_NAME, MACHINE_TYPE, PRODUCT_MODEL_ID, WORK_ORDER_ID?, UNIT_NUMBER?, SERIAL_NO?, LOCATION? }` |
| POST | `/machines/sync` | Bulk auto-register from completed WOs (idempotent) |
| GET | `/machines` | List with filters `?status=&product_model_id=` |
| PUT | `/machines/machine-status/{id}` | Update status `{ STATUS, NOTE }` — appends MachineLog |
| GET | `/machines/machine-logs/{id}` | Status history |
| DELETE | `/machines/delete-machine/{id}` | Remove |
| GET | `/connect/work-order/{id}/360` | Work order with attached machines |

See [Module 12 — Machines](../modules/12-machines.md).

---

Next: [14 — Misc & Integrations](./14-misc.md)
