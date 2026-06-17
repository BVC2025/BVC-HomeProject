import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";


// ===================================================================
// Projects — fully redesigned around the new BVC24 workflow.
//
//     Product → Project → Customer → Task Assignment
//                       → Employee Approval → Employee Dashboard
//
// You can no longer create a blank project. Every project is now
// instantiated from a Product (Machine Model) for a specific
// Customer. The product's BOM + process stages flow into the
// project as tasks, each one auto-assigned to the best-skill
// employee by the backend. Employees get email notifications and
// the tasks wait in PENDING_APPROVAL until they accept them from
// their dashboard.
// ===================================================================


const PRIORITY_THEMES = {
  HIGH: { bg: "#fee2e2", fg: "#b91c1c", grad: "linear-gradient(135deg,#ef4444,#b91c1c)" },
  MEDIUM: { bg: "#fef3c7", fg: "#854d0e", grad: "linear-gradient(135deg,#F4B324,#C8102E)" },
  LOW: { bg: "#dbeafe", fg: "#1e40af", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" }
};


const STATUS_THEMES = {
  ACTIVE: { bg: "#dcfce7", fg: "#166534" },
  IN_PROGRESS: { bg: "#fef3c7", fg: "#854d0e" },
  PENDING: { bg: "#f1f5f9", fg: "#475569" },
  ON_HOLD: { bg: "#fce7f3", fg: "#9d174d" },
  COMPLETED: { bg: "#dbeafe", fg: "#1e40af" },
  CANCELLED: { bg: "#fee2e2", fg: "#b91c1c" }
};


function StatTile({ label, value, sub, color, icon }) {

  return (

    <div
      style={{
        background: "white",
        padding: "18px 20px",
        borderRadius: 14,
        boxShadow: "0 6px 20px rgba(15,23,42,0.07)",
        borderTop: `3px solid ${color}`,
        position: "relative",
        overflow: "hidden"
      }}
    >
      {icon && (
        <div style={{ position: "absolute", top: 14, right: 14, fontSize: 22, opacity: 0.85 }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#64748b", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", marginTop: 4, letterSpacing: -0.5 }}>
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


function Pill({ children, bg, fg }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 700,
      background: bg,
      color: fg,
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }}>
      {children}
    </span>
  );
}


// =================================================================
// Project card
// =================================================================

function ProjectCard({ project, onOpen, onDelete }) {

  const prio = (project.PRIORITY || "MEDIUM").toUpperCase();

  const prioTheme = PRIORITY_THEMES[prio] || PRIORITY_THEMES.MEDIUM;

  // Use the backend-computed effective status. It's "DONE" if any
  // of the project's Work Orders is marked DONE in Production &
  // BOM — no manual marking needed at the project level.
  const status = (
    project.effective_status || project.STATUS || "PENDING"
  ).toUpperCase();

  const statusTheme = STATUS_THEMES[status] || STATUS_THEMES.PENDING;

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {

    e.stopPropagation();

    const ok = window.confirm(
      `Delete project "${project.PROJECT_NAME}"?\n\n` +
      `Tasks, work orders and daily allocations will be unlinked ` +
      `(not deleted) so history is preserved.`
    );

    if (!ok) return;

    setDeleting(true);

    try {

      await API.delete(`/delete-project/${project.ID}`);

      onDelete?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Delete failed");

    } finally {

      setDeleting(false);
    }
  };

  return (

    <div
      onClick={() => onOpen(project)}
      className="bvc-proj-card"
      style={{
        background: "white",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 10px 30px rgba(15,23,42,0.07)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        animation: "bvcProjFadeIn 0.4s ease-out both"
      }}
    >
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: prioTheme.grad
      }} />

      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete project"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #fecaca",
          background: deleting ? "#f1f5f9" : "#fef2f2",
          color: deleting ? "#94a3b8" : "#b91c1c",
          cursor: deleting ? "default" : "pointer",
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 5
        }}
      >
        {deleting ? "…" : "×"}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, paddingRight: 32 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15,
            fontWeight: 800,
            color: "#0f172a",
            lineHeight: 1.25,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}>
            {project.PROJECT_NAME}
          </div>
        </div>
        <Pill bg={prioTheme.bg} fg={prioTheme.fg}>{prio}</Pill>
      </div>

      {/* Customer + Product chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {project.CUSTOMER_NAME && (
          <span style={{ fontSize: 11, padding: "3px 10px", background: "#ecfeff", color: "#0e7490", borderRadius: 999, fontWeight: 600 }}>
            🤝 {project.CUSTOMER_NAME}
          </span>
        )}
        {project.PRODUCT_MODEL_NAME && (
          <span style={{ fontSize: 11, padding: "3px 10px", background: "#eff6ff", color: "#1e40af", borderRadius: 999, fontWeight: 600 }}>
            🏭 {project.PRODUCT_MODEL_NAME}
          </span>
        )}
        {project.QUANTITY > 0 && (
          <span style={{ fontSize: 11, padding: "3px 10px", background: "#f3e8ff", color: "#6d28d9", borderRadius: 999, fontWeight: 600 }}>
            × {project.QUANTITY} unit{project.QUANTITY > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {project.SKILLS_REQUIRED && (
        <div style={{
          fontSize: 11,
          color: "#64748b",
          background: "#f8fafc",
          padding: "8px 10px",
          borderRadius: 8,
          marginBottom: 10,
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden"
        }}>
          🧠 Skills: {project.SKILLS_REQUIRED}
        </div>
      )}

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <Pill bg={statusTheme.bg} fg={statusTheme.fg}>
          {status.replaceAll("_", " ")}
        </Pill>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          Click for 360°
        </div>
      </div>
    </div>
  );
}


// =================================================================
// Create-from-Product modal
// =================================================================

function CreateFromProductModal({ onClose, onCreated }) {

  const [customers, setCustomers] = useState([]);

  const [products, setProducts] = useState([]);

  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState("");

  const [productId, setProductId] = useState("");

  const [quantity, setQuantity] = useState(1);

  const [priority, setPriority] = useState("MEDIUM");

  const [targetDate, setTargetDate] = useState("");

  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  useEffect(() => {

    Promise.all([
      API.get("/customers").catch(() => ({ data: [] })),
      API.get("/production/models?vendor_id=1").catch(() => ({ data: [] }))
    ]).then(([c, p]) => {

      setCustomers(c.data || []);

      setProducts(p.data || []);

      setLoading(false);
    });
  }, []);

  const selectedProduct = products.find((p) => String(p.ID) === String(productId));

  const selectedCustomer = customers.find((c) => String(c.ID) === String(customerId));

  const submit = async (e) => {

    e?.preventDefault?.();

    if (!customerId) { setError("Pick a customer"); return; }

    if (!productId) { setError("Pick a product"); return; }

    setError("");

    setSubmitting(true);

    setResult(null);

    try {

      const res = await API.post("/projects/from-product", {
        CUSTOMER_ID: parseInt(customerId),
        PRODUCT_MODEL_ID: parseInt(productId),
        QUANTITY: parseInt(quantity) || 1,
        PRIORITY: priority,
        TARGET_DATE: targetDate || null,
        NOTES: notes || null,
        VENDOR_ID: 1
      });

      setResult(res.data);

      onCreated?.();

    } catch (err) {

      setError(err?.response?.data?.detail || "Failed to create project");

    } finally {

      setSubmitting(false);
    }
  };

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
          width: 720,
          maxWidth: "94%",
          background: "white",
          overflow: "auto",
          padding: 26,
          boxShadow: "-24px 0 60px rgba(0,0,0,0.35)"
        }}
      >

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          paddingBottom: 14,
          borderBottom: "1px solid #e2e8f0"
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#6366f1", textTransform: "uppercase" }}>
              New Project · Product → Project Workflow
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
              Create a project from an existing product
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
              The product's BOM + manufacturing stages will auto-flow into the project.
              Each stage becomes a task, assigned to the best-skill employee, and they'll get an
              email asking them to accept it.
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
              fontSize: 20
            }}
          >
            ×
          </button>
        </div>

        {!result && (

          <form onSubmit={submit}>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#0e7490", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                  🤝 Customer *
                </label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={loading}
                  style={inputStyle()}
                >
                  <option value="">— pick customer —</option>
                  {customers.map((c) => (
                    <option key={c.ID} value={c.ID}>
                      {c.CUSTOMER_CODE ? `${c.CUSTOMER_CODE} · ` : ""}{c.CUSTOMER_NAME}
                    </option>
                  ))}
                </select>
                {selectedCustomer && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    📞 {selectedCustomer.PHONE || "—"} · {selectedCustomer.CITY || "—"}
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                  🏭 Product (Machine Model) *
                </label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  disabled={loading}
                  style={inputStyle()}
                >
                  <option value="">— pick product —</option>
                  {products.map((p) => (
                    <option key={p.ID} value={p.ID}>
                      {p.MODEL_CODE} — {p.MODEL_NAME}
                    </option>
                  ))}
                </select>
                {selectedProduct && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    {selectedProduct.CATEGORY} · {selectedProduct.ESTIMATED_BUILD_DAYS}d build
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                  Quantity *
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={inputStyle()}
                >
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                  Target Date
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  style={inputStyle()}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.5, display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ ...inputStyle(), resize: "vertical" }}
                placeholder="Any special instructions for this order..."
              />
            </div>

            <div style={{
              padding: 12,
              background: "linear-gradient(135deg, #fef2f2 0%, #fff4e6 100%)",
              border: "1px solid #c7d2fe",
              borderRadius: 10,
              marginBottom: 16,
              fontSize: 12,
              color: "#4338ca",
              lineHeight: 1.6
            }}>
              <strong>✨ What happens when you click Create:</strong>
              <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                <li>Project is created, inheriting the product's category + skills</li>
                <li>A Work Order spawns with all 10 manufacturing stages</li>
                <li>Each stage becomes a task auto-assigned by skill match</li>
                <li>Each employee gets an email asking to accept their tasks</li>
                <li>Tasks appear in their dashboards only after acceptance</li>
              </ol>
            </div>

            {error && (
              <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: "1px solid #e2e8f0",
                  background: "white",
                  padding: "10px 22px",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  border: "none",
                  background: submitting ? "#94a3b8" : "linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899)",
                  color: "white",
                  padding: "10px 26px",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: submitting ? "not-allowed" : "pointer",
                  boxShadow: "0 6px 18px rgba(139,92,246,0.45)"
                }}
              >
                {submitting ? "Creating…" : "✨ Create Project + Assign Tasks"}
              </button>
            </div>
          </form>
        )}

        {result && <CreateResult result={result} onClose={onClose} />}
      </div>
    </div>
  );
}


function CreateResult({ result, onClose }) {

  return (

    <div>

      <div style={{
        background: "linear-gradient(135deg, #dcfce7, #d1fae5)",
        border: "1px solid #a7f3d0",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#166534", marginBottom: 4 }}>
          ✓ Project created!
        </div>
        <div style={{ fontSize: 13, color: "#166534" }}>
          {result.message}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 16
      }}>
        <StatTile label="Tasks" value={result.tasks_generated} color="#6366f1" />
        <StatTile label="Employees" value={result.employees_assigned} color="#10b981" sub="auto-assigned" />
        <StatTile label="Emails Sent" value={result.emails_sent?.sent ?? 0} color="#f59e0b" sub={result.emails_sent?.failed ? `${result.emails_sent.failed} failed` : ""} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Task assignments (PENDING acceptance)
      </div>

      <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
        {result.tasks?.map((t) => (
          <div key={t.task_id} style={{
            padding: "10px 14px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                {t.stage_name}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {t.stage_type} · → {t.assigned_employee_name || "Unassigned"}
                {t.assigned_employee_code && (
                  <span style={{ marginLeft: 4, fontFamily: "ui-monospace, monospace" }}>({t.assigned_employee_code})</span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <Pill bg="#fef3c7" fg="#854d0e">{t.approval_status}</Pill>
              {t.skill_match_score > 0 && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                  {Math.round(t.skill_match_score * 100)}% match
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button
          onClick={onClose}
          style={{
            border: "none",
            background: "#1e40af",
            color: "white",
            padding: "10px 24px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer"
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}


function inputStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white"
  };
}


// =================================================================
// Main page
// =================================================================

function Projects() {

  const [projects, setProjects] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [priorityFilter, setPriorityFilter] = useState("");

  const [showCreate, setShowCreate] = useState(false);

  const [drawerId, setDrawerId] = useState(null);

  const fetchAll = async () => {

    setLoading(true);

    try {

      // Use the snapshot endpoint we have, or fall back to a direct query.
      // Existing /projects endpoint returns the project rows.
      const res = await API.get("/projects?vendor_id=1").catch(async () => {

        // older route name
        return await API.get("/projects");
      });

      // Enrich with customer + product names via a separate fetch
      const [custRes, prodRes] = await Promise.all([
        API.get("/customers").catch(() => ({ data: [] })),
        API.get("/production/models?vendor_id=1").catch(() => ({ data: [] }))
      ]);

      const custMap = Object.fromEntries(
        (custRes.data || []).map((c) => [c.ID, c.CUSTOMER_NAME])
      );

      const prodMap = Object.fromEntries(
        (prodRes.data || []).map((p) => [p.ID, p.MODEL_NAME])
      );

      const enriched = (res.data || []).map((p) => ({
        ...p,
        CUSTOMER_NAME: p.CUSTOMER_NAME || custMap[p.CUSTOMER_ID] || null,
        PRODUCT_MODEL_NAME: prodMap[p.PRODUCT_MODEL_ID] || null
      }));

      setProjects(enriched);

    } catch (e) {

      setProjects([]);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, []);

  const filtered = useMemo(() => {

    const q = search.trim().toLowerCase();

    return projects.filter((p) => {

      if (statusFilter && p.STATUS !== statusFilter) return false;

      if (priorityFilter && p.PRIORITY !== priorityFilter) return false;

      if (q) {

        const hay = [
          p.PROJECT_NAME, p.DESCRIPTION, p.SKILLS_REQUIRED,
          p.CUSTOMER_NAME, p.PRODUCT_MODEL_NAME
        ].filter(Boolean).join(" ").toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    });

  }, [projects, search, statusFilter, priorityFilter]);

  // Use the backend-computed effective_status when available so a
  // project flips to "DONE" automatically once any of its Work
  // Orders is marked DONE in Production & BOM — no manual project
  // status toggle needed.
  const isProjectDone = (p) => {

    const eff = (p.effective_status || p.STATUS || "").toUpperCase();

    return eff === "DONE" || eff === "COMPLETED";
  };

  const stats = useMemo(() => {

    const total = projects.length;

    const completed = projects.filter(isProjectDone).length;

    const active = projects.filter((p) =>
      !isProjectDone(p)
      && ["ACTIVE", "IN_PROGRESS", "PENDING"].includes(
        (p.effective_status || p.STATUS || "").toUpperCase()
      )
    ).length;

    const fromProduct = projects.filter((p) => !!p.PRODUCT_MODEL_ID).length;

    const totalUnits = projects.reduce((s, p) => s + (p.QUANTITY || 0), 0);

    return { total, active, completed, fromProduct, totalUnits };

  }, [projects]);

  // Split filtered list into Active vs Done by effective_status
  // (driven by Work Order status — see backend /projects endpoint).
  const [showDone, setShowDone] = useState(true);

  const { activeProjects, doneProjects } = useMemo(() => {

    const done = filtered.filter(isProjectDone);

    const active = filtered.filter((p) => !isProjectDone(p));

    return { activeProjects: active, doneProjects: done };

  }, [filtered]);

  return (

    <div style={{ padding: 26, background: "#f1f5f9", minHeight: "100%" }}>

      <style>{`
        @keyframes bvcProjFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bvcProjHeroShift {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
        .bvc-proj-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 42px rgba(15,23,42,0.14);
        }
        .bvc-proj-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
      `}</style>

      {/* HERO */}
      <div style={{
        background: "linear-gradient(135deg, #C8102E 0%, #A60F26 50%, #8B0B1F 100%)",
        color: "white",
        padding: "20px 28px",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 6px 18px rgba(139,11,31,0.18)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "#fde047",
            fontWeight: 700,
            textTransform: "uppercase"
          }}>
            Workflow
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Projects
          </h1>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>

          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: "white",
              color: "#8B0B1F",
              border: "none",
              padding: "10px 20px",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
            }}
          >
            + Create Project
          </button>

            <button
              onClick={async () => {

                const msg =
                  "🔄 WIPE ALL PROJECTS\n\n" +
                  "This will DELETE every project + all tasks +\n" +
                  "task assignments + work orders + daily allocations\n" +
                  "+ notifications.\n\n" +
                  "Purchase Orders keep their data (LINKED_PROJECT_ID\n" +
                  "is just nulled out). Customers, Employees, Suppliers,\n" +
                  "Quotations are untouched.\n\n" +
                  "Use this to clear old test data before launching\n" +
                  "the real customer-driven project workflow.\n\n" +
                  "Continue?";

                if (!window.confirm(msg)) return;

                if (!window.confirm("Are you really sure? This cannot be undone.")) return;

                try {

                  const res = await API.post("/projects/wipe-all");

                  alert(
                    "✅ " + (res.data?.message || "Done") +
                    "\n\nDeleted:\n" +
                    `  Projects: ${res.data?.project || 0}\n` +
                    `  Tasks: ${res.data?.task || 0}\n` +
                    `  Task Assignments: ${res.data?.task_assignment || 0}\n` +
                    `  Work Orders: ${res.data?.work_order || 0}\n` +
                    `  Notifications: ${res.data?.notification || 0}`
                  );

                  // Refresh whatever data is on screen
                  window.location.reload();

                } catch (err) {

                  alert(err?.response?.data?.detail || "Wipe failed");
                }
              }}
              style={{
                background: "transparent",
                color: "white",
                border: "1px solid rgba(255,255,255,0.45)",
                padding: "10px 18px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: 0.6,
                textTransform: "uppercase"
              }}
              title="Delete all projects + child rows (irreversible)"
            >
              Reset All Projects
            </button>

        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 14,
        marginBottom: 20
      }}>
        <StatTile label="Total Projects" value={stats.total} color="#6366f1" icon="📁" />
        <StatTile label="Active" value={stats.active} sub="in production" color="#10b981" icon="⚙️" />
        <StatTile label="Done" value={stats.completed} sub="completed" color="#1e40af" icon="✓" />
        <StatTile label="From Product" value={stats.fromProduct} sub="auto-orchestrated" color="#8b5cf6" icon="✨" />
        <StatTile label="Total Units" value={stats.totalUnits} sub="across all projects" color="#f59e0b" icon="🏭" />
      </div>

      {/* Search + filters */}
      <div style={{
        background: "white",
        padding: 14,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: 18
      }}>
        <input
          type="text"
          placeholder="🔍 Search by project name, customer, product, skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 280,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13
          }}
        />

        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={inputStyle()}>
          <option value="">All priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle()}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="PENDING">Pending</option>
          <option value="ON_HOLD">On Hold</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <div style={{ fontSize: 12, color: "#94a3b8", marginLeft: 6 }}>
          {filtered.length} of {projects.length}
        </div>
      </div>

      {/* Cards */}
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading projects…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 50,
          textAlign: "center",
          color: "#94a3b8",
          background: "white",
          borderRadius: 14,
          border: "1px dashed #cbd5e1"
        }}>
          {projects.length === 0
            ? "No projects yet. Click + Create Project to start the workflow."
            : "No projects match these filters."}
        </div>
      )}

      {/* Active projects */}
      {activeProjects.length > 0 && (
        <>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            marginTop: 4
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1.4,
              color: "#10b981",
              textTransform: "uppercase"
            }}>
              ⚙️ Active Projects
            </span>
            <span style={{
              background: "#dcfce7",
              color: "#166534",
              fontSize: 11,
              fontWeight: 800,
              padding: "2px 10px",
              borderRadius: 999
            }}>
              {activeProjects.length}
            </span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 18,
            marginBottom: 24
          }}>
            {activeProjects.map((p) => (
              <ProjectCard
                key={p.ID}
                project={p}
                onOpen={() => setDrawerId(p.ID)}
                onDelete={fetchAll}
              />
            ))}
          </div>
        </>
      )}

      {/* Done / Completed projects */}
      {doneProjects.length > 0 && (
        <>
          <div
            onClick={() => setShowDone((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              marginTop: 8,
              cursor: "pointer",
              userSelect: "none"
            }}
          >
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1.4,
              color: "#1e40af",
              textTransform: "uppercase"
            }}>
              ✓ Done
            </span>
            <span style={{
              background: "#dbeafe",
              color: "#1e40af",
              fontSize: 11,
              fontWeight: 800,
              padding: "2px 10px",
              borderRadius: 999
            }}>
              {doneProjects.length}
            </span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            <span style={{
              fontSize: 11,
              color: "#64748b",
              fontWeight: 700
            }}>
              {showDone ? "▾ hide" : "▸ show"}
            </span>
          </div>

          {showDone && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 18,
              opacity: 0.85
            }}>
              {doneProjects.map((p) => (
                <ProjectCard
                  key={p.ID}
                  project={p}
                  onOpen={() => setDrawerId(p.ID)}
                  onDelete={fetchAll}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateFromProductModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            fetchAll();
          }}
        />
      )}

      <EntityDrawer
        open={drawerId != null}
        type="project"
        id={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}


export default Projects;
