import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API, { API_BASE_URL } from "../services/api";

import { formatISTTime } from "../utils/time";

import { bomIconTileStyle } from "../utils/bomIcons";


// ===================================================================
// EntityDrawer — one reusable side-drawer that opens for ANY entity
// (employee / project / work-order / supplier). Uses the /connect/*
// 360° endpoints to fetch the full picture in one HTTP call, then
// renders a tabbed view with cross-links into the matching module.
//
// Usage:
//   <EntityDrawer
//      open={!!selectedEmployeeId}
//      type="employee"
//      id={selectedEmployeeId}
//      onClose={() => setSelectedEmployeeId(null)}
//   />
// ===================================================================


const TYPE_CONFIG = {
  employee: {
    api: (id) => `/connect/employee/${id}/360`,
    label: "Employee 360°",
    accent: "#6366f1"
  },
  project: {
    api: (id) => `/connect/project/${id}/360`,
    label: "Project 360°",
    accent: "#10b981"
  },
  "work-order": {
    api: (id) => `/connect/work-order/${id}/360`,
    label: "Work Order 360°",
    accent: "#f59e0b"
  },
  supplier: {
    api: (id) => `/connect/supplier/${id}/360`,
    label: "Supplier 360°",
    accent: "#ec4899"
  },
  customer: {
    api: (id) => `/connect/customer/${id}/360`,
    label: "Customer 360°",
    accent: "#06b6d4"
  }
};


// ---- Small atoms ------------------------------------------------

function Pill({ children, color }) {

  return (

    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: `${color}22`,
        color
      }}
    >
      {children}
    </span>
  );
}


function StatTile({ label, value, sub, accent }) {

  return (

    <div
      style={{
        background: "white",
        padding: 14,
        borderRadius: 10,
        boxShadow: "0 2px 8px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${accent}`
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


function Section({ title, children }) {

  return (

    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#475569",
          textTransform: "uppercase",
          marginBottom: 8
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}


// ---- Per-type renderers ----------------------------------------

function EmployeeView({ data, openEntity, navigate, onClose }) {

  const emp = data?.employee || {};

  const att = data?.today_attendance;

  const tasks = data?.active_tasks || [];

  const stages = data?.active_production_stages || [];

  const scans = data?.recent_scans || [];

  const balance = data?.leave_balance;

  const leaveRequests = data?.leave_requests || [];

  const perf = data?.performance;

  return (

    <>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
          paddingBottom: 16,
          borderBottom: "1px solid #e2e8f0"
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 800,
            boxShadow: "0 6px 18px rgba(139,92,246,0.4)"
          }}
        >
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
            {emp.NAME}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
            {emp.EMPLOYEE_CODE} · {emp.DEPARTMENT || "—"}
          </div>
          {emp.EMAIL && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              {emp.EMAIL}{emp.PHONE && ` · ${emp.PHONE}`}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 6
        }}
      >
        <StatTile
          label="Tasks Open"
          value={tasks.length}
          accent="#6366f1"
        />
        <StatTile
          label="Done Today"
          value={data?.completed_today_count ?? 0}
          accent="#10b981"
        />
        <StatTile
          label="Perf Score"
          value={perf?.performance_score ?? "—"}
          sub={perf?.band}
          accent="#f59e0b"
        />
        <StatTile
          label="Increment"
          value={perf ? `${perf.suggested_increment_pct}%` : "—"}
          sub="suggested"
          accent="#ec4899"
        />
      </div>

      {att && (
        <Section title="Today's Attendance">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10
            }}
          >
            <StatTile label="Check-In" value={formatISTTime(att.CHECK_IN)} accent="#10b981" />
            <StatTile label="Check-Out" value={att.CHECK_OUT ? formatISTTime(att.CHECK_OUT) : "—"} accent="#ef4444" />
            <StatTile label="Status" value={att.STATUS} accent="#3b82f6" />
          </div>
        </Section>
      )}

      {emp.SKILLS && (
        <Section title="Skills">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {emp.SKILLS.split(",").map((s, i) => (
              <Pill key={i} color="#6366f1">{s.trim()}</Pill>
            ))}
          </div>
        </Section>
      )}

      <Section title="Active Tasks">
        {tasks.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>No active tasks.</div>
        )}
        {tasks.map((t) => (
          <div
            key={t.TASK_ID}
            style={{
              padding: "10px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginBottom: 8,
              cursor: t.PROJECT_ID ? "pointer" : "default"
            }}
            onClick={() => t.PROJECT_ID && openEntity("project", t.PROJECT_ID)}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
              {t.TASK_NAME}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              {t.PROJECT_NAME && (
                <span>📁 {t.PROJECT_NAME} · </span>
              )}
              <Pill color={
                t.STATUS === "IN_PROGRESS" ? "#f59e0b" :
                t.STATUS === "PENDING" ? "#64748b" : "#10b981"
              }>{t.STATUS}</Pill>
            </div>
          </div>
        ))}
      </Section>

      {stages.length > 0 && (
        <Section title="Manufacturing Stages Assigned">
          {stages.map((s, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                marginBottom: 8,
                cursor: "pointer"
              }}
              onClick={() => openEntity("work-order", s.WO_ID)}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                {s.STAGE_NAME}
              </div>
              <div style={{ fontSize: 11, color: "#1e40af", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
                {s.WO_NUMBER} · {s.MODEL_NAME}
                {" · "}
                <Pill color={s.PROGRESS_STATUS === "DONE" ? "#10b981" : "#f59e0b"}>
                  {s.PROGRESS_STATUS}
                </Pill>
              </div>
            </div>
          ))}
        </Section>
      )}

      {balance && (
        <Section title="Leave Balance">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <StatTile label="Casual" value={balance.CASUAL.remaining} sub={`of ${balance.CASUAL.total}`} accent="#3b82f6" />
            <StatTile label="Sick" value={balance.SICK.remaining} sub={`of ${balance.SICK.total}`} accent="#ef4444" />
            <StatTile label="Earned" value={balance.EARNED.remaining} sub={`of ${balance.EARNED.total}`} accent="#10b981" />
          </div>
        </Section>
      )}

      {leaveRequests.length > 0 && (
        <Section title="Recent Leave Requests">
          {leaveRequests.slice(0, 5).map((l) => (
            <div key={l.ID} style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid #f1f5f9",
              fontSize: 12
            }}>
              <span>
                <Pill color="#3b82f6">{l.LEAVE_TYPE}</Pill>{" "}
                {l.START_DATE} → {l.END_DATE} ({l.DAYS}d)
              </span>
              <Pill color={
                l.STATUS === "APPROVED" ? "#10b981" :
                l.STATUS === "REJECTED" ? "#ef4444" : "#f59e0b"
              }>{l.STATUS}</Pill>
            </div>
          ))}
        </Section>
      )}

      {scans.length > 0 && (
        <Section title="Recent Biometric Scans">
          {scans.slice(0, 5).map((s) => (
            <div key={s.ID} style={{
              fontSize: 12,
              color: "#475569",
              padding: "6px 12px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "space-between"
            }}>
              <span>{s.DEVICE_ID} · {s.VERIFY_MODE}</span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {formatISTTime(s.EVENT_TIME)} · <Pill color={
                  s.RESULT === "SUCCESS" ? "#10b981" : "#ef4444"
                }>{s.RESULT}</Pill>
              </span>
            </div>
          ))}
        </Section>
      )}

      <div style={{ marginTop: 22, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => { onClose(); navigate("/md-review"); }}
          style={navBtn("#6366f1")}
        >
          MD Performance Review →
        </button>
        <button
          onClick={() => { onClose(); navigate("/attendance"); }}
          style={navBtn("#10b981")}
        >
          Attendance →
        </button>
        <button
          onClick={() => { onClose(); navigate("/leave-management"); }}
          style={navBtn("#ec4899")}
        >
          Leave Management →
        </button>
      </div>
    </>
  );
}


