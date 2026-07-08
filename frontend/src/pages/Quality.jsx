import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./Quality.module.css";


// ----------------------------------------------------------------
// Constants + helpers
// ----------------------------------------------------------------

const STATUS_THEMES = {
  PENDING: { bg: "#fef3c7", fg: "#854d0e" },
  PASS: { bg: "#dcfce7", fg: "#166534" },
  FAIL: { bg: "#fee2e2", fg: "#b91c1c" },
  REWORK: { bg: "#fed7aa", fg: "#9a3412" },
  OPEN: { bg: "#fee2e2", fg: "#b91c1c" },
  IN_PROGRESS: { bg: "#fef3c7", fg: "#854d0e" },
  CLOSED: { bg: "#dcfce7", fg: "#166534" }
};


const SEVERITY_THEMES = {
  CRITICAL: { bg: "#fee2e2", fg: "#991b1b" },
  MAJOR: { bg: "#fef3c7", fg: "#854d0e" },
  MINOR: { bg: "#f1f5f9", fg: "#475569" }
};


const RESULT_THEMES = {
  PENDING: { bg: "#f1f5f9", fg: "#64748b", label: "Pending" },
  PASS: { bg: "#dcfce7", fg: "#166534", label: "Pass" },
  FAIL: { bg: "#fee2e2", fg: "#b91c1c", label: "Fail" },
  NEEDS_REWORK: { bg: "#fed7aa", fg: "#9a3412", label: "Rework" },
  NA: { bg: "#f1f5f9", fg: "#94a3b8", label: "N/A" }
};


function Pill({ themes, value, label }) {

  const t = themes[value] || themes.PENDING;

  return (

    <span
      className={styles.pill}
      style={{ background: t.bg, color: t.fg }}
    >
      {label || value?.replaceAll("_", " ")}
    </span>
  );
}


