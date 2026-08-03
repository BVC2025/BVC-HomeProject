// =====================================================================
// WorkforceAnalytics — AI-powered HR insights dashboard.
//
// 5 widgets in one page (one HTTP roundtrip via /dashboard):
//   1. Attrition risk leaderboard
//   2. Burnout risk leaderboard
//   3. Performance trends (declining first)
//   4. Anomaly inbox
//   5. Department health grid
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import API from "../services/api";

const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BORDER   = "#e2e8f0";
const TEXT     = "#0f172a";
const MUTED    = "#64748b";

const TIER_COLOR = {
  HIGH:     "#dc2626",
  CRITICAL: "#dc2626",
  AT_RISK:  "#ea580c",
  MEDIUM:   "#d97706",
  WATCH:    "#d97706",
  STRETCHED:"#ca8a04",
  LOW:      "#0891b2",
  HEALTHY:  "#16a34a",
  MINIMAL:  "#94a3b8",
};

const TREND_COLOR = {
  IMPROVING:        "#16a34a",
  DECLINING:        "#dc2626",
  STABLE:           "#0891b2",
  INSUFFICIENT_DATA:"#94a3b8",
};


export default function WorkforceAnalytics() {

  const [bundle, setBundle] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [b, m] = await Promise.all([
        API.get("/employee-insights/dashboard"),
        API.get("/employee-insights/model-info"),
      ]);
      setBundle(b.data);
      setModelInfo(m.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load insights");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 18, color: TEXT, fontSize: 14 }}>
      <Hero onRefresh={load} loading={loading} />

      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca",
          color: "#991b1b", padding: 14, borderRadius: 10, marginTop: 14,
        }}>{error}</div>
      )}

      {modelInfo && <ModelBanner info={modelInfo} />}

      {bundle && (
        <>
          <SummaryTiles s={bundle.summary} />

          <TabBar tab={tab} setTab={setTab} bundle={bundle} />

          {tab === "overview"   && <OverviewPanel bundle={bundle} onSelect={setSelected} />}
          {tab === "attrition"  && <AttritionPanel rows={bundle.top_attrition_risk} onSelect={setSelected} />}
          {tab === "burnout"    && <BurnoutPanel rows={bundle.top_burnout_risk} onSelect={setSelected} />}
          {tab === "performance"&& <PerformancePanel rows={bundle.declining_trends} />}
          {tab === "anomalies"  && <AnomaliesPanel rows={bundle.anomalies} />}
          {tab === "departments"&& <DepartmentsPanel rows={bundle.departments} />}
        </>
      )}

      {selected && (
        <DetailDrawer kind={selected.kind} row={selected.row}
                      onClose={() => setSelected(null)} />
      )}
    </div>
  );
}


