import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import { formatISTTime } from "../utils/time";

import styles from "./EntityDrawer.module.css";


// ===================================================================
// EntityDrawer — one reusable side-drawer that opens for ANY entity
// (employee / project / supplier). Uses the /connect/*
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
  supplier: {
    api: (id) => `/connect/supplier/${id}/360`,
    label: "Supplier 360°",
    accent: "#ec4899"
  }
  // customer 360° removed — its only invoker (Customers.jsx) was
  // retired in favor of /customer-master.
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


function ProjectView({ data, openEntity, navigate, onClose, refresh }) {

  const proj = data?.project || {};

  const customer = data?.customer;

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
              {customer.PHONE_NUMBER} · {customer.EMAIL}
            </div>
            {customer.ADDRESS && (
              <div className={styles.customerCardAddr}>
                {customer.ADDRESS}
              </div>
            )}
          </div>
        </Section>
      )}

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

      <div className={styles.navRow}>
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


function SupplierView({ data, navigate, onClose }) {

  const sup = data?.supplier || {};

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


// CustomerView removed — its only invoker (Customers.jsx) was retired
// in favor of /customer-master.


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

        {!loading && data && !data.error && currentType === "supplier" && (
          <SupplierView
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