// One BOM row in the Excel-style layout: image | item no | part name | qty.
// Click the row (anywhere outside the image) to expand a supplier
// picker / process stage info underneath. Image is rendered from
// /static/bom/<file> served by the backend.
function BomRow({ item, suppliers, savingId, updateSupplier }) {

  const [expanded, setExpanded] = useState(false);

  const isProcess = item.ITEM_TYPE === "PROCESS";

  const imageUrl = item.IMAGE_URL
    ? `${API_BASE_URL}${item.IMAGE_URL}`
    : null;

  return (

    <>

      <tr
        onClick={() => setExpanded((v) => !v)}
        style={{
          borderBottom: "1px solid #f1f5f9",
          cursor: "pointer",
          background: expanded ? "#f8fafc" : "white"
        }}
      >

        {/* Preview cell */}
        <td style={{
          padding: 6,
          borderRight: "1px solid #f1f5f9",
          textAlign: "center",
          verticalAlign: "middle"
        }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.MATERIAL_NAME}
              style={{
                width: 56,
                height: 56,
                objectFit: "contain",
                background: "white",
                border: "1px solid #e2e8f0",
                borderRadius: 8
              }}
            />
          ) : (() => {

            const tile = bomIconTileStyle(item.MATERIAL_NAME, 56);

            return (

              <div
                style={tile.container}
                title={tile.label}
              >
                {tile.icon}
              </div>
            );
          })()}
        </td>

        {/* Item no */}
        <td style={{
          padding: 6,
          borderRight: "1px solid #f1f5f9",
          textAlign: "center",
          verticalAlign: "middle",
          fontFamily: "ui-monospace, monospace",
          fontWeight: 700,
          color: "#475569"
        }}>
          {item.ITEM_NO ?? "—"}
        </td>

        {/* Part number */}
        <td style={{
          padding: 6,
          borderRight: "1px solid #f1f5f9",
          verticalAlign: "middle"
        }}>
          <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 12 }}>
            {item.MATERIAL_NAME}
          </div>
          <div style={{
            fontSize: 10,
            color: "#94a3b8",
            marginTop: 2,
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap"
          }}>
            <span>{item.PER_UNIT_QUANTITY} {item.UNIT} per unit</span>
            {isProcess && (
              <span style={{
                background: "#ede9fe",
                color: "#6d28d9",
                padding: "1px 6px",
                borderRadius: 4,
                fontWeight: 700
              }}>
                IN-HOUSE
              </span>
            )}
            {item.PREFERRED_SUPPLIER_NAME && (
              <span style={{
                background: "#dbeafe",
                color: "#1e40af",
                padding: "1px 6px",
                borderRadius: 4,
                fontWeight: 700
              }}>
                🏢 {item.PREFERRED_SUPPLIER_NAME}
              </span>
            )}
            <span style={{ color: "#cbd5e1" }}>
              {expanded ? "▴ hide" : "▾ supplier"}
            </span>
          </div>
        </td>

        {/* Qty */}
        <td style={{
          padding: 6,
          textAlign: "center",
          verticalAlign: "middle",
          fontFamily: "ui-monospace, monospace",
          fontWeight: 800,
          fontSize: 14,
          color: "#0f172a"
        }}>
          {item.TOTAL_QUANTITY}
        </td>

      </tr>

      {expanded && (
        <tr style={{ background: "#f8fafc" }}>
          <td colSpan={4} style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0" }}>
            {isProcess ? (
              <div style={{ fontSize: 11, color: "#64748b" }}>
                <strong>Made in-house</strong> · Stage:{" "}
                <span style={{ color: "#0f172a" }}>
                  {item.PROCESS_STAGE_NAME || "—"}
                </span>
              </div>
            ) : (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 11
                }}
              >
                <label style={{ color: "#64748b", fontWeight: 700 }}>
                  Supplier:
                </label>
                <select
                  value={item.PREFERRED_SUPPLIER_ID || ""}
                  onChange={(e) => updateSupplier(item.ID, e.target.value)}
                  disabled={savingId === item.ID}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 5,
                    fontSize: 12,
                    background: savingId === item.ID ? "#f1f5f9" : "white"
                  }}
                >
                  <option value="">— Pick supplier —</option>
                  {suppliers.map((s) => (
                    <option key={s.ID} value={s.ID}>
                      {s.COMPANY_NAME}
                      {s.SUPPLIER_CODE ? ` (${s.SUPPLIER_CODE})` : ""}
                    </option>
                  ))}
                </select>
                {savingId === item.ID && (
                  <span style={{ color: "#94a3b8", fontSize: 10 }}>
                    Saving…
                  </span>
                )}
              </div>
            )}
          </td>
        </tr>
      )}

    </>
  );
}