// =====================================================================
// Model banner — surfaces the ML algorithm + training metrics
// =====================================================================
function ModelBanner({ info }) {
  if (!info) return null;
  const cards = [
    { name: "Attrition",  m: info.attrition },
    { name: "Burnout",    m: info.burnout },
    { name: "Anomaly",    m: info.anomaly },
  ];
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: 12, marginTop: 14,
      display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch",
    }}>
      <div style={{
        background: "#0f172a", color: "white", padding: "8px 16px",
        borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: 1,
        display: "flex", alignItems: "center",
      }}>POWERED BY ML</div>
      {cards.map((c) => (
        <div key={c.name} style={{
          flex: "1 1 200px", padding: "8px 14px",
          background: "#f8fafc", borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 800,
                        letterSpacing: 1, textTransform: "uppercase" }}>
            {c.name}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, marginTop: 2 }}>
            {c.m?.algo || "—"}
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>
              {" "}· {c.m?.version || ""}
            </span>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            Trained on {c.m?.training_samples?.toLocaleString?.() ?? "—"} samples
            {c.m?.metrics?.roc_auc != null && (
              <> · ROC-AUC <b style={{ color: TEXT }}>{c.m.metrics.roc_auc}</b></>
            )}
            {c.m?.metrics?.accuracy != null && (
              <> · Acc <b style={{ color: TEXT }}>{c.m.metrics.accuracy}</b></>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


// =====================================================================
// Top hero
// =====================================================================
function Hero({ onRefresh, loading }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC_RED} 0%, ${BVC_DARK} 100%)`,
      color: "white", padding: "20px 24px", borderRadius: 14,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 14,
      boxShadow: "0 4px 14px rgba(139,11,31,0.18)",
    }}>
      <div>
        <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
          HR · AI WORKFORCE ANALYTICS
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
          Attrition · Burnout · Performance · Anomalies · Department Health
        </div>
        <div style={{ fontSize: 14, marginTop: 6, opacity: 0.9 }}>
          Predictive risk scoring driven by attendance, leave, OT, tasks and tenure signals
        </div>
      </div>
      <button onClick={onRefresh} disabled={loading} style={{
        padding: "12px 22px", background: "white",
        color: BVC_DARK, border: "none", borderRadius: 8,
        fontSize: 13, fontWeight: 800, letterSpacing: 0.6,
        cursor: loading ? "default" : "pointer", textTransform: "uppercase",
        opacity: loading ? 0.6 : 1,
      }}>{loading ? "Computing…" : "↻ Recompute now"}</button>
    </div>
  );
}


// =====================================================================
// Summary tiles
// =====================================================================
function SummaryTiles({ s }) {
  const tiles = [
    { k: "high_attrition_risk",  l: "High attrition risk", c: "#dc2626" },
    { k: "critical_burnout",     l: "Critical burnout",    c: "#dc2626" },
    { k: "declining_performers", l: "Declining performers",c: "#d97706" },
    { k: "anomalies_flagged",    l: "Anomalies flagged",   c: "#ca8a04" },
    { k: "healthy_departments",  l: "Healthy departments", c: "#16a34a" },
    { k: "total_employees",      l: "Total employees",     c: "#0f172a" },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
      gap: 10, marginTop: 14, marginBottom: 14,
    }}>
      {tiles.map((t) => (
        <div key={t.k} style={{
          background: "white", border: `1px solid ${BORDER}`,
          borderLeft: `4px solid ${t.c}`, borderRadius: 10, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, color: MUTED,
                        fontWeight: 700, textTransform: "uppercase" }}>
            {t.l}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: TEXT }}>
            {s?.[t.k] ?? 0}
          </div>
        </div>
      ))}
    </div>
  );
}


// =====================================================================
// Tab bar
// =====================================================================
function TabBar({ tab, setTab, bundle }) {
  const tabs = [
    { k: "overview",   l: "Overview" },
    { k: "attrition",  l: "Attrition Risk", n: bundle.top_attrition_risk?.length },
    { k: "burnout",    l: "Burnout",        n: bundle.top_burnout_risk?.length },
    { k: "performance",l: "Performance",    n: bundle.declining_trends?.length },
    { k: "anomalies",  l: "Anomalies",      n: bundle.anomalies?.length },
    { k: "departments",l: "Departments",    n: bundle.departments?.length },
  ];
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: 6, marginBottom: 14,
      display: "flex", gap: 4, overflowX: "auto",
    }}>
      {tabs.map((t) => (
        <button key={t.k} onClick={() => setTab(t.k)}
          style={{
            padding: "10px 16px", borderRadius: 8, border: "none",
            background: t.k === tab ? BVC_RED : "transparent",
            color: t.k === tab ? "white" : MUTED,
            fontSize: 13, fontWeight: 700, letterSpacing: 0.6,
            textTransform: "uppercase", cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t.l}
          {t.n != null && (
            <span style={{
              marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999,
              background: t.k === tab ? "rgba(255,255,255,0.25)" : "#f1f5f9",
              color: t.k === tab ? "white" : MUTED,
            }}>{t.n}</span>
          )}
        </button>
      ))}
    </div>
  );
}


// =====================================================================
// Overview panel (compact bird's eye)
// =====================================================================
function OverviewPanel({ bundle, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                  gap: 14, alignItems: "flex-start" }}>
      <Card title="Top 5 attrition risk">
        {bundle.top_attrition_risk.slice(0, 5).map((r) => (
          <MiniRow key={r.employee_id} name={r.employee_name}
            sub={`${r.department || "—"} · conf ${Math.round(r.confidence*100)}%`}
            badge={r.tier} score={r.score}
            color={TIER_COLOR[r.tier]}
            onClick={() => onSelect({ kind: "attrition", row: r })}
          />
        ))}
      </Card>
      <Card title="Top 5 burnout risk">
        {bundle.top_burnout_risk.slice(0, 5).map((r) => (
          <MiniRow key={r.employee_id} name={r.employee_name}
            sub={`OT ${r.overtime_hours_30d}h · leave used ${r.leave_utilisation_pct}%`}
            badge={r.tier} score={r.score}
            color={TIER_COLOR[r.tier]}
            onClick={() => onSelect({ kind: "burnout", row: r })}
          />
        ))}
      </Card>
      <Card title="Declining performers" wide>
        {(bundle.declining_trends || []).length === 0 && (
          <Empty msg="No declining performers detected." />
        )}
        {bundle.declining_trends.map((r) => (
          <MiniRow key={r.employee_id} name={r.employee_name}
            sub={r.summary} badge={r.trend} score={Math.round(r.current_score)}
            color={TREND_COLOR[r.trend]}
          />
        ))}
      </Card>
      <Card title="Department health">
        {bundle.departments.map((d) => (
          <div key={d.department_id} style={{
            padding: "10px 12px", borderBottom: "1px solid #f1f5f9",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{d.department_name}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{d.headcount} headcount</div>
              </div>
              <span style={pill(TIER_COLOR[d.tier])}>{d.tier}</span>
              <div style={{ fontSize: 22, fontWeight: 800,
                            color: TIER_COLOR[d.tier] }}>{d.health_score}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}


// =====================================================================
// Tab panels
// =====================================================================
function AttritionPanel({ rows, onSelect }) {
  if (!rows?.length) return <Empty msg="No attrition risk data." />;
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, overflow: "hidden" }}>
      {rows.map((r) => (
        <BigRow key={r.employee_id}
          onClick={() => onSelect({ kind: "attrition", row: r })}
          title={r.employee_name}
          subtitle={`${r.employee_code || ""} · ${r.department || "—"}`}
          score={r.score} tier={r.tier} color={TIER_COLOR[r.tier]}
          summary={r.recommended_action}
          extras={[
            { k: "Confidence", v: `${Math.round(r.confidence * 100)}%` },
            { k: "Triggered signals",
              v: r.signals.filter((s) => s.triggered).length },
          ]}
        />
      ))}
    </div>
  );
}

function BurnoutPanel({ rows, onSelect }) {
  if (!rows?.length) return <Empty msg="No burnout risk data." />;
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, overflow: "hidden" }}>
      {rows.map((r) => (
        <BigRow key={r.employee_id}
          onClick={() => onSelect({ kind: "burnout", row: r })}
          title={r.employee_name}
          subtitle={`${r.employee_code || ""} · ${r.department || "—"}`}
          score={r.score} tier={r.tier} color={TIER_COLOR[r.tier]}
          summary={r.recommended_action}
          extras={[
            { k: "OT (30d)", v: `${r.overtime_hours_30d}h` },
            { k: "Leave used", v: `${r.leave_utilisation_pct}%` },
            { k: "Weekend days", v: r.weekend_workdays_30d },
            { k: "Confidence", v: `${Math.round(r.confidence * 100)}%` },
          ]}
        />
      ))}
    </div>
  );
}

function PerformancePanel({ rows }) {
  if (!rows?.length) return <Empty msg="No declining performers." />;
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, overflow: "hidden" }}>
      {rows.map((r) => (
        <BigRow key={r.employee_id}
          title={r.employee_name} subtitle={r.summary}
          score={Math.round(r.current_score)}
          tier={r.trend} color={TREND_COLOR[r.trend]}
          summary={`Projected next month: ${r.projected_next_month}`}
          extras={[
            { k: "Slope", v: `${r.slope > 0 ? "+" : ""}${r.slope}/mo` },
            { k: "Confidence", v: `${Math.round(r.confidence * 100)}%` },
          ]}
        />
      ))}
    </div>
  );
}

function AnomaliesPanel({ rows }) {
  if (!rows?.length) return <Empty msg="No anomalies detected." />;
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, overflow: "hidden" }}>
      {rows.map((r) => (
        <div key={r.employee_id} style={{
          padding: "14px 18px", borderBottom: "1px solid #f8fafc",
          borderLeft: `4px solid #d97706`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {r.employee_name}
            <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>
              {" · "}{r.employee_code}
            </span>
          </div>
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {r.anomalies.map((a, i) => (
              <span key={i} style={{
                fontSize: 12, padding: "4px 10px", borderRadius: 999,
                background: "#fef3c7", color: "#92400e", fontWeight: 700,
              }}>
                {a.signal} z={a.z_score} ({a.verdict})
              </span>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: MUTED }}>
            {r.recommended_action}
          </div>
        </div>
      ))}
    </div>
  );
}

