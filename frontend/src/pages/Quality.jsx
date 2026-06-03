import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


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
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: t.bg,
        color: t.fg
      }}
    >
      {label || value?.replaceAll("_", " ")}
    </span>
  );
}


function Tile({ label, value, sub, color }) {

  return (

    <div
      style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${color}`
      }}
    >

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#64748b",
          textTransform: "uppercase"
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 6
        }}
      >
        {value}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            marginTop: 2
          }}
        >
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

  if (loading) return <div style={{ color: "#94a3b8" }}>Loading…</div>;

  if (!data) return <div style={{ color: "#b91c1c" }}>Failed to load.</div>;

  return (

    <div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 20
        }}
      >

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

      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#475569",
            textTransform: "uppercase",
            marginBottom: 14
          }}
        >
          Inspections by Status
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>

          {Object.entries(data.by_status || {}).map(([status, count]) => (

            <div
              key={status}
              style={{
                flex: 1,
                minWidth: 140,
                padding: 14,
                borderRadius: 10,
                background:
                  (STATUS_THEMES[status] || {}).bg || "#f1f5f9"
              }}
            >

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: (STATUS_THEMES[status] || {}).fg || "#475569"
                }}
              >
                {status}
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: (STATUS_THEMES[status] || {}).fg || "#0f172a",
                  marginTop: 4
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

    <div style={{ display: "flex", gap: 16 }}>

      {/* Model list */}
      <div
        style={{
          width: 280,
          background: "white",
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          height: "fit-content"
        }}
      >

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: 1,
            padding: "8px 10px 10px"
          }}
        >
          Machine Models
        </div>

        {models.map((m) => (

          <button
            key={m.ID}
            onClick={() => setSelectedId(m.ID)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background:
                selectedId === m.ID ? "#eff6ff" : "transparent",
              padding: "10px 12px",
              borderRadius: 8,
              cursor: "pointer",
              marginBottom: 4
            }}
          >

            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: selectedId === m.ID ? "#1e40af" : "#0f172a"
              }}
            >
              {m.MODEL_NAME}
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                fontFamily: "ui-monospace, monospace",
                marginTop: 2
              }}
            >
              {m.MODEL_CODE}
            </div>
          </button>
        ))}
      </div>

      {/* Checklist items */}
      <div
        style={{
          flex: 1,
          background: "white",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 12
          }}
        >
          Pre-Dispatch Checklist ({items.length} items)
        </div>

        {loadingItems && (
          <div style={{ color: "#94a3b8" }}>Loading…</div>
        )}

        {!loadingItems && items.length === 0 && (

          <div style={{ color: "#94a3b8", padding: 20 }}>
            No checklist items for this model. Re-run{" "}
            <code>/demo/seed-bvc24</code> to populate.
          </div>
        )}

        {items.map((it) => (

          <div
            key={it.ID}
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              alignItems: "flex-start",
              gap: 12
            }}
          >

            <div
              style={{
                fontSize: 12,
                color: "#94a3b8",
                fontFamily: "ui-monospace, monospace",
                minWidth: 24,
                marginTop: 2
              }}
            >
              {it.SEQUENCE}.
            </div>

            <div style={{ flex: 1 }}>

              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0f172a"
                }}
              >
                {it.CHECK_POINT}
              </div>

              {it.DESCRIPTION && (

                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    marginTop: 4,
                    lineHeight: 1.5
                  }}
                >
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 900
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxWidth: "100%",
          background: "white",
          padding: 24,
          overflow: "auto",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.3)"
        }}
      >

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18
          }}
        >

          <div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#0f172a"
              }}
            >
              Inspection #{insp?.ID}
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#64748b",
                marginTop: 2
              }}
            >
              {insp?.WO_NUMBER}
              {" · "}
              {insp?.MODEL_NAME}
              {" · "}
              by {insp?.INSPECTOR_NAME || "—"}
            </div>

            <div style={{ marginTop: 8 }}>
              <Pill themes={STATUS_THEMES} value={insp?.STATUS} />
            </div>
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

        {loading && <div style={{ color: "#94a3b8" }}>Loading…</div>}

        {!loading && (

          <>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#475569",
                textTransform: "uppercase",
                marginBottom: 10
              }}
            >
              Checklist Results ({results.length} items, {pendingCount} pending)
            </div>

            {results.map((r) => (

              <div
                key={r.ID}
                style={{
                  padding: "14px 0",
                  borderBottom: "1px solid #f1f5f9"
                }}
              >

                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#0f172a",
                    marginBottom: 8
                  }}
                >
                  {r.CHECK_POINT}
                </div>

                {canFinalise ? (

                  <div style={{ display: "flex", gap: 6 }}>

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

              <div style={{ marginTop: 24 }}>

                <button
                  onClick={finalise}
                  disabled={finalising || pendingCount > 0}
                  style={{
                    width: "100%",
                    border: "none",
                    background:
                      finalising || pendingCount > 0
                        ? "#94a3b8"
                        : "#1e40af",
                    color: "white",
                    padding: "12px 18px",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor:
                      finalising || pendingCount > 0
                        ? "not-allowed"
                        : "pointer",
                    fontSize: 14
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
        style={{
          background: "white",
          padding: 14,
          borderRadius: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 14
        }}
      >

        <div style={{ flex: 2, minWidth: 220 }}>

          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "block",
              marginBottom: 4
            }}
          >
            Work Order
          </label>

          <select
            value={createWO}
            onChange={(e) => setCreateWO(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13
            }}
          >
            <option value="">Pick a work order…</option>
            {wos.map((w) => (
              <option key={w.ID} value={w.ID}>
                {w.WO_NUMBER} — {w.PRODUCT_MODEL_NAME} (×{w.QUANTITY}) [{w.STATUS}]
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 180 }}>

          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "block",
              marginBottom: 4
            }}
          >
            Inspector (optional)
          </label>

          <select
            value={createInspector}
            onChange={(e) => setCreateInspector(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13
            }}
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

          <div
            style={{
              fontSize: 10,
              color: "#94a3b8",
              marginTop: 4
            }}
          >
            Filtered to employees with QA / inspection skills.
          </div>
        </div>

        <button
          type="submit"
          style={{
            border: "none",
            background: "#1e40af",
            color: "white",
            padding: "9px 18px",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
            fontSize: 13
          }}
        >
          + Start Inspection
        </button>
      </form>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap"
        }}
      >

        {["", "PENDING", "PASS", "FAIL", "REWORK"].map((s) => (

          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            style={{
              border: "1px solid #e2e8f0",
              background: statusFilter === s ? "#1e40af" : "white",
              color: statusFilter === s ? "white" : "#475569",
              padding: "6px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600
            }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div style={{ overflow: "auto" }}>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >

            <thead>
              <tr
                style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: "uppercase"
                }}
              >
                <th style={{ textAlign: "left", padding: 12 }}>#</th>
                <th style={{ textAlign: "left", padding: 12 }}>WO</th>
                <th style={{ textAlign: "left", padding: 12 }}>Model</th>
                <th style={{ textAlign: "left", padding: 12 }}>Inspector</th>
                <th style={{ textAlign: "left", padding: 12 }}>Date</th>
                <th style={{ textAlign: "center", padding: 12 }}>Pass</th>
                <th style={{ textAlign: "center", padding: 12 }}>Fail</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "right", padding: 12 }}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td
                    colSpan="9"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && inspections.length === 0 && (

                <tr>
                  <td
                    colSpan="9"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    No inspections. Start one above.
                  </td>
                </tr>
              )}

              {inspections.map((i) => (

                <tr
                  key={i.ID}
                  style={{ borderBottom: "1px solid #f1f5f9" }}
                >

                  <td
                    style={{
                      padding: 12,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12
                    }}
                  >
                    #{i.ID}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12
                    }}
                  >
                    {i.WO_NUMBER || "—"}
                  </td>

                  <td style={{ padding: 12 }}>

                    <div style={{ fontWeight: 600 }}>
                      {i.MODEL_NAME || "—"}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: "#94a3b8"
                      }}
                    >
                      {i.MODEL_CODE}
                    </div>
                  </td>

                  <td
                    style={{ padding: 12, color: "#475569" }}
                  >
                    {i.INSPECTOR_NAME || "—"}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      color: "#94a3b8",
                      fontSize: 12
                    }}
                  >
                    {i.INSPECTION_DATE}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      textAlign: "center",
                      color: "#166534",
                      fontWeight: 700
                    }}
                  >
                    {i.PASS_COUNT}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      textAlign: "center",
                      color: i.FAIL_COUNT > 0 ? "#b91c1c" : "#94a3b8",
                      fontWeight: 700
                    }}
                  >
                    {i.FAIL_COUNT}
                  </td>

                  <td style={{ padding: 12 }}>
                    <Pill themes={STATUS_THEMES} value={i.STATUS} />
                  </td>

                  <td
                    style={{ padding: 12, textAlign: "right" }}
                  >

                    <button
                      onClick={() => setSelectedId(i.ID)}
                      style={{
                        border: "1px solid #e2e8f0",
                        background: "white",
                        padding: "5px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        color: "#1e40af",
                        fontWeight: 600
                      }}
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

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap"
        }}
      >

        {["", "OPEN", "IN_PROGRESS", "CLOSED"].map((s) => (

          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            style={{
              border: "1px solid #e2e8f0",
              background: statusFilter === s ? "#1e40af" : "white",
              color: statusFilter === s ? "white" : "#475569",
              padding: "6px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600
            }}
          >
            {s ? s.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div style={{ overflow: "auto" }}>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >

            <thead>
              <tr
                style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: "uppercase"
                }}
              >
                <th style={{ textAlign: "left", padding: 12 }}>NCR #</th>
                <th style={{ textAlign: "left", padding: 12 }}>Check Point</th>
                <th style={{ textAlign: "left", padding: 12 }}>Severity</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "left", padding: 12 }}>Opened</th>
                <th style={{ textAlign: "right", padding: 12 }}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td
                    colSpan="6"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && ncrs.length === 0 && (

                <tr>
                  <td
                    colSpan="6"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
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

                  <tr
                    key={n.ID}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >

                    <td
                      style={{
                        padding: 12,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12
                      }}
                    >
                      {n.NCR_NUMBER}
                    </td>

                    <td style={{ padding: 12, maxWidth: 360 }}>

                      <div
                        style={{ fontWeight: 600, color: "#0f172a" }}
                      >
                        {n.CHECK_POINT}
                      </div>

                      {n.DESCRIPTION && (

                        <div
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            marginTop: 2,
                            maxWidth: 360,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {n.DESCRIPTION}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: 12 }}>
                      <Pill
                        themes={SEVERITY_THEMES}
                        value={n.SEVERITY}
                      />
                    </td>

                    <td style={{ padding: 12 }}>
                      <Pill themes={STATUS_THEMES} value={n.STATUS} />
                    </td>

                    <td
                      style={{
                        padding: 12,
                        color: "#94a3b8",
                        fontSize: 12
                      }}
                    >
                      {n.OPENED_AT?.slice(0, 10)}
                    </td>

                    <td
                      style={{ padding: 12, textAlign: "right" }}
                    >

                      {nextStatus ? (

                        <button
                          onClick={() => advanceStatus(n.ID, nextStatus)}
                          style={{
                            border: "none",
                            background: "#1e40af",
                            color: "white",
                            padding: "5px 12px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          → {nextStatus.replaceAll("_", " ")}
                        </button>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>—</span>
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

    <div
      style={{
        padding: 24,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <div style={{ marginBottom: 20 }}>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            margin: 0
          }}
        >
          Quality Management
        </h1>

        <div
          style={{
            fontSize: 13,
            color: "#64748b",
            marginTop: 4
          }}
        >
          Pre-dispatch checklists · Inspections · NCR tracking ·
          Work Order DONE gate
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid #e2e8f0"
        }}
      >

        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "checklists", label: "Checklists" },
          { key: "inspections", label: "Inspections" },
          { key: "ncrs", label: "NCRs" }
        ].map((t) => (

          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: "none",
              background: "transparent",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: tab === t.key ? "#1e40af" : "#64748b",
              cursor: "pointer",
              borderBottom:
                tab === t.key
                  ? "3px solid #1e40af"
                  : "3px solid transparent",
              marginBottom: -1
            }}
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