function ProjectBomSection({
  bom,
  suppliers,
  projectQuantity,
  productLinked,
  productModelId,
  navigate,
  onClose,
  refresh
}) {

  const [savingId, setSavingId] = useState(null);

  const [errorMsg, setErrorMsg] = useState(null);

  const [seeding, setSeeding] = useState(false);

  if (!productLinked) {

    return null;
  }

  const seedDefaultBom = async () => {

    if (!productModelId) return;

    setSeeding(true);

    setErrorMsg(null);

    try {

      await API.post(`/production/models/${productModelId}/seed-default-bom`);

      if (refresh) refresh();

    } catch (err) {

      setErrorMsg(err?.response?.data?.detail || "Failed to seed BOM");

    } finally {

      setSeeding(false);
    }
  };

  const updateSupplier = async (bomItemId, supplierId) => {

    setSavingId(bomItemId);

    setErrorMsg(null);

    try {

      await API.patch(`/production/bom/${bomItemId}`, {
        PREFERRED_SUPPLIER_ID: supplierId ? Number(supplierId) : null
      });

      if (refresh) refresh();

    } catch (err) {

      setErrorMsg(err?.response?.data?.detail || "Failed to update supplier");

    } finally {

      setSavingId(null);
    }
  };

  return (

    <Section title={`Required BOM (rolled up × ${projectQuantity})`}>

      {bom.length === 0 && (
        <div
          style={{
            padding: 14,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            fontSize: 12,
            color: "#92400e"
          }}
        >
          This product has no BOM lines yet. You can auto-seed the
          common vending-machine BOM (cabinet, motor, control board,
          touchscreen, payment terminal, glass, etc.) — suppliers are
          pre-linked where they match your supplier directory.

          {errorMsg && (
            <div
              style={{
                marginTop: 8,
                padding: 6,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#b91c1c"
              }}
            >
              {errorMsg}
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              onClick={seedDefaultBom}
              disabled={seeding || !productModelId}
              style={{
                background: seeding
                  ? "#cbd5e1"
                  : "linear-gradient(135deg, #F4B324, #C8102E)",
                color: "white",
                border: "none",
                padding: "7px 14px",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 12,
                cursor: seeding ? "default" : "pointer"
              }}
            >
              {seeding ? "Seeding…" : "✨ Seed Common BOM"}
            </button>
            <button
              onClick={() => { onClose(); navigate("/production"); }}
              style={{
                background: "white",
                color: "#92400e",
                border: "1px solid #fde68a",
                padding: "7px 14px",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              Or add manually →
            </button>
          </div>
        </div>
      )}

      {bom.length > 0 && (
        <div>

          {errorMsg && (
            <div
              style={{
                padding: 8,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#b91c1c",
                fontSize: 12,
                marginBottom: 8
              }}
            >
              {errorMsg}
            </div>
          )}

          <div
            style={{
              fontSize: 11,
              color: "#64748b",
              marginBottom: 8
            }}
          >
            Excel-style BOM with image preview. Tap any row to expand
            the supplier picker.
          </div>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              border: "1px solid #cbd5e1"
            }}
          >
            <thead>
              <tr style={{
                background: "#f1f5f9",
                color: "#475569",
                fontSize: 10,
                letterSpacing: 0.5,
                textTransform: "uppercase"
              }}>
                <th style={{
                  padding: "8px 6px",
                  borderBottom: "1px solid #cbd5e1",
                  width: 70,
                  textAlign: "center"
                }}>
                  Preview
                </th>
                <th style={{
                  padding: "8px 6px",
                  borderBottom: "1px solid #cbd5e1",
                  width: 50,
                  textAlign: "center"
                }}>
                  Item No.
                </th>
                <th style={{
                  padding: "8px 6px",
                  borderBottom: "1px solid #cbd5e1",
                  textAlign: "left"
                }}>
                  Part Number
                </th>
                <th style={{
                  padding: "8px 6px",
                  borderBottom: "1px solid #cbd5e1",
                  width: 60,
                  textAlign: "center"
                }}>
                  Qty
                </th>
              </tr>
            </thead>
            <tbody>
              {bom.map((b) => (
                <BomRow
                  key={b.ID}
                  item={b}
                  suppliers={suppliers}
                  savingId={savingId}
                  updateSupplier={updateSupplier}
                />
              ))}
            </tbody>
          </table>

          <div
            style={{
              fontSize: 10,
              color: "#94a3b8",
              marginTop: 8,
              fontStyle: "italic"
            }}
          >
            Note: supplier choice is saved on the product's BOM and applies
            to every project using this product.
          </div>

        </div>
      )}

    </Section>
  );
}


function ProjectView({ data, openEntity, navigate, onClose, refresh }) {

  const proj = data?.project || {};

  const customer = data?.customer;

  const wos = data?.work_orders || [];

  const tasks = data?.tasks || [];

  const emps = data?.assigned_employees || [];

  const stats = data?.task_stats || {};

  const [backfilling, setBackfilling] = useState(false);

  const [backfillMsg, setBackfillMsg] = useState(null);

  const isProductDriven = !!proj.PRODUCT_MODEL_ID;

  const hasNoTasks = (stats.total ?? 0) === 0;

  const showBackfill = isProductDriven && hasNoTasks;

  const runBackfill = async () => {

    setBackfilling(true);

    setBackfillMsg(null);

    try {

      const res = await API.post(`/projects/${proj.ID}/backfill-tasks`);

      const generated = res.data?.tasks_generated ?? 0;

      setBackfillMsg({
        ok: true,
        text: generated > 0
          ? `Generated ${generated} task(s). Refreshing…`
          : "No new tasks needed — already up to date."
      });

      if (refresh) {

        setTimeout(() => refresh(), 600);
      }

    } catch (err) {

      setBackfillMsg({
        ok: false,
        text: err?.response?.data?.detail || "Backfill failed."
      });

    } finally {

      setBackfilling(false);
    }
  };

  return (

    <>
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 12, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>
          Project
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
          {proj.PROJECT_NAME}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
          <Pill color={proj.PRIORITY === "HIGH" ? "#ef4444" : proj.PRIORITY === "LOW" ? "#94a3b8" : "#f59e0b"}>
            {proj.PRIORITY || "MEDIUM"}
          </Pill>
          <Pill color="#3b82f6">{proj.STATUS}</Pill>
          {proj.DEPARTMENT && <Pill color="#8b5cf6">{proj.DEPARTMENT}</Pill>}
        </div>
        {proj.DESCRIPTION && (
          <div style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>
            {proj.DESCRIPTION}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <StatTile label="Work Orders" value={wos.length} accent="#f59e0b" />
        <StatTile label="Tasks Total" value={stats.total ?? 0} accent="#3b82f6" />
        <StatTile label="Tasks Done" value={stats.completed ?? 0} accent="#10b981" />
        <StatTile label="Assigned" value={emps.length} sub="employees" accent="#6366f1" />
      </div>

      {showBackfill && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "1px solid #f59e0b",
            borderRadius: 10
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            No tasks generated for this project yet
          </div>
          <div style={{ fontSize: 12, color: "#78350f", marginTop: 4, lineHeight: 1.5 }}>
            This product-driven project has no tasks. Click below to auto-generate
            tasks from the product's manufacturing stages and assign each one to
            the best-skill employee.
          </div>
          <button
            onClick={runBackfill}
            disabled={backfilling}
            style={{
              marginTop: 10,
              background: backfilling
                ? "#cbd5e1"
                : "linear-gradient(135deg, #F4B324, #C8102E)",
              color: "white",
              border: "none",
              padding: "8px 18px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: backfilling ? "default" : "pointer"
            }}
          >
            {backfilling ? "Generating…" : "⚡ Generate Tasks Now"}
          </button>
          {backfillMsg && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: backfillMsg.ok ? "#166534" : "#b91c1c",
                fontWeight: 600
              }}
            >
              {backfillMsg.text}
            </div>
          )}
        </div>
      )}

      {customer && (
        <Section title="Customer">
          <div style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
              {customer.NAME}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {customer.PHONE} · {customer.EMAIL}
            </div>
            {customer.ADDRESS && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {customer.ADDRESS}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={`Work Orders (${wos.length})`}>
        {wos.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>No work orders yet.</div>
        )}
        {wos.map((wo) => (
          <div
            key={wo.ID}
            onClick={() => openEntity("work-order", wo.ID)}
            style={{
              padding: "10px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginBottom: 8,
              cursor: "pointer"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#475569" }}>
                  {wo.WO_NUMBER}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                  {wo.MODEL_NAME} × {wo.QUANTITY}
                </div>
              </div>
              <Pill color={
                wo.STATUS === "DONE" ? "#10b981" :
                wo.STATUS === "IN_PROGRESS" ? "#f59e0b" : "#64748b"
              }>{wo.STATUS}</Pill>
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Assigned Employees (${emps.length})`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {emps.map((e) => (
            <button
              key={e.ID}
              onClick={() => openEntity("employee", e.ID)}
              style={{
                border: "1px solid #c7d2fe",
                background: "#eef2ff",
                color: "#4338ca",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              👤 {e.NAME} · {e.EMPLOYEE_CODE}
            </button>
          ))}
        </div>
      </Section>

      <ProjectBomSection
        bom={data?.bom_rolled_up || []}
        suppliers={data?.suppliers_for_picker || []}
        projectQuantity={data?.project_quantity || 1}
        productLinked={!!proj.PRODUCT_MODEL_ID}
        productModelId={proj.PRODUCT_MODEL_ID}
        navigate={navigate}
        onClose={onClose}
        refresh={refresh}
      />

      <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
        <button
          onClick={() => { onClose(); navigate("/production"); }}
          style={navBtn("#f59e0b")}
        >
          Production & BOM →
        </button>
        <button
          onClick={() => { onClose(); navigate("/projects"); }}
          style={navBtn("#3b82f6")}
        >
          All Projects →
        </button>
      </div>
    </>
  );
}


function WorkOrderView({ data, openEntity, navigate, onClose }) {

  const wo = data?.work_order || {};

  const model = data?.machine_model;

  const project = data?.project;

  const bom = data?.bom || [];

  const stages = data?.stages || [];

  const inspections = data?.inspections || [];

  const ncrs = data?.ncrs || [];

  const stagesDone = stages.filter((s) => s.STATUS === "DONE").length;

  const progressPct = stages.length ? Math.round((stagesDone / stages.length) * 100) : 0;

  return (

    <>
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#64748b" }}>
          {wo.WO_NUMBER}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
          {model?.MODEL_NAME || "—"} × {wo.QUANTITY}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <Pill color={
            wo.STATUS === "DONE" ? "#10b981" :
            wo.STATUS === "IN_PROGRESS" ? "#f59e0b" : "#64748b"
          }>{wo.STATUS}</Pill>
          {model && <Pill color="#8b5cf6">{model.CATEGORY || "—"}</Pill>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <StatTile label="Progress" value={`${progressPct}%`} sub={`${stagesDone}/${stages.length}`} accent="#10b981" />
        <StatTile label="BOM Lines" value={bom.length} accent="#6366f1" />
        <StatTile label="Inspections" value={inspections.length} accent="#3b82f6" />
        <StatTile label="NCRs" value={ncrs.length} accent={ncrs.length ? "#ef4444" : "#94a3b8"} />
      </div>

      {project && (
        <Section title="Project">
          <button
            onClick={() => openEntity("project", project.ID)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: 12,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              cursor: "pointer"
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
              📁 {project.PROJECT_NAME}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Status: {project.STATUS}
            </div>
          </button>
        </Section>
      )}

      <Section title={`Manufacturing Stages (${stages.length})`}>
        {stages.map((s) => (
          <div
            key={s.STAGE_ID}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderBottom: "1px solid #f1f5f9"
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: s.STATUS === "DONE" ? "#dcfce7" : s.STATUS === "IN_PROGRESS" ? "#fef3c7" : "#f1f5f9",
              color: s.STATUS === "DONE" ? "#166534" : s.STATUS === "IN_PROGRESS" ? "#854d0e" : "#475569",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 11, fontFamily: "ui-monospace, monospace"
            }}>
              {s.SEQUENCE}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                {s.STAGE_NAME}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {s.STAGE_TYPE}
                {s.ASSIGNED_TO_NAME && (
                  <button
                    onClick={() => openEntity("employee", s.ASSIGNED_TO_ID)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "#1e40af",
                      cursor: "pointer",
                      padding: 0,
                      marginLeft: 6,
                      fontSize: 11,
                      textDecoration: "underline"
                    }}
                  >
                    · 👤 {s.ASSIGNED_TO_NAME}
                  </button>
                )}
              </div>
            </div>
            <Pill color={
              s.STATUS === "DONE" ? "#10b981" :
              s.STATUS === "IN_PROGRESS" ? "#f59e0b" :
              s.STATUS === "FAILED" ? "#ef4444" : "#64748b"
            }>{s.STATUS}</Pill>
          </div>
        ))}
      </Section>

      <Section title={`BOM Rolled-up (×${wo.QUANTITY})`}>
        {bom.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>No BOM lines.</div>}
        {bom.slice(0, 10).map((b) => (
          <div key={b.ID} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderBottom: "1px solid #f1f5f9",
            fontSize: 12
          }}>
            <span style={{ flex: 1 }}>
              {b.MATERIAL_NAME}
              {b.SUPPLIER_NAME && (
                <button
                  onClick={() => openEntity("supplier", b.SUPPLIER_ID)}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#1e40af",
                    cursor: "pointer",
                    fontSize: 11,
                    marginLeft: 6,
                    textDecoration: "underline"
                  }}
                >
                  · {b.SUPPLIER_NAME}
                </button>
              )}
            </span>
            <span style={{ fontWeight: 700 }}>{b.TOTAL_FOR_WO} {b.UNIT}</span>
            <Pill color={b.TYPE === "PURCHASE" ? "#3b82f6" : "#8b5cf6"}>{b.TYPE}</Pill>
          </div>
        ))}
      </Section>

      {ncrs.length > 0 && (
        <Section title={`NCRs (${ncrs.length})`}>
          {ncrs.map((n) => (
            <div key={n.ID} style={{
              padding: "8px 10px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              marginBottom: 6,
              fontSize: 12
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong style={{ fontFamily: "ui-monospace, monospace" }}>{n.NCR_NUMBER}</strong>
                <Pill color={
                  n.SEVERITY === "CRITICAL" ? "#991b1b" :
                  n.SEVERITY === "MAJOR" ? "#b91c1c" : "#64748b"
                }>{n.SEVERITY}</Pill>
              </div>
              <div style={{ marginTop: 2, color: "#475569" }}>{n.CHECK_POINT}</div>
            </div>
          ))}
        </Section>
      )}

      <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
        <button onClick={() => { onClose(); navigate("/production"); }} style={navBtn("#f59e0b")}>Production →</button>
        <button onClick={() => { onClose(); navigate("/quality"); }} style={navBtn("#10b981")}>Quality →</button>
      </div>
    </>
  );
}


function SupplierView({ data, openEntity, navigate, onClose }) {

  const sup = data?.supplier || {};

  const models = data?.models_supplied || [];

  const activeWOs = data?.active_work_orders_needing_supplier || [];

  const sum = data?.summary || {};

  return (

    <>
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#64748b" }}>
          {sup.SUPPLIER_CODE}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
          {sup.COMPANY_NAME}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          {sup.CATEGORY && <Pill color="#ec4899">{sup.CATEGORY}</Pill>}
          <Pill color={sup.STATUS === "ACTIVE" ? "#10b981" : "#94a3b8"}>{sup.STATUS}</Pill>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <StatTile label="Models" value={sum.models_count ?? 0} sub="supplied" accent="#6366f1" />
        <StatTile label="BOM Lines" value={sum.total_bom_lines ?? 0} accent="#3b82f6" />
        <StatTile label="Active WOs" value={sum.active_wos_count ?? 0} sub="need parts" accent="#f59e0b" />
      </div>

      <Section title="Contact & KYC">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: "#475569" }}>
          <div>👤 {sup.CONTACT_PERSON || "—"}</div>
          <div>📞 {sup.PHONE || "—"}</div>
          <div>✉️ {sup.EMAIL || "—"}</div>
          <div>📍 {sup.CITY || "—"}, {sup.STATE || "—"} {sup.PINCODE || ""}</div>
          <div style={{ fontFamily: "ui-monospace, monospace" }}>GST: {sup.GST_NUMBER || "—"}</div>
          <div style={{ fontFamily: "ui-monospace, monospace" }}>PAN: {sup.PAN_NUMBER || "—"}</div>
          <div>🏦 {sup.BANK_NAME || "—"}</div>
          <div>💳 {sup.PAYMENT_TERMS || "—"}</div>
        </div>
      </Section>

      <Section title={`Models Using This Supplier (${models.length})`}>
        {models.map((m) => (
          <div key={m.MODEL_ID} style={{
            padding: 10,
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            marginBottom: 8
          }}>
            <div style={{ fontWeight: 700, color: "#0f172a" }}>{m.MODEL_NAME}</div>
            <div style={{ fontSize: 11, color: "#64748b", fontFamily: "ui-monospace, monospace", marginBottom: 6 }}>
              {m.MODEL_CODE}
            </div>
            {m.parts.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: "#475569" }}>
                · {p.MATERIAL_NAME} ({p.QUANTITY} {p.UNIT})
              </div>
            ))}
          </div>
        ))}
      </Section>

      {activeWOs.length > 0 && (
        <Section title="Active Work Orders Depending On This Supplier">
          {activeWOs.map((wo) => (
            <div
              key={wo.WO_ID}
              onClick={() => openEntity("work-order", wo.WO_ID)}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                background: "#fef9c3",
                border: "1px solid #fde68a",
                borderRadius: 8,
                marginBottom: 6,
                fontSize: 12
              }}
            >
              <strong style={{ fontFamily: "ui-monospace, monospace" }}>{wo.WO_NUMBER}</strong>
              {" · "}{wo.MODEL_NAME} × {wo.QUANTITY}{" · "}
              <Pill color="#f59e0b">{wo.STATUS}</Pill>
            </div>
          ))}
        </Section>
      )}

      <div style={{ marginTop: 22 }}>
        <button onClick={() => { onClose(); navigate("/suppliers"); }} style={navBtn("#ec4899")}>
          All Suppliers →
        </button>
      </div>
    </>
  );
}


function CustomerView({ data, openEntity, navigate, onClose }) {

  const cust = data?.customer || {};

  const sum = data?.summary || {};

  const projects = data?.projects || [];

  const wos = data?.work_orders || [];

  const models = data?.machine_models || [];

  return (

    <>

      {/* Hero: avatar + name + status pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: "1px solid #e2e8f0"
        }}
      >

        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            background: "linear-gradient(135deg,#06b6d4,#C8102E,#8B0B1F)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 800,
            boxShadow: "0 8px 22px rgba(14,165,233,0.45)",
            flexShrink: 0
          }}
        >
          {(cust.CUSTOMER_NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

          <div
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              color: "#64748b",
              letterSpacing: 1
            }}
          >
            {cust.CUSTOMER_CODE || "—"}
          </div>

          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#0f172a",
              marginTop: 2,
              lineHeight: 1.15
            }}
          >
            {cust.CUSTOMER_NAME}
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 8,
              flexWrap: "wrap"
            }}
          >
            {cust.INDUSTRY && <Pill color="#06b6d4">{cust.INDUSTRY}</Pill>}
            <Pill color={
              cust.STATUS === "ACTIVE" ? "#10b981" :
              cust.STATUS === "PROSPECT" ? "#3b82f6" :
              cust.STATUS === "LEAD" ? "#f59e0b" : "#94a3b8"
            }>{cust.STATUS || "ACTIVE"}</Pill>
            {cust.SOURCE && <Pill color="#8b5cf6">{cust.SOURCE}</Pill>}
          </div>
        </div>
      </div>

      {/* Summary stat tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 16
        }}
      >
        <StatTile
          label="Projects"
          value={sum.projects_total ?? 0}
          sub={`${sum.active_projects ?? 0} active`}
          accent="#3b82f6"
        />
        <StatTile
          label="Total Units"
          value={sum.total_units_ordered ?? 0}
          sub="ordered"
          accent="#6366f1"
        />
        <StatTile
          label="In Production"
          value={sum.units_in_progress ?? 0}
          sub="units"
          accent="#f59e0b"
        />
        <StatTile
          label="Delivered"
          value={sum.units_delivered ?? 0}
          sub="units"
          accent="#10b981"
        />
      </div>

      {/* Contact + Address grid */}
      <Section title="Contact & Address">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            fontSize: 13,
            color: "#475569",
            background: "#f8fafc",
            padding: 14,
            borderRadius: 10,
            border: "1px solid #e2e8f0"
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Contact
            </div>
            <div style={{ marginTop: 4, color: "#0f172a", fontWeight: 600 }}>
              {cust.CONTACT_PERSON || "—"}
              {cust.DESIGNATION && (
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>
                  {" · "}{cust.DESIGNATION}
                </span>
              )}
            </div>
            <div>📞 {cust.PHONE || "—"}</div>
            {cust.ALTERNATE_PHONE && <div>📞 {cust.ALTERNATE_PHONE}</div>}
            <div>✉️ {cust.EMAIL || "—"}</div>
            {cust.WEBSITE && <div>🌐 {cust.WEBSITE}</div>}
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Address
            </div>
            <div style={{ marginTop: 4 }}>
              {cust.ADDRESS && <div>{cust.ADDRESS}</div>}
              {(cust.CITY || cust.STATE) && (
                <div>{[cust.CITY, cust.STATE, cust.PINCODE].filter(Boolean).join(", ")}</div>
              )}
              {cust.COUNTRY && <div>{cust.COUNTRY}</div>}
            </div>
          </div>

          {(cust.GST_NUMBER || cust.PAN_NUMBER) && (
            <div style={{ gridColumn: "1 / -1", paddingTop: 8, borderTop: "1px dashed #cbd5e1" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>
                Tax / KYC
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 18, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                <span>GST: <strong>{cust.GST_NUMBER || "—"}</strong></span>
                <span>PAN: <strong>{cust.PAN_NUMBER || "—"}</strong></span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Machine models being built */}
      <Section title={`Machine Models We're Building for Them (${models.length})`}>
        {models.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: 14, background: "#f8fafc", borderRadius: 8 }}>
            No machines ordered yet.
          </div>
        )}
        {models.map((m) => (
          <div
            key={m.MODEL_ID}
            style={{
              padding: 14,
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              marginBottom: 10,
              background: "linear-gradient(135deg, #fef2f2 0%, #fff4e6 100%)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 8
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14 }}>
                  {m.MODEL_NAME}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                  {m.MODEL_CODE} · {m.CATEGORY || "uncategorized"}
                </div>
              </div>
              <Pill color="#6366f1">{m.total_units} units</Pill>
            </div>

            <div style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 8 }}>
              <span style={{ color: "#64748b" }}>WOs: <strong>{m.wo_count}</strong></span>
              <span style={{ color: "#f59e0b" }}>In progress: <strong>{m.in_progress_units}</strong></span>
              <span style={{ color: "#10b981" }}>Delivered: <strong>{m.done_units}</strong></span>
            </div>

            {m.bom_preview && m.bom_preview.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px dashed #c7d2fe" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#4338ca", letterSpacing: 0.8, marginBottom: 4, textTransform: "uppercase" }}>
                  BOM preview ({m.bom_total_items} items total)
                </div>
                <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
                  {m.bom_preview.map((b, i) => (
                    <div key={i}>
                      • {b.MATERIAL_NAME} <span style={{ color: "#94a3b8" }}>
                        ({b.QUANTITY} {b.UNIT})
                      </span>
                      <span style={{
                        marginLeft: 6,
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: b.TYPE === "PURCHASE" ? "#dbeafe" : "#ede9fe",
                        color: b.TYPE === "PURCHASE" ? "#1e40af" : "#6d28d9",
                        fontWeight: 700
                      }}>{b.TYPE}</span>
                    </div>
                  ))}
                  {m.bom_total_items > m.bom_preview.length && (
                    <div style={{ color: "#94a3b8", marginTop: 2 }}>
                      … and {m.bom_total_items - m.bom_preview.length} more parts
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </Section>

      {/* Projects */}
      <Section title={`Projects (${projects.length})`}>
        {projects.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>No projects yet.</div>
        )}
        {projects.map((p) => (
          <div
            key={p.ID}
            onClick={() => openEntity("project", p.ID)}
            style={{
              padding: "10px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginBottom: 8,
              cursor: "pointer"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {p.PROJECT_NAME}
                </div>
                {p.DEPARTMENT && (
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {p.DEPARTMENT}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <Pill color={
                  p.PRIORITY === "HIGH" ? "#ef4444" :
                  p.PRIORITY === "LOW" ? "#94a3b8" : "#f59e0b"
                }>{p.PRIORITY || "MEDIUM"}</Pill>
                <Pill color="#3b82f6">{p.STATUS}</Pill>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Recent work orders */}
      {wos.length > 0 && (
        <Section title={`Recent Work Orders (${wos.length})`}>
          {wos.slice(0, 10).map((wo) => (
            <div
              key={wo.ID}
              onClick={() => openEntity("work-order", wo.ID)}
              style={{
                padding: "8px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                marginBottom: 6,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600, color: "#1e40af" }}>
                  {wo.WO_NUMBER}
                </div>
                <div style={{ fontSize: 12, color: "#475569" }}>
                  {wo.MODEL_NAME} × {wo.QUANTITY}
                </div>
              </div>
              <Pill color={
                wo.STATUS === "DONE" ? "#10b981" :
                wo.STATUS === "IN_PROGRESS" ? "#f59e0b" : "#64748b"
              }>{wo.STATUS}</Pill>
            </div>
          ))}
        </Section>
      )}

      {cust.NOTES && (
        <Section title="Notes">
          <div style={{
            padding: 12,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            fontSize: 13,
            color: "#78350f",
            whiteSpace: "pre-wrap"
          }}>
            {cust.NOTES}
          </div>
        </Section>
      )}

      <div style={{ marginTop: 22, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => { onClose(); navigate("/production"); }}
          style={navBtn("#f59e0b")}
        >
          Production →
        </button>
        <button
          onClick={() => { onClose(); navigate("/customers"); }}
          style={navBtn("#06b6d4")}
        >
          All Customers →
        </button>
      </div>
    </>
  );
}


function navBtn(color) {

  return {
    border: "none",
    background: color,
    color: "white",
    padding: "8px 14px",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    boxShadow: `0 4px 12px ${color}66`
  };
}


// ---- Main wrapper ----------------------------------------------

export default function EntityDrawer({ open, type, id, onClose }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(false);

  const [stack, setStack] = useState([]);
  // navigation breadcrumbs across drilled-in entities

  const navigate = useNavigate();

  const cfg = TYPE_CONFIG[type];

  const currentType = stack.length > 0 ? stack[stack.length - 1].type : type;

  const currentId = stack.length > 0 ? stack[stack.length - 1].id : id;

  const currentCfg = TYPE_CONFIG[currentType] || cfg;

  const fetchData = async (t, i) => {

    if (!t || !i) return;

    const c = TYPE_CONFIG[t];

    if (!c) return;

    setLoading(true);

    try {

      const res = await API.get(c.api(i));

      setData(res.data);

    } catch (err) {

      setData({ error: err?.response?.data?.detail || "Failed to load" });

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    if (!open || !type || !id) return;

    setStack([]);

    fetchData(type, id);

  }, [open, type, id]);

  // Drill-in: open a related entity inside the same drawer
  const openEntity = (t, i) => {

    setStack((s) => [...s, { type: t, id: i }]);

    fetchData(t, i);
  };

  const goBack = () => {

    if (stack.length === 0) {

      onClose();

      return;
    }

    const next = stack.slice(0, -1);

    setStack(next);

    if (next.length === 0) {

      fetchData(type, id);

    } else {

      const top = next[next.length - 1];

      fetchData(top.type, top.id);
    }
  };

  if (!open) return null;

  return (

    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end"
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "92%",
          background: "white",
          overflow: "auto",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.35)",
          padding: 24
        }}
      >

        {/* Top bar */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {stack.length > 0 && (
              <button
                onClick={goBack}
                style={{
                  border: "none",
                  background: "#f1f5f9",
                  padding: "5px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#475569"
                }}
              >
                ← back
              </button>
            )}
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              padding: "3px 10px",
              borderRadius: 999,
              background: currentCfg.accent,
              color: "white"
            }}>
              {currentCfg.label}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "#f1f5f9",
              padding: "4px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 18
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ color: "#94a3b8", padding: 20 }}>Loading 360° view…</div>
        )}

        {!loading && data?.error && (
          <div style={{ color: "#b91c1c", padding: 20 }}>
            {data.error}
          </div>
        )}

        {!loading && data && !data.error && currentType === "employee" && (
          <EmployeeView
            data={data}
            openEntity={openEntity}
            navigate={navigate}
            onClose={onClose}
          />
        )}

        {!loading && data && !data.error && currentType === "project" && (
          <ProjectView
            data={data}
            openEntity={openEntity}
            navigate={navigate}
            onClose={onClose}
            refresh={() => fetchData(currentType, currentId)}
          />
        )}

        {!loading && data && !data.error && currentType === "work-order" && (
          <WorkOrderView
            data={data}
            openEntity={openEntity}
            navigate={navigate}
            onClose={onClose}
          />
        )}

        {!loading && data && !data.error && currentType === "supplier" && (
          <SupplierView
            data={data}
            openEntity={openEntity}
            navigate={navigate}
            onClose={onClose}
          />
        )}

        {!loading && data && !data.error && currentType === "customer" && (
          <CustomerView
            data={data}
            openEntity={openEntity}
            navigate={navigate}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