function DepartmentsPanel({ rows }) {
  if (!rows?.length) return <Empty msg="No departments to evaluate." />;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: 12,
    }}>
      {rows.map((d) => (
        <div key={d.department_id} style={{
          background: "white", border: `1px solid ${BORDER}`,
          borderLeft: `4px solid ${TIER_COLOR[d.tier]}`,
          borderRadius: 12, padding: 14,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{d.department_name}</div>
              <div style={{ fontSize: 12, color: MUTED }}>
                {d.headcount} employees
              </div>
            </div>
            <span style={pill(TIER_COLOR[d.tier])}>{d.tier}</span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800,
                        color: TIER_COLOR[d.tier], marginBottom: 8 }}>
            {d.health_score}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>
            Avg attrition risk: <b>{d.avg_attrition_risk}</b><br />
            Avg burnout risk: <b>{d.avg_burnout_risk}</b><br />
            Declining performers: <b>{d.declining_performers}</b>
          </div>
          {d.top_drivers?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: TEXT }}>
              {d.top_drivers.map((dv, i) => (
                <div key={i} style={{
                  padding: "4px 10px", marginTop: 4,
                  background: "#fafbfc", borderRadius: 4,
                }}>{dv}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// =====================================================================
// Detail drawer (click an Attrition or Burnout row to drill in)
// =====================================================================
function DetailDrawer({ kind, row, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      backdropFilter: "blur(2px)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 640,
        maxHeight: "90dvh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 20px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 700, opacity: 0.85 }}>
              {kind === "attrition" ? "ATTRITION RISK" : "BURNOUT RISK"} · DRILL DOWN
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{row.employee_name}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              {row.employee_code} · {row.department || "—"}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.18)", color: "white", border: "none",
            padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 800,
            cursor: "pointer",
          }}>×  Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          <div style={{
            background: BVC_RED, color: "white", borderRadius: 10,
            padding: "16px 20px", marginBottom: 14,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.9, fontWeight: 700 }}>
                {kind === "attrition" ? "ATTRITION SCORE" : "BURNOUT SCORE"}
              </div>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{row.score}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.9, fontWeight: 700 }}>
                TIER
              </div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{row.tier}</div>
            </div>
          </div>

          <SectionLabel>Recommended action</SectionLabel>
          <div style={{
            fontSize: 14, padding: "10px 14px",
            background: "#fef2f4", borderLeft: `3px solid ${BVC_RED}`,
            borderRadius: 4, marginBottom: 14, lineHeight: 1.55,
          }}>{row.recommended_action}</div>

          <SectionLabel>Signals contributing to the score</SectionLabel>
          {row.signals?.map((s, i) => (
            <div key={i} style={{
              padding: "8px 12px", borderBottom: "1px solid #f8fafc",
              display: "flex", alignItems: "center", gap: 10,
              opacity: s.triggered ? 1 : 0.45,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: 4,
                background: s.triggered ? "#dc2626" : "#cbd5e1",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {s.name.replace(/_/g, " ")}
                </div>
                <div style={{ fontSize: 12, color: MUTED }}>{s.explanation}</div>
              </div>
              <span style={{ fontSize: 11, color: MUTED,
                             background: "#f1f5f9", padding: "2px 8px",
                             borderRadius: 6 }}>
                weight {s.weight}
              </span>
            </div>
          ))}

          <SectionLabel>Confidence</SectionLabel>
          <div style={{ fontSize: 14, padding: "8px 12px",
                        background: "#fafbfc", borderRadius: 6 }}>
            {Math.round(row.confidence * 100)}% — based on alignment of multiple signals.
            More triggered signals → higher confidence.
          </div>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Atoms
// =====================================================================
function Card({ title, children, wide }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: 6,
      gridColumn: wide ? "1 / -1" : undefined,
    }}>
      <div style={{
        padding: "10px 14px", fontSize: 13, fontWeight: 800,
        letterSpacing: 1, color: MUTED, textTransform: "uppercase",
      }}>{title}</div>
      {children}
    </div>
  );
}

function MiniRow({ name, sub, badge, score, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
      cursor: onClick ? "pointer" : "default",
      borderTop: "1px solid #f8fafc",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{name}</div>
        <div style={{ fontSize: 12, color: MUTED }}>{sub}</div>
      </div>
      <span style={pill(color)}>{badge}</span>
      <div style={{ fontSize: 20, fontWeight: 800, color, minWidth: 36, textAlign: "right" }}>
        {score}
      </div>
    </div>
  );
}

function BigRow({ title, subtitle, score, tier, color, summary, extras, onClick }) {
  return (
    <div onClick={onClick} style={{
      padding: "16px 20px", borderBottom: "1px solid #f8fafc",
      borderLeft: `4px solid ${color}`,
      cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 14, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color }}>{score}</div>
          <span style={pill(color)}>{tier}</span>
        </div>
      </div>
      <div style={{ fontSize: 14, padding: "8px 12px",
                    background: "#fafbfc", borderRadius: 6, marginBottom: 8 }}>
        {summary}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {extras?.map((e, i) => (
          <span key={i} style={{
            fontSize: 12, padding: "4px 10px", borderRadius: 6,
            background: "#f1f5f9",
          }}>
            <b style={{ color: TEXT }}>{e.k}:</b> {e.v}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 800, letterSpacing: 1, color: MUTED,
      textTransform: "uppercase", marginTop: 12, marginBottom: 6,
    }}>{children}</div>
  );
}

function Empty({ msg }) {
  return (
    <div style={{
      padding: 22, textAlign: "center", color: MUTED, fontStyle: "italic",
      fontSize: 14, background: "white", border: `1px solid ${BORDER}`,
      borderRadius: 12,
    }}>{msg}</div>
  );
}

function pill(color) {
  return {
    fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999,
    background: color + "1a", color, letterSpacing: 0.6,
  };
}
