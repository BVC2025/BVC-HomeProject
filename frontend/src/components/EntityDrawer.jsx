import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API, { API_BASE_URL } from "../services/api";

import { formatISTTime } from "../utils/time";

import { bomIconTileStyle } from "../utils/bomIcons";
import styles from "./EntityDrawer.module.css";


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
      className={styles.pill}
      style={{
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
      className={styles.statTile}
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className={styles.statTileLabel}>
        {label}
      </div>
      <div className={styles.statTileValue}>
        {value}
      </div>
      {sub && (
        <div className={styles.statTileSub}>
          {sub}
        </div>
      )}
    </div>
  );
}


function Section({ title, children }) {

  return (

    <div className={styles.section}>
      <div className={styles.sectionTitle}>
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

      <div className={styles.empHero}>
        <div className={styles.empAvatar}>
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>
        <div className={styles.flex1}>
          <div className={styles.empName}>
            {emp.NAME}
          </div>
          <div className={styles.empMeta}>
            {emp.EMPLOYEE_CODE} · {emp.DEPARTMENT || "—"}
          </div>
          {emp.EMAIL && (
            <div className={styles.empContact}>
              {emp.EMAIL}{emp.PHONE && ` · ${emp.PHONE}`}
            </div>
          )}
        </div>
      </div>

      <div className={styles.statsGrid4}>
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
          <div className={styles.statsGrid3}>
            <StatTile label="Check-In" value={formatISTTime(att.CHECK_IN)} accent="#10b981" />
            <StatTile label="Check-Out" value={att.CHECK_OUT ? formatISTTime(att.CHECK_OUT) : "—"} accent="#ef4444" />
            <StatTile label="Status" value={att.STATUS} accent="#3b82f6" />
          </div>
        </Section>
      )}

      {emp.SKILLS && (
        <Section title="Skills">
          <div className={styles.skillsWrap}>
            {emp.SKILLS.split(",").map((s, i) => (
              <Pill key={i} color="#6366f1">{s.trim()}</Pill>
            ))}
          </div>
        </Section>
      )}

      <Section title="Active Tasks">
        {tasks.length === 0 && (
          <div className={styles.emptyMsg}>No active tasks.</div>
        )}
        {tasks.map((t) => (
          <div
            key={t.TASK_ID}
            className={styles.taskCard}
            style={{ cursor: t.PROJECT_ID ? "pointer" : "default" }}
            onClick={() => t.PROJECT_ID && openEntity("project", t.PROJECT_ID)}
          >
            <div className={styles.taskCardTitle}>
              {t.TASK_NAME}
            </div>
            <div className={styles.taskCardSub}>
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
              className={styles.stageCard}
              onClick={() => openEntity("work-order", s.WO_ID)}
            >
              <div className={styles.stageCardTitle}>
                {s.STAGE_NAME}
              </div>
              <div className={styles.stageCardMeta}>
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
          <div className={styles.statsGrid3}>
            <StatTile label="Casual" value={balance.CASUAL.remaining} sub={`of ${balance.CASUAL.total}`} accent="#3b82f6" />
            <StatTile label="Sick" value={balance.SICK.remaining} sub={`of ${balance.SICK.total}`} accent="#ef4444" />
            <StatTile label="Earned" value={balance.EARNED.remaining} sub={`of ${balance.EARNED.total}`} accent="#10b981" />
          </div>
        </Section>
      )}

      {leaveRequests.length > 0 && (
        <Section title="Recent Leave Requests">
          {leaveRequests.slice(0, 5).map((l) => (
            <div key={l.ID} className={styles.leaveRow}>
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
            <div key={s.ID} className={styles.scanRow}>
              <span>{s.DEVICE_ID} · {s.VERIFY_MODE}</span>
              <span className={styles.scanRowCode}>
                {formatISTTime(s.EVENT_TIME)} · <Pill color={
                  s.RESULT === "SUCCESS" ? "#10b981" : "#ef4444"
                }>{s.RESULT}</Pill>
              </span>
            </div>
          ))}
        </Section>
      )}

      <div className={styles.navRow}>
        <button
          onClick={() => { onClose(); navigate("/md-review"); }}
          className={styles.navBtn}
          style={{ background: "#6366f1", boxShadow: "0 4px 12px #6366f166" }}
        >
          MD Performance Review →
        </button>
        <button
          onClick={() => { onClose(); navigate("/attendance"); }}
          className={styles.navBtn}
          style={{ background: "#10b981", boxShadow: "0 4px 12px #10b98166" }}
        >
          Attendance →
        </button>
        <button
          onClick={() => { onClose(); navigate("/leave-management"); }}
          className={styles.navBtn}
          style={{ background: "#ec4899", boxShadow: "0 4px 12px #ec489966" }}
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
        className={styles.bomTr}
        style={{ background: expanded ? "#f8fafc" : "white" }}
      >

        {/* Preview cell */}
        <td className={styles.bomTdPreview}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.MATERIAL_NAME}
              className={styles.bomImg}
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
        <td className={styles.bomTdItemNo}>
          {item.ITEM_NO ?? "—"}
        </td>

        {/* Part number */}
        <td className={styles.bomTdPart}>
          <div className={styles.bomPartName}>
            {item.MATERIAL_NAME}
          </div>
          <div className={styles.bomPartMeta}>
            <span>{item.PER_UNIT_QUANTITY} {item.UNIT} per unit</span>
            {isProcess && (
              <span className={styles.bomTagProcess}>
                IN-HOUSE
              </span>
            )}
            {item.PREFERRED_SUPPLIER_NAME && (
              <span className={styles.bomTagSupplier}>
                🏢 {item.PREFERRED_SUPPLIER_NAME}
              </span>
            )}
            <span className={styles.bomExpandHint}>
              {expanded ? "▴ hide" : "▾ supplier"}
            </span>
          </div>
        </td>

        {/* Qty */}
        <td className={styles.bomTdQty}>
          {item.TOTAL_QUANTITY}
        </td>

      </tr>

      {expanded && (
        <tr className={styles.bomExpandRow}>
          <td colSpan={4} className={styles.bomExpandCell}>
            {isProcess ? (
              <div className={styles.bomProcessText}>
                <strong>Made in-house</strong> · Stage:{" "}
                <span style={{ color: "var(--text-primary, #0f172a)" }}>
                  {item.PROCESS_STAGE_NAME || "—"}
                </span>
              </div>
            ) : (
              <div
                onClick={(e) => e.stopPropagation()}
                className={styles.bomSupplierRow}
              >
                <label className={styles.bomSupplierLabel}>
                  Supplier:
                </label>
                <select
                  value={item.PREFERRED_SUPPLIER_ID || ""}
                  onChange={(e) => updateSupplier(item.ID, e.target.value)}
                  disabled={savingId === item.ID}
                  className={styles.bomSupplierSelect}
                  style={{ background: savingId === item.ID ? "#f1f5f9" : "white" }}
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
                  <span className={styles.bomSavingText}>
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
        <div className={styles.bomEmptyBox}>
          This product has no BOM lines yet. You can auto-seed the
          common vending-machine BOM (cabinet, motor, control board,
          touchscreen, payment terminal, glass, etc.) — suppliers are
          pre-linked where they match your supplier directory.

          {errorMsg && (
            <div className={styles.bomErrorBox}>
              {errorMsg}
            </div>
          )}

          <div className={styles.bomSeedActions}>
            <button
              onClick={seedDefaultBom}
              disabled={seeding || !productModelId}
              className={styles.bomSeedBtn}
              style={{
                background: seeding ? "#cbd5e1" : "#f59e0b",
                cursor: seeding ? "default" : "pointer"
              }}
            >
              {seeding ? "Seeding…" : "✨ Seed Common BOM"}
            </button>
            <button
              onClick={() => { onClose(); navigate("/production"); }}
              className={styles.bomManualBtn}
            >
              Or add manually →
            </button>
          </div>
        </div>
      )}

      {bom.length > 0 && (
        <div>

          {errorMsg && (
            <div className={styles.bomErrorBoxInline}>
              {errorMsg}
            </div>
          )}

          <div className={styles.bomHint}>
            Excel-style BOM with image preview. Tap any row to expand
            the supplier picker.
          </div>

          <table className={styles.bomTable}>
            <thead>
              <tr className={styles.bomTableHead}>
                <th className={styles.bomThPreview}>
                  Preview
                </th>
                <th className={styles.bomThItemNo}>
                  Item No.
                </th>
                <th className={styles.bomThPart}>
                  Part Number
                </th>
                <th className={styles.bomThQty}>
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

          <div className={styles.bomNote}>
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
      <div className={styles.projHero}>
        <div className={styles.projHeroLabel}>
          Project
        </div>
        <div className={styles.projHeroName}>
          {proj.PROJECT_NAME}
        </div>
        <div className={styles.projHeroPills}>
          <Pill color={proj.PRIORITY === "HIGH" ? "#ef4444" : proj.PRIORITY === "LOW" ? "#94a3b8" : "#f59e0b"}>
            {proj.PRIORITY || "MEDIUM"}
          </Pill>
          <Pill color="#3b82f6">{proj.STATUS}</Pill>
          {proj.DEPARTMENT && <Pill color="#8b5cf6">{proj.DEPARTMENT}</Pill>}
        </div>
        {proj.DESCRIPTION && (
          <div className={styles.projDesc}>
            {proj.DESCRIPTION}
          </div>
        )}
      </div>

      <div className={styles.statsGrid4}>
        <StatTile label="Work Orders" value={wos.length} accent="#f59e0b" />
        <StatTile label="Tasks Total" value={stats.total ?? 0} accent="#3b82f6" />
        <StatTile label="Tasks Done" value={stats.completed ?? 0} accent="#10b981" />
        <StatTile label="Assigned" value={emps.length} sub="employees" accent="#6366f1" />
      </div>

      {showBackfill && (
        <div className={styles.backfillBanner}>
          <div className={styles.backfillTitle}>
            No tasks generated for this project yet
          </div>
          <div className={styles.backfillBody}>
            This product-driven project has no tasks. Click below to auto-generate
            tasks from the product's manufacturing stages and assign each one to
            the best-skill employee.
          </div>
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className={styles.backfillBtn}
            style={{
              background: backfilling ? "#cbd5e1" : "#f59e0b",
              cursor: backfilling ? "default" : "pointer"
            }}
          >
            {backfilling ? "Generating…" : "⚡ Generate Tasks Now"}
          </button>
          {backfillMsg && (
            <div
              className={styles.backfillFeedback}
              style={{ color: backfillMsg.ok ? "#166534" : "#b91c1c" }}
            >
              {backfillMsg.text}
            </div>
          )}
        </div>
      )}

      {customer && (
        <Section title="Customer">
          <div className={styles.customerCard}>
            <div className={styles.customerCardName}>
              {customer.NAME}
            </div>
            <div className={styles.customerCardSub}>
              {customer.PHONE} · {customer.EMAIL}
            </div>
            {customer.ADDRESS && (
              <div className={styles.customerCardAddr}>
                {customer.ADDRESS}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={`Work Orders (${wos.length})`}>
        {wos.length === 0 && (
          <div className={styles.emptyMsg}>No work orders yet.</div>
        )}
        {wos.map((wo) => (
          <div
            key={wo.ID}
            onClick={() => openEntity("work-order", wo.ID)}
            className={styles.taskCard}
          >
            <div className={styles.flexRow}>
              <div>
                <div className={styles.woHeroCode}>
                  {wo.WO_NUMBER}
                </div>
                <div className={styles.taskCardTitle} style={{ marginTop: 2 }}>
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
        <div className={styles.empChipWrap}>
          {emps.map((e) => (
            <button
              key={e.ID}
              onClick={() => openEntity("employee", e.ID)}
              className={styles.empChipBtn}
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

      <div className={styles.navRow}>
        <button
          onClick={() => { onClose(); navigate("/production"); }}
          className={styles.navBtn}
          style={{ background: "#f59e0b", boxShadow: "0 4px 12px #f59e0b66" }}
        >
          Production & BOM →
        </button>
        <button
          onClick={() => { onClose(); navigate("/projects"); }}
          className={styles.navBtn}
          style={{ background: "#3b82f6", boxShadow: "0 4px 12px #3b82f666" }}
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
      <div className={styles.woHero}>
        <div className={styles.woHeroCode}>
          {wo.WO_NUMBER}
        </div>
        <div className={styles.woHeroName}>
          {model?.MODEL_NAME || "—"} × {wo.QUANTITY}
        </div>
        <div className={styles.woHeroPills}>
          <Pill color={
            wo.STATUS === "DONE" ? "#10b981" :
            wo.STATUS === "IN_PROGRESS" ? "#f59e0b" : "#64748b"
          }>{wo.STATUS}</Pill>
          {model && <Pill color="#8b5cf6">{model.CATEGORY || "—"}</Pill>}
        </div>
      </div>

      <div className={styles.statsGrid4}>
        <StatTile label="Progress" value={`${progressPct}%`} sub={`${stagesDone}/${stages.length}`} accent="#10b981" />
        <StatTile label="BOM Lines" value={bom.length} accent="#6366f1" />
        <StatTile label="Inspections" value={inspections.length} accent="#3b82f6" />
        <StatTile label="NCRs" value={ncrs.length} accent={ncrs.length ? "#ef4444" : "#94a3b8"} />
      </div>

      {project && (
        <Section title="Project">
          <button
            onClick={() => openEntity("project", project.ID)}
            className={styles.projLinkBtn}
          >
            <div className={styles.projLinkBtnName}>
              📁 {project.PROJECT_NAME}
            </div>
            <div className={styles.projLinkBtnSub}>
              Status: {project.STATUS}
            </div>
          </button>
        </Section>
      )}

      <Section title={`Manufacturing Stages (${stages.length})`}>
        {stages.map((s) => (
          <div key={s.STAGE_ID} className={styles.stageSeqRow}>
            <div
              className={styles.stageSeqBadge}
              style={{
                background: s.STATUS === "DONE" ? "#dcfce7" : s.STATUS === "IN_PROGRESS" ? "#fef3c7" : "#f1f5f9",
                color: s.STATUS === "DONE" ? "#166534" : s.STATUS === "IN_PROGRESS" ? "#854d0e" : "#475569"
              }}
            >
              {s.SEQUENCE}
            </div>
            <div className={styles.flex1}>
              <div className={styles.stageSeqName}>
                {s.STAGE_NAME}
              </div>
              <div className={styles.stageSeqType}>
                {s.STAGE_TYPE}
                {s.ASSIGNED_TO_NAME && (
                  <button
                    onClick={() => openEntity("employee", s.ASSIGNED_TO_ID)}
                    className={styles.stageAssignBtn}
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
        {bom.length === 0 && <div className={styles.emptyMsg}>No BOM lines.</div>}
        {bom.slice(0, 10).map((b) => (
          <div key={b.ID} className={styles.bomRow}>
            <span className={styles.bomRowName}>
              {b.MATERIAL_NAME}
              {b.SUPPLIER_NAME && (
                <button
                  onClick={() => openEntity("supplier", b.SUPPLIER_ID)}
                  className={styles.bomSupplierBtn}
                >
                  · {b.SUPPLIER_NAME}
                </button>
              )}
            </span>
            <span className={styles.bomRowQty}>{b.TOTAL_FOR_WO} {b.UNIT}</span>
            <Pill color={b.TYPE === "PURCHASE" ? "#3b82f6" : "#8b5cf6"}>{b.TYPE}</Pill>
          </div>
        ))}
      </Section>

      {ncrs.length > 0 && (
        <Section title={`NCRs (${ncrs.length})`}>
          {ncrs.map((n) => (
            <div key={n.ID} className={styles.ncrCard}>
              <div className={styles.ncrCardHead}>
                <strong className={styles.ncrCode}>{n.NCR_NUMBER}</strong>
                <Pill color={
                  n.SEVERITY === "CRITICAL" ? "#991b1b" :
                  n.SEVERITY === "MAJOR" ? "#b91c1c" : "#64748b"
                }>{n.SEVERITY}</Pill>
              </div>
              <div className={styles.ncrCheckpoint}>{n.CHECK_POINT}</div>
            </div>
          ))}
        </Section>
      )}

      <div className={styles.navRow}>
        <button
          onClick={() => { onClose(); navigate("/production"); }}
          className={styles.navBtn}
          style={{ background: "#f59e0b", boxShadow: "0 4px 12px #f59e0b66" }}
        >
          Production →
        </button>
        <button
          onClick={() => { onClose(); navigate("/quality"); }}
          className={styles.navBtn}
          style={{ background: "#10b981", boxShadow: "0 4px 12px #10b98166" }}
        >
          Quality →
        </button>
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
      <div className={styles.supHero}>
        <div className={styles.supHeroCode}>
          {sup.SUPPLIER_CODE}
        </div>
        <div className={styles.supHeroName}>
          {sup.COMPANY_NAME}
        </div>
        <div className={styles.supHeroPills}>
          {sup.CATEGORY && <Pill color="#ec4899">{sup.CATEGORY}</Pill>}
          <Pill color={sup.STATUS === "ACTIVE" ? "#10b981" : "#94a3b8"}>{sup.STATUS}</Pill>
        </div>
      </div>

      <div className={styles.statsGrid3}>
        <StatTile label="Models" value={sum.models_count ?? 0} sub="supplied" accent="#6366f1" />
        <StatTile label="BOM Lines" value={sum.total_bom_lines ?? 0} accent="#3b82f6" />
        <StatTile label="Active WOs" value={sum.active_wos_count ?? 0} sub="need parts" accent="#f59e0b" />
      </div>

      <Section title="Contact & KYC">
        <div className={styles.supContactGrid}>
          <div>👤 {sup.CONTACT_PERSON || "—"}</div>
          <div>📞 {sup.PHONE || "—"}</div>
          <div>✉️ {sup.EMAIL || "—"}</div>
          <div>📍 {sup.CITY || "—"}, {sup.STATE || "—"} {sup.PINCODE || ""}</div>
          <div className={styles.supContactMono}>GST: {sup.GST_NUMBER || "—"}</div>
          <div className={styles.supContactMono}>PAN: {sup.PAN_NUMBER || "—"}</div>
          <div>🏦 {sup.BANK_NAME || "—"}</div>
          <div>💳 {sup.PAYMENT_TERMS || "—"}</div>
        </div>
      </Section>

      <Section title={`Models Using This Supplier (${models.length})`}>
        {models.map((m) => (
          <div key={m.MODEL_ID} className={styles.supModelCard}>
            <div className={styles.supModelName}>{m.MODEL_NAME}</div>
            <div className={styles.supModelCode}>
              {m.MODEL_CODE}
            </div>
            {m.parts.map((p, i) => (
              <div key={i} className={styles.supModelPart}>
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
              className={styles.activeWoChip}
            >
              <strong className={styles.activeWoCode}>{wo.WO_NUMBER}</strong>
              {" · "}{wo.MODEL_NAME} × {wo.QUANTITY}{" · "}
              <Pill color="#f59e0b">{wo.STATUS}</Pill>
            </div>
          ))}
        </Section>
      )}

      <div className={styles.navRow}>
        <button
          onClick={() => { onClose(); navigate("/suppliers"); }}
          className={styles.navBtn}
          style={{ background: "#ec4899", boxShadow: "0 4px 12px #ec489966" }}
        >
          All Suppliers →
        </button>
      </div>
    </>
  );
}


function CustomerView({ data, navigate, onClose }) {

  const cust = data?.customer || {};

  const sum = data?.summary || {};

  const requirements = data?.requirements || [];

  // Production state still arrives in the payload — we don't render
  // the heavy sections (machine models, projects, work orders) here
  // any more, but we keep `sum` for the four top tiles and offer a
  // single button at the bottom to jump to the production page.
  const fmtMoney = (v) =>
    v == null || v === ""
      ? "—"
      : `₹${Number(v).toLocaleString("en-IN", {
          maximumFractionDigits: 2, minimumFractionDigits: 0
        })}`;

  const fmtDate = (v) => {

    if (!v) return "—";

    try {

      const d = new Date(v);

      return d.toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric"
      });

    } catch {

      return v;
    }
  };

  const ReadField = ({ label, value, mono }) => (

    <div>
      <div className={styles.readFieldLabel}>
        {label}
      </div>
      <div
        className={styles.readFieldValue}
        style={{
          color: value == null || value === "" ? "#94a3b8" : "#0f172a",
          fontWeight: value == null || value === "" ? 400 : 600,
          fontFamily: mono ? "ui-monospace, monospace" : undefined
        }}
      >
        {value == null || value === "" ? "—" : value}
      </div>
    </div>
  );

  return (

    <>

      {/* Hero: avatar + name + status pill */}
      <div className={styles.custHero}>

        <div className={styles.custAvatar}>
          {(cust.CUSTOMER_NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div className={styles.flex1MinW0}>

          <div className={styles.custCode}>
            {cust.CUSTOMER_CODE || "—"}
          </div>

          <div className={styles.custName}>
            {cust.CUSTOMER_NAME}
          </div>

          <div className={styles.custPills}>
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
      <div className={styles.custStatsGrid}>
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
        <div className={styles.contactCard}>
          <div>
            <div className={styles.contactCardColLabel}>
              Contact
            </div>
            <div className={styles.contactCardColName}>
              {cust.CONTACT_PERSON || "—"}
              {cust.DESIGNATION && (
                <span className={styles.contactCardDesig}>
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
            <div className={styles.contactCardColLabel}>
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
            <div className={styles.taxRow}>
              <div className={styles.taxRowLabel}>
                Tax / KYC
              </div>
              <div className={styles.taxRowValues}>
                <span>GST: <strong>{cust.GST_NUMBER || "—"}</strong></span>
                <span>PAN: <strong>{cust.PAN_NUMBER || "—"}</strong></span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ============== Enquiry / Lead Information ============== */}
      <Section title="Enquiry Information">
        <div className={styles.enquiryGrid}>
          <ReadField label="Enquiry Date" value={fmtDate(cust.LEAD_CREATED_DATE || cust.CREATED_AT)} />
          <ReadField label="Lead Source" value={cust.LEAD_SOURCE || cust.SOURCE} />
          <ReadField label="Lead Status" value={cust.LEAD_STATUS} />

          <ReadField label="Priority" value={cust.LEAD_PRIORITY} />
          <ReadField label="Industry" value={cust.INDUSTRY} />
          <ReadField label="Customer Status" value={cust.STATUS} />

          <ReadField label="Follow-up Date" value={fmtDate(cust.FOLLOW_UP_DATE)} />
          <ReadField label="Next Meeting" value={fmtDate(cust.NEXT_MEETING_DATE)} />
          <ReadField label="Assigned Sales ID" value={cust.ASSIGNED_SALES_ID} mono />
        </div>

        {(cust.REQUIREMENT_NOTES || cust.REMARKS) && (

          <div className={styles.notesSpacer}>

            {cust.REQUIREMENT_NOTES && (

              <div className={styles.notesPanelBlue}>
                <div className={styles.notesPanelBlueLabel}>
                  💬 Initial Enquiry Notes (from chatbot / intake form)
                </div>
                <div className={styles.notesPanelBlueBody}>
                  {cust.REQUIREMENT_NOTES}
                </div>
              </div>
            )}

            {cust.REMARKS && (

              <div className={styles.notesPanelAmber}>
                <div className={styles.notesPanelAmberLabel}>
                  Internal Remarks
                </div>
                {cust.REMARKS}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ============== Vending Machine Requirements ============== */}
      <Section title={`Vending Machine Requirements / Requests (${requirements.length})`}>

        {requirements.length === 0 && (

          <div className={styles.noReqPlaceholder}>
            No machine requirements submitted yet.<br />
            <span className={styles.noReqPlaceholderSub}>
              When the customer fills the chatbot intake form, each request will appear here.
            </span>
          </div>
        )}

        {requirements.map((r, idx) => (

          <div key={r.ID} className={styles.reqCard}>

            {/* Card header */}
            <div
              className={styles.reqCardHeader}
              style={{ background: "#ef4444" }}
            >
              <div className={styles.reqCardHeaderLeft}>
                <div className={styles.reqCardBadge}>
                  {idx + 1}
                </div>
                <div>
                  <div className={styles.reqCardMachineName}>
                    {r.MACHINE_NAME || r.MACHINE_CATEGORY || "Machine Request"}
                  </div>
                  <div className={styles.reqCardDate}>
                    Submitted {fmtDate(r.CREATED_AT)}
                  </div>
                </div>
              </div>
              <div className={styles.reqCardPills}>
                <Pill color={
                  r.PRIORITY === "HIGH" ? "#fca5a5" :
                  r.PRIORITY === "LOW" ? "#94a3b8" : "#fcd34d"
                }>{r.PRIORITY || "MEDIUM"}</Pill>
                <Pill color={
                  r.STATUS === "ORDERED" ? "#86efac" :
                  r.STATUS === "QUOTED" ? "#93c5fd" :
                  r.STATUS === "CONFIRMED" ? "#a5b4fc" :
                  r.STATUS === "CANCELLED" ? "#fca5a5" :
                  "#fde68a"
                }>{r.STATUS || "DRAFT"}</Pill>
              </div>
            </div>

            {/* Card body — form-style read-only fields */}
            <div className={styles.reqCardBody}>
              <ReadField label="Machine Category" value={r.MACHINE_CATEGORY} />
              <ReadField label="Machine Name" value={r.MACHINE_NAME} />
              <ReadField label="Quantity" value={r.QUANTITY ? `${r.QUANTITY} unit(s)` : null} />

              <ReadField label="Capacity / Size" value={r.CAPACITY} />
              <ReadField label="Target Unit Price" value={r.TARGET_UNIT_PRICE != null ? fmtMoney(r.TARGET_UNIT_PRICE) : null} />
              <ReadField label="Target Delivery Date" value={fmtDate(r.TARGET_DELIVERY_DATE)} />

              <div className={styles.reqCardBodyFull}>
                <ReadField label="Installation Site" value={r.INSTALLATION_SITE} />
              </div>

              {r.SPECIAL_NOTES && (

                <div className={styles.reqSpecialNotes}>
                  <div className={styles.reqSpecialNotesLabel}>
                    💡 Special Notes / Customization
                  </div>
                  <div className={styles.reqSpecialNotesBody}>
                    {r.SPECIAL_NOTES}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </Section>

      {/* ============== General Notes ============== */}
      {cust.NOTES && (

        <Section title="General Notes">
          <div className={styles.notesPanelAmber}>
            {cust.NOTES}
          </div>
        </Section>
      )}

      {/* ============== Footer actions ============== */}
      <div className={styles.navRow}>

        {sum.projects_total > 0 && (
          <button
            onClick={() => { onClose(); navigate("/production"); }}
            className={styles.navBtn}
            style={{ background: "#f59e0b", boxShadow: "0 4px 12px #f59e0b66" }}
            title={`View ${sum.projects_total} project(s) and ${sum.work_orders_total || 0} work order(s) tied to this customer`}
          >
            🏭 View Production Status →
          </button>
        )}

        <button
          onClick={() => { onClose(); navigate("/customers"); }}
          className={styles.navBtn}
          style={{ background: "#06b6d4", boxShadow: "0 4px 12px #06b6d466" }}
        >
          All Customers →
        </button>
      </div>
    </>
  );
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
      className={styles.overlay}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.panel}
      >

        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            {stack.length > 0 && (
              <button
                onClick={goBack}
                className={styles.backBtn}
              >
                ← back
              </button>
            )}
            <span
              className={styles.typeLabel}
              style={{ background: currentCfg.accent }}
            >
              {currentCfg.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className={styles.closeBtn}
          >
            ×
          </button>
        </div>

        {loading && (
          <div className={styles.loadingMsg}>Loading 360° view…</div>
        )}

        {!loading && data?.error && (
          <div className={styles.errorMsg}>
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
