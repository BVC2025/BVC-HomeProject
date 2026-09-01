import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";
import styles from "./Projects.module.css";


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
  HIGH: { bg: "#fee2e2", fg: "#b91c1c", grad: "#ef4444" },
  MEDIUM: { bg: "#fef3c7", fg: "#854d0e", grad: "#f59e0b" },
  LOW: { bg: "#dbeafe", fg: "#1e40af", grad: "#ef4444" }
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
      className={styles.statTile}
      style={{ borderTop: `3px solid ${color}` }}
    >
      {icon && (
        <div className={styles.statTileIcon}>
          {icon}
        </div>
      )}
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


function Pill({ children, bg, fg }) {
  return (
    <span
      className={styles.pill}
      style={{ background: bg, color: fg }}
    >
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
      className={styles.card}
    >
      {/* Priority accent bar — color from PRIORITY_THEMES runtime data */}
      <div
        className={styles.cardAccentBar}
        style={{ background: prioTheme.grad }}
      />

      {/* Delete button — bg/color vary by deleting state */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete project"
        className={styles.cardDeleteBtn}
        style={{
          background: deleting ? "#f1f5f9" : "#fef2f2",
          color: deleting ? "#94a3b8" : "#b91c1c",
          cursor: deleting ? "default" : "pointer"
        }}
      >
        {deleting ? "…" : "×"}
      </button>

      <div className={styles.cardHeader}>
        <div className={styles.cardTitleWrap}>
          <div className={styles.cardTitle}>
            {project.PROJECT_NAME}
          </div>
        </div>
        {/* Pill bg/fg come from PRIORITY_THEMES — runtime data */}
        <Pill bg={prioTheme.bg} fg={prioTheme.fg}>{prio}</Pill>
      </div>

      {/* Customer + Product chips */}
      <div className={styles.chipRow}>
        {project.CUSTOMER_NAME && (
          <span className={styles.chipCustomer}>
            🤝 {project.CUSTOMER_NAME}
          </span>
        )}
        {project.PRODUCT_MODEL_NAME && (
          <span className={styles.chipProduct}>
            🏭 {project.PRODUCT_MODEL_NAME}
          </span>
        )}
        {project.QUANTITY > 0 && (
          <span className={styles.chipQty}>
            × {project.QUANTITY} unit{project.QUANTITY > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {project.SKILLS_REQUIRED && (
        <div className={styles.skillsSnippet}>
          🧠 Skills: {project.SKILLS_REQUIRED}
        </div>
      )}

      <div className={styles.cardFooter}>
        {/* Pill bg/fg come from STATUS_THEMES — runtime data */}
        <Pill bg={statusTheme.bg} fg={statusTheme.fg}>
          {status.replaceAll("_", " ")}
        </Pill>
        <div className={styles.cardHint}>
          Click for 360°
        </div>
      </div>
    </div>
  );
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

      // Enrich with customer names via a separate fetch
      const custRes = await API.get("/customers").catch(() => ({ data: [] }));

      const custMap = Object.fromEntries(
        (custRes.data || []).map((c) => [c.ID, c.COMPANY_NAME || c.NAME])
      );

      const enriched = (res.data || []).map((p) => ({
        ...p,
        CUSTOMER_NAME: p.CUSTOMER_NAME || custMap[p.CUSTOMER_ID] || null,
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

    <div className={styles.page}>

      {/* HERO */}
      <div className={styles.heroAlt}>
        <div>
          <div className={styles.heroAltEyebrow}>
            Workflow
          </div>
          <h1 className={styles.heroAltTitle}>
            Projects
          </h1>
        </div>

        <div className={styles.heroActions}>

          <button
            onClick={async () => {

              const msg =
                "🔄 WIPE ALL PROJECTS\n\n" +
                "This will DELETE every project + all tasks +\n" +
                "task assignments + work orders + daily allocations\n" +
                "+ notifications.\n\n" +
                "Purchase Orders keep their data (LINKED_PROJECT_ID\n" +
                "is just nulled out). Customers, Employees, and\n" +
                "Suppliers are untouched.\n\n" +
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
            className={styles.btnResetAll}
            title="Delete all projects + child rows (irreversible)"
          >
            Reset All Projects
          </button>

        </div>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <StatTile label="Total Projects" value={stats.total} color="#6366f1" icon="📁" />
        <StatTile label="Active" value={stats.active} sub="in production" color="#10b981" icon="⚙️" />
        <StatTile label="Done" value={stats.completed} sub="completed" color="#1e40af" icon="✓" />
        <StatTile label="From Product" value={stats.fromProduct} sub="auto-orchestrated" color="#8b5cf6" icon="✨" />
        <StatTile label="Total Units" value={stats.totalUnits} sub="across all projects" color="#f59e0b" icon="🏭" />
      </div>

      {/* Search + filters */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="🔍 Search by project name, customer, product, skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="PENDING">Pending</option>
          <option value="ON_HOLD">On Hold</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <div className={styles.filterCount}>
          {filtered.length} of {projects.length}
        </div>
      </div>

      {/* Cards */}
      {loading && (
        <div className={styles.loadingState}>
          Loading projects…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          {projects.length === 0
            ? "No projects yet. Click + Create Project to start the workflow."
            : "No projects match these filters."}
        </div>
      )}

      {/* Active projects */}
      {activeProjects.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <span className={`${styles.sectionLabel} ${styles.sectionLabelActive}`}>
              ⚙️ Active Projects
            </span>
            <span className={styles.sectionBadgeActive}>
              {activeProjects.length}
            </span>
            <div className={styles.sectionDivider} />
          </div>

          <div className={styles.cardsGrid}>
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
            className={styles.sectionHeaderClickable}
          >
            <span className={`${styles.sectionLabel} ${styles.sectionLabelDone}`}>
              ✓ Done
            </span>
            <span className={styles.sectionBadgeDone}>
              {doneProjects.length}
            </span>
            <div className={styles.sectionDivider} />
            <span className={styles.sectionToggle}>
              {showDone ? "▾ hide" : "▸ show"}
            </span>
          </div>

          {showDone && (
            <div className={styles.cardsGridDone}>
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