function Tile({ label, value, sub, color }) {

  return (

    <div
      className={styles.tileCard}
      style={{ borderTop: `3px solid ${color}` }}
    >

      <div className={styles.tileLabelText}>
        {label}
      </div>

      <div className={styles.tileValueText}>
        {value}
      </div>

      {sub && (
        <div className={styles.tileSubText}>
          {sub}
        </div>
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// Dashboard tab
// ----------------------------------------------------------------

function DashboardTab() {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {

    API.get("/quality/dashboard", { params: { vendor_id: 1 } })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  }, []);

  if (loading) return <div className={styles.textMutedEl}>Loading…</div>;

  if (!data) return <div className={styles.textErrorEl}>Failed to load.</div>;

  return (

    <div>

      <div className={styles.dashTilesGrid}>

        <Tile
          label="Pass Rate"
          value={`${data.pass_rate_pct}%`}
          sub={`${data.by_status?.PASS ?? 0} of ${data.total_inspections} inspections`}
          color="#22c55e"
        />

        <Tile
          label="Total Inspections"
          value={data.total_inspections}
          color="#1e40af"
        />

        <Tile
          label="Open NCRs"
          value={data.open_ncrs}
          sub={`${data.critical_open_ncrs} critical`}
          color={data.open_ncrs > 0 ? "#ef4444" : "#94a3b8"}
        />

        <Tile
          label="Total NCRs"
          value={data.total_ncrs}
          sub="lifetime"
          color="#64748b"
        />
      </div>

      <div className={styles.dashStatusCard}>

        <div className={styles.dashStatusCardTitle}>
          Inspections by Status
        </div>

        <div className={styles.dashStatusChipsRow}>

          {Object.entries(data.by_status || {}).map(([status, count]) => (

            <div
              key={status}
              className={styles.statusChipInner}
              style={{
                background: (STATUS_THEMES[status] || {}).bg || "#f1f5f9"
              }}
            >

              <div
                className={styles.statusChipInnerLabel}
                style={{
                  color: (STATUS_THEMES[status] || {}).fg || "#475569"
                }}
              >
                {status}
              </div>

              <div
                className={styles.statusChipInnerValue}
                style={{
                  color: (STATUS_THEMES[status] || {}).fg || "#0f172a"
                }}
              >
                {count}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Checklists tab — view templates per model
// ----------------------------------------------------------------

function ChecklistsTab() {

  const [models, setModels] = useState([]);

  const [selectedId, setSelectedId] = useState(null);

  const [items, setItems] = useState([]);

  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {

    API.get("/production/models", { params: { vendor_id: 1 } })
      .then((r) => {

        const ms = r.data || [];

        setModels(ms);

        if (ms.length && !selectedId) setSelectedId(ms[0].ID);
      });

  }, []);

  useEffect(() => {

    if (!selectedId) return;

    setLoadingItems(true);

    API.get(`/quality/checklist/${selectedId}`)
      .then((r) => setItems(r.data || []))
      .finally(() => setLoadingItems(false));

  }, [selectedId]);

  return (

    <div className={styles.checklistsFlexRow}>

      {/* Model list */}
      <div className={styles.modelList}>

        <div className={styles.modelListTitle}>
          Machine Models
        </div>

        {models.map((m) => (

          <button
            key={m.ID}
            onClick={() => setSelectedId(m.ID)}
            className={`${styles.modelBtn}${selectedId === m.ID ? ` ${styles.modelBtnActive}` : ""}`}
          >

            <div
              className={`${styles.modelBtnName}${selectedId === m.ID ? ` ${styles.modelBtnNameActive}` : ""}`}
            >
              {m.MODEL_NAME}
            </div>

            <div className={styles.modelCodeText}>
              {m.MODEL_CODE}
            </div>
          </button>
        ))}
      </div>

      {/* Checklist items */}
      <div className={styles.checklistPanel}>

        <div className={styles.checklistPanelTitle}>
          Pre-Dispatch Checklist ({items.length} items)
        </div>

        {loadingItems && (
          <div className={styles.textMutedEl}>Loading…</div>
        )}

        {!loadingItems && items.length === 0 && (

          <div className={styles.textMutedPadded}>
            No checklist items for this model. Re-run{" "}
            <code>/demo/seed-bvc24</code> to populate.
          </div>
        )}

        {items.map((it) => (

          <div key={it.ID} className={styles.checklistItemRow}>

            <div className={styles.checklistItemSeq}>
              {it.SEQUENCE}.
            </div>

            <div className={styles.checklistItemBody}>

              <div className={styles.checklistItemPoint}>
                {it.CHECK_POINT}
              </div>

              {it.DESCRIPTION && (

                <div className={styles.checklistItemDesc}>
                  {it.DESCRIPTION}
                </div>
              )}
            </div>

            <Pill themes={SEVERITY_THEMES} value={it.SEVERITY} />
          </div>
        ))}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Inspection detail drawer
// ----------------------------------------------------------------

function InspectionDrawer({ inspectionId, onClose, onChanged }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [finalising, setFinalising] = useState(false);

  const fetchOne = () => {

    setLoading(true);

    API.get(`/quality/inspections/${inspectionId}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    if (inspectionId) fetchOne();

  }, [inspectionId]);

  if (!inspectionId) return null;

  const insp = data?.inspection;

  const results = data?.results || [];

  const mark = async (rid, value) => {

    try {

      await API.patch(`/quality/results/${rid}`, { RESULT: value });

      fetchOne();

      onChanged?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const finalise = async () => {

    if (!confirm("Finalise this inspection? NCRs will be auto-opened for any failures.")) return;

    setFinalising(true);

    try {

      const res = await API.post(
        `/quality/inspections/${inspectionId}/finalise`,
        {}
      );

      alert(
        `Inspection ${res.data.status}\n`
          + `Pass: ${res.data.pass_count} · Fail: ${res.data.fail_count} · Rework: ${res.data.rework_count}\n`
          + (res.data.ncrs_opened.length
            ? `NCRs opened: ${res.data.ncrs_opened.length}`
            : "No NCRs needed.")
      );

      fetchOne();

      onChanged?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");

    } finally {

      setFinalising(false);
    }
  };

  const pendingCount = results.filter((r) => r.RESULT === "PENDING").length;

  const canFinalise = insp?.STATUS === "PENDING";

  return (

    <div
      className={styles.drawerOverlayPanel}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.drawerPanelInner}
      >

        <div className={styles.drawerHeaderRow}>

          <div>

            <div className={styles.drawerTitleText}>
              Inspection #{insp?.ID}
            </div>

            <div className={styles.drawerMetaText}>
              {insp?.WO_NUMBER}
              {" · "}
              {insp?.MODEL_NAME}
              {" · "}
              by {insp?.INSPECTOR_NAME || "—"}
            </div>

            <div className={styles.drawerStatusWrap}>
              <Pill themes={STATUS_THEMES} value={insp?.STATUS} />
            </div>
          </div>

          <button
            onClick={onClose}
            className={styles.drawerCloseBtnEl}
          >
            ×
          </button>
        </div>

        {loading && <div className={styles.textMutedEl}>Loading…</div>}

        {!loading && (

          <>

            <div className={styles.drawerResultsTitleText}>
              Checklist Results ({results.length} items, {pendingCount} pending)
            </div>

            {results.map((r) => (

              <div key={r.ID} className={styles.drawerResultRowItem}>

                <div className={styles.drawerCheckPointText}>
                  {r.CHECK_POINT}
                </div>

                {canFinalise ? (

                  <div className={styles.resultBtnsRowEl}>

                    {["PASS", "FAIL", "NEEDS_REWORK", "NA"].map((v) => {

                      const t = RESULT_THEMES[v];

                      const active = r.RESULT === v;

                      return (

                        <button
                          key={v}
                          onClick={() => mark(r.ID, v)}
                          style={{
                            border: active
                              ? `2px solid ${t.fg}`
                              : "1px solid #e2e8f0",
                            background: active ? t.bg : "white",
                            color: active ? t.fg : "#475569",
                            padding: "5px 12px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (

                  <Pill
                    themes={RESULT_THEMES}
                    value={r.RESULT}
                    label={RESULT_THEMES[r.RESULT]?.label}
                  />
                )}
              </div>
            ))}

            {canFinalise && (

              <div className={styles.drawerFinaliseWrapEl}>

                <button
                  onClick={finalise}
                  disabled={finalising || pendingCount > 0}
                  className={styles.btnFinaliseBase}
                  style={{
                    background: finalising || pendingCount > 0 ? "#94a3b8" : "#1e40af",
                    cursor: finalising || pendingCount > 0 ? "not-allowed" : "pointer"
                  }}
                >
                  {finalising
                    ? "Finalising…"
                    : pendingCount > 0
                      ? `Mark all ${pendingCount} pending items first`
                      : "Finalise Inspection (opens NCRs for any FAIL/REWORK)"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Inspections tab
// ----------------------------------------------------------------

function InspectionsTab() {

  const [inspections, setInspections] = useState([]);

  const [wos, setWOs] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const [createWO, setCreateWO] = useState("");

  const [createInspector, setCreateInspector] = useState("");

  const [selectedId, setSelectedId] = useState(null);

  // Inspector dropdown filter: only employees whose SKILLS column
  // includes a QA-relevant keyword. Mirrors the QC stage skill
  // keywords used by the project orchestrator's auto-assignment
  // (project_from_product_service.py STAGE_TYPE_SKILLS["QC"]).
  const QA_SKILL_KEYWORDS = [
    "quality check",
    "quality",
    "inspection",
    "qa",
    "rca"
  ];

  const qaEmployees = useMemo(() => {

    return employees.filter((emp) => {

      const skills = (emp.SKILLS || "").toLowerCase();

      if (!skills) return false;

      return QA_SKILL_KEYWORDS.some((kw) => skills.includes(kw));
    });

  }, [employees]);

  const fetchAll = async () => {

    setLoading(true);

    try {

      const [iRes, wRes, eRes] = await Promise.all([
        API.get("/quality/inspections", {
          params: {
            vendor_id: 1,
            ...(statusFilter ? { status: statusFilter } : {})
          }
        }),
        API.get("/production/work-orders", {
          params: { vendor_id: 1 }
        }),
        API.get("/employees").catch(() => ({ data: [] }))
      ]);

      setInspections(iRes.data || []);

      setWOs(wRes.data || []);

      setEmployees(eRes.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, [statusFilter]);

  const createInspection = async (e) => {

    e.preventDefault();

    if (!createWO) {

      alert("Pick a Work Order");

      return;
    }

    try {

      await API.post("/quality/inspections", {
        WORK_ORDER_ID: parseInt(createWO),
        INSPECTOR_ID: createInspector || null,
        VENDOR_ID: 1
      });

      setCreateWO("");

      setCreateInspector("");

      fetchAll();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed");
    }
  };

  return (

    <div>

      <form
        onSubmit={createInspection}
        className={styles.inspectionForm}
      >

        <div className={styles.formFieldWide}>

          <label className={styles.formLabelEl}>
            Work Order
          </label>

          <select
            value={createWO}
            onChange={(e) => setCreateWO(e.target.value)}
            className={styles.formSelectEl}
          >
            <option value="">Pick a work order…</option>
            {wos.map((w) => (
              <option key={w.ID} value={w.ID}>
                {w.WO_NUMBER} — {w.PRODUCT_MODEL_NAME} (×{w.QUANTITY}) [{w.STATUS}]
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formFieldNarrowEl}>

          <label className={styles.formLabelEl}>
            Inspector (optional)
          </label>

          <select
            value={createInspector}
            onChange={(e) => setCreateInspector(e.target.value)}
            className={styles.formSelectEl}
          >
            <option value="">— none —</option>
            {qaEmployees.length === 0 && (
              <option value="" disabled>
                No QA-skilled employees found
              </option>
            )}
            {qaEmployees.map((emp) => (
              <option key={emp.ID} value={emp.ID}>
                {emp.NAME} ({emp.EMPLOYEE_CODE})
              </option>
            ))}
          </select>

          <div className={styles.formHintEl}>
            Filtered to employees with QA / inspection skills.
          </div>
        </div>

        <button
          type="submit"
          className={styles.btnPrimary}
        >
          + Start Inspection
        </button>
      </form>

      <div className={styles.filterRowEl}>

        {["", "PENDING", "PASS", "FAIL", "REWORK"].map((s) => (

          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`${styles.filterBtn}${statusFilter === s ? ` ${styles.filterBtnActive}` : ""}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className={styles.tableCardWrap}>

        <div className={styles.tableScrollWrap}>

          <table className={styles.tableEl}>

            <thead>
              <tr className={styles.theadRow}>
                <th className={styles.thL}>#</th>
                <th className={styles.thL}>WO</th>
                <th className={styles.thL}>Model</th>
                <th className={styles.thL}>Inspector</th>
                <th className={styles.thL}>Date</th>
                <th className={styles.thC}>Pass</th>
                <th className={styles.thC}>Fail</th>
                <th className={styles.thL}>Status</th>
                <th className={styles.thR}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td colSpan="9" className={styles.tdEmptyEl}>
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && inspections.length === 0 && (

                <tr>
                  <td colSpan="9" className={styles.tdEmptyEl}>
                    No inspections. Start one above.
                  </td>
                </tr>
              )}

              {inspections.map((i) => (

                <tr key={i.ID} className={styles.tbodyRowEl}>

                  <td className={styles.tdMonoEl}>
                    #{i.ID}
                  </td>

                  <td className={styles.tdMonoEl}>
                    {i.WO_NUMBER || "—"}
                  </td>

                  <td className={styles.tdPadEl}>

                    <div className={styles.tdModelNameText}>
                      {i.MODEL_NAME || "—"}
                    </div>

                    <div className={styles.tdModelCodeText}>
                      {i.MODEL_CODE}
                    </div>
                  </td>

                  <td className={styles.tdPadEl}>
                    <span className={styles.tdInspectorText}>
                      {i.INSPECTOR_NAME || "—"}
                    </span>
                  </td>

                  <td className={styles.tdPadEl}>
                    <span className={styles.tdDateText}>
                      {i.INSPECTION_DATE}
                    </span>
                  </td>

                  <td className={styles.tdPassCount}>
                    {i.PASS_COUNT}
                  </td>

                  <td
                    className={styles.tdCenterEl}
                    style={{
                      color: i.FAIL_COUNT > 0 ? "#b91c1c" : "#94a3b8",
                      fontWeight: 700
                    }}
                  >
                    {i.FAIL_COUNT}
                  </td>

                  <td className={styles.tdPadEl}>
                    <Pill themes={STATUS_THEMES} value={i.STATUS} />
                  </td>

                  <td className={styles.tdRightEl}>

                    <button
                      onClick={() => setSelectedId(i.ID)}
                      className={styles.btnInspect}
                    >
                      {i.STATUS === "PENDING" ? "Inspect" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedId && (

        <InspectionDrawer
          inspectionId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={fetchAll}
        />
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// NCRs tab
// ----------------------------------------------------------------

function NCRsTab() {

  const [ncrs, setNcrs] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const fetchAll = async () => {

    setLoading(true);

    try {

      const res = await API.get("/quality/ncrs", {
        params: {
          vendor_id: 1,
          ...(statusFilter ? { status: statusFilter } : {})
        }
      });

      setNcrs(res.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, [statusFilter]);

  const advanceStatus = async (id, next) => {

    try {

      await API.patch(`/quality/ncrs/${id}`, { STATUS: next });

      fetchAll();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  return (

    <div>

      <div className={styles.filterRowEl}>

        {["", "OPEN", "IN_PROGRESS", "CLOSED"].map((s) => (

          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`${styles.filterBtn}${statusFilter === s ? ` ${styles.filterBtnActive}` : ""}`}
          >
            {s ? s.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>

      <div className={styles.tableCardWrap}>

        <div className={styles.tableScrollWrap}>

          <table className={styles.tableEl}>

            <thead>
              <tr className={styles.theadRow}>
                <th className={styles.thL}>NCR #</th>
                <th className={styles.thL}>Check Point</th>
                <th className={styles.thL}>Severity</th>
                <th className={styles.thL}>Status</th>
                <th className={styles.thL}>Opened</th>
                <th className={styles.thR}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td colSpan="6" className={styles.tdEmptyEl}>
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && ncrs.length === 0 && (

                <tr>
                  <td colSpan="6" className={styles.tdEmptyEl}>
                    No NCRs in this filter. NCRs auto-open when an
                    inspection finalises with FAIL/REWORK items.
                  </td>
                </tr>
              )}

              {ncrs.map((n) => {

                const nextStatus = {
                  OPEN: "IN_PROGRESS",
                  IN_PROGRESS: "CLOSED",
                  CLOSED: null
                }[n.STATUS];

                return (

                  <tr key={n.ID} className={styles.tbodyRowEl}>

                    <td className={styles.tdMonoEl}>
                      {n.NCR_NUMBER}
                    </td>

                    <td className={styles.tdNcrCheckpointCell}>

                      <div className={styles.tdNcrTitle}>
                        {n.CHECK_POINT}
                      </div>

                      {n.DESCRIPTION && (

                        <div className={styles.tdNcrDesc}>
                          {n.DESCRIPTION}
                        </div>
                      )}
                    </td>

                    <td className={styles.tdPadEl}>
                      <Pill
                        themes={SEVERITY_THEMES}
                        value={n.SEVERITY}
                      />
                    </td>

                    <td className={styles.tdPadEl}>
                      <Pill themes={STATUS_THEMES} value={n.STATUS} />
                    </td>

                    <td className={styles.tdPadEl}>
                      <span className={styles.tdDateText}>
                        {n.OPENED_AT?.slice(0, 10)}
                      </span>
                    </td>

                    <td className={styles.tdRightEl}>

                      {nextStatus ? (

                        <button
                          onClick={() => advanceStatus(n.ID, nextStatus)}
                          className={styles.btnAdvance}
                        >
                          → {nextStatus.replaceAll("_", " ")}
                        </button>
                      ) : (
                        <span className={styles.tdDashSpan}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

function Quality() {

  const [tab, setTab] = useState("dashboard");

  return (

    <div className={styles.page}>

      <div className={styles.pageHeaderWrap}>

        <h1 className={styles.pageTitle}>
          Quality Management
        </h1>

        <div className={styles.pageSubtitle}>
          Pre-dispatch checklists · Inspections · NCR tracking ·
          Work Order DONE gate
        </div>
      </div>

      <div className={styles.tabBar}>

        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "checklists", label: "Checklists" },
          { key: "inspections", label: "Inspections" },
          { key: "ncrs", label: "NCRs" }
        ].map((t) => (

          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`${styles.tabBtn}${tab === t.key ? ` ${styles.tabBtnActive}` : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}

      {tab === "checklists" && <ChecklistsTab />}

      {tab === "inspections" && <InspectionsTab />}

      {tab === "ncrs" && <NCRsTab />}
    </div>
  );
}


export default Quality;
