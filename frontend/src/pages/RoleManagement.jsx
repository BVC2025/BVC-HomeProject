// =====================================================================
// Admin Module 2 — User & Role Management (RBAC)
// =====================================================================
// Lists every Role on the left, the selected role's permission grid on
// the right (grouped by category). Admin can:
//   - Seed/refresh the 9 BVC24 standard roles in one click
//   - Create a new custom role
//   - Toggle individual permissions, save in bulk
//   - Delete custom roles (system roles refuse)
//   - See which Employees are currently assigned each role
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import API from "../services/api";
import styles from "./RoleManagement.module.css";

// Friendly labels for the 9 BVC24 target roles (everything else gets
// the raw ROLE_NAME shown as-is).
const ROLE_LABELS = {
  SUPER_ADMIN: "🔱 Super Admin",
  MANAGING_DIRECTOR: "🎖️ Managing Director (MD)",
  HR_MANAGER: "👥 HR Manager",
  SALES_MANAGER: "📈 Sales Manager",
  PURCHASE_MANAGER: "🛒 Purchase Manager",
  PRODUCTION_MANAGER: "🏭 Production Manager",
  INVENTORY_MANAGER: "📦 Inventory Manager",
  ACCOUNTS_MANAGER: "💰 Accounts Manager",
  EMPLOYEE: "👤 Employee",
};

const BVC24_ROLE_ORDER = [
  "SUPER_ADMIN",
  "MANAGING_DIRECTOR",
  "HR_MANAGER",
  "SALES_MANAGER",
  "PURCHASE_MANAGER",
  "PRODUCTION_MANAGER",
  "INVENTORY_MANAGER",
  "ACCOUNTS_MANAGER",
  "EMPLOYEE",
];


export default function RoleManagement() {

  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedRoleId, setSelectedId] = useState(null);
  const [draftPermIds, setDraftPermIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // New-role inline form
  const [showCreate, setShowCreate] = useState(false);
  const [newRole, setNewRole] = useState({ ROLE_NAME: "", DESCRIPTION: "" });

  // ---- Fetch ---------------------------------------------------------

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [r, p, e] = await Promise.all([
        API.get("/roles?vendor_id=1"),
        API.get("/permissions"),
        API.get("/employees"),
      ]);
      setRoles(r.data || []);
      setPermissions(p.data || []);
      setEmployees(e.data || []);
      if (r.data?.length && !selectedRoleId) {
        // Auto-select Super Admin or the first BVC24 role
        const preferred = r.data.find((x) =>
          BVC24_ROLE_ORDER.includes(x.ROLE_NAME)
        );
        const pick = preferred || r.data[0];
        setSelectedId(pick.ID);
        setDraftPermIds(new Set(pick.PERMISSION_IDS || []));
      }
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  // ---- Selection ----------------------------------------------------

  const selectedRole = useMemo(
    () => roles.find((r) => r.ID === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  const selectRole = (role) => {
    setSelectedId(role.ID);
    setDraftPermIds(new Set(role.PERMISSION_IDS || []));
  };

  // ---- Grouped permissions for the grid -----------------------------

  const groupedPermissions = useMemo(() => {
    const out = {};
    for (const p of permissions) {
      (out[p.CATEGORY || "Other"] ||= []).push(p);
    }
    return out;
  }, [permissions]);

  const togglePerm = (id) => {
    setDraftPermIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const isDirty = useMemo(() => {
    if (!selectedRole) return false;
    const original = new Set(selectedRole.PERMISSION_IDS || []);
    if (original.size !== draftPermIds.size) return true;
    for (const x of original) if (!draftPermIds.has(x)) return true;
    return false;
  }, [selectedRole, draftPermIds]);

  // ---- Actions ------------------------------------------------------

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await API.put(`/roles/${selectedRole.ID}/permissions`, {
        PERMISSION_IDS: [...draftPermIds],
      });
      showToast(`Saved ${draftPermIds.size} permission(s) on ${selectedRole.ROLE_NAME}`);
      await fetchAll();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newRole.ROLE_NAME.trim()) {
      setError("Role name is required.");
      return;
    }
    try {
      await API.post("/roles", {
        ROLE_NAME: newRole.ROLE_NAME.trim().toUpperCase().replace(/\s+/g, "_"),
        DESCRIPTION: newRole.DESCRIPTION || "",
        VENDOR_ID: 1,
      });
      setNewRole({ ROLE_NAME: "", DESCRIPTION: "" });
      setShowCreate(false);
      showToast("New role created.");
      await fetchAll();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Could not create role.");
    }
  };

  const deleteRole = async (role) => {
    if (role.IS_SYSTEM) {
      alert("System roles cannot be deleted. Edit permissions instead.");
      return;
    }
    if (!window.confirm(`Delete role "${role.ROLE_NAME}"? Employees with this role will need to be reassigned.`)) {
      return;
    }
    try {
      await API.delete(`/roles/${role.ID}`);
      showToast("Role deleted.");
      setSelectedId(null);
      await fetchAll();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Delete failed.");
    }
  };

  const seedBvc24 = async () => {
    setSeeding(true);
    try {
      const r = await API.post("/roles/seed-bvc24-catalogue?vendor_id=1");
      showToast(r.data?.message || "Catalogue refreshed.");
      await fetchAll();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Seed failed.");
    } finally {
      setSeeding(false);
    }
  };

  // ---- Employees by role (counts) -----------------------------------

  const employeesByRole = useMemo(() => {
    const out = {};
    for (const e of employees) {
      if (e.ROLE_ID) (out[e.ROLE_ID] ||= []).push(e);
    }
    return out;
  }, [employees]);

  const assignedEmployees = selectedRole
    ? (employeesByRole[selectedRole.ID] || [])
    : [];

  // ---- Order roles: BVC24 9 first (in spec order), then others ------

  const orderedRoles = useMemo(() => {
    const indexOf = (name) => {
      const i = BVC24_ROLE_ORDER.indexOf(name);
      return i === -1 ? 999 : i;
    };
    return [...roles].sort((a, b) => {
      const ai = indexOf(a.ROLE_NAME);
      const bi = indexOf(b.ROLE_NAME);
      if (ai !== bi) return ai - bi;
      return a.ROLE_NAME.localeCompare(b.ROLE_NAME);
    });
  }, [roles]);

  // ---- Render -------------------------------------------------------

  return (
    <div className={styles.page}>

      {/* Hero header */}
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.heroEyebrow}>BVC24 · Admin Module 2</div>
          <div className={styles.heroTitle}>User & Role Management (RBAC)</div>
          <div className={styles.heroDesc}>
            9 standard roles · {permissions.length} permissions · {employees.length} employees
          </div>
        </div>
        <div className={styles.heroActions}>
          <button onClick={seedBvc24} disabled={seeding} className={styles.seedBtn}>
            {seeding ? "Syncing…" : "↻ Refresh BVC24 9-role catalogue"}
          </button>
          <button onClick={() => setShowCreate((x) => !x)} className={styles.ghostBtn}>
            ＋ Custom Role
          </button>
        </div>
      </div>

      {/* New-role inline form */}
      {showCreate && (
        <div className={styles.createForm}>
          <label className={styles.createLabel}>
            Role Name (will be UPPER_SNAKE)
            <input
              type="text"
              value={newRole.ROLE_NAME}
              onChange={(e) => setNewRole({ ...newRole, ROLE_NAME: e.target.value })}
              placeholder="e.g. QA Lead"
              className={styles.input}
            />
          </label>
          <label className={styles.createLabel}>
            Description
            <input
              type="text"
              value={newRole.DESCRIPTION}
              onChange={(e) => setNewRole({ ...newRole, DESCRIPTION: e.target.value })}
              placeholder="Short summary of the role"
              className={styles.input}
            />
          </label>
          <button onClick={createRole} className={styles.primaryBtn}>Create</button>
          <button
            onClick={() => { setShowCreate(false); setNewRole({ ROLE_NAME: "", DESCRIPTION: "" }); }}
            className={styles.ghostBtn}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}

      {toast && (
        <div className={styles.toast}>✓ {toast}</div>
      )}

      {/* Main 2-pane layout */}
      <div className={styles.layout}>

        {/* LEFT — Role list */}
        <div className={`${styles.panel} ${styles.roleListPanel}`}>
          <div className={styles.roleListHeader}>Roles ({orderedRoles.length})</div>
          {loading && <div className={styles.loadingText}>Loading…</div>}
          {orderedRoles.map((r) => {
            const active = r.ID === selectedRoleId;
            const isBvc24 = BVC24_ROLE_ORDER.includes(r.ROLE_NAME);
            const empCount = (employeesByRole[r.ID] || []).length;
            return (
              <div
                key={r.ID}
                onClick={() => selectRole(r)}
                className={[
                  styles.roleItem,
                  active ? styles.roleItemActive : isBvc24 ? styles.roleItemBvc24 : ""
                ].join(" ")}
              >
                <div className={styles.roleItemRow}>
                  <div className={styles.roleName}>
                    {ROLE_LABELS[r.ROLE_NAME] || r.ROLE_NAME}
                  </div>
                  {r.IS_SYSTEM ? (
                    <span className={active ? styles.systemBadgeActive : styles.systemBadge}>
                      SYSTEM
                    </span>
                  ) : null}
                </div>
                <div className={active ? styles.roleDescActive : styles.roleDesc}>
                  {r.DESCRIPTION || r.ROLE_NAME}
                </div>
                <div className={active ? styles.roleMetaActive : styles.roleMeta}>
                  <span>🔑 {(r.PERMISSION_IDS || []).length} perms</span>
                  <span>· 👥 {empCount} employees</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT — Permissions grid for selected role */}
        <div className={styles.panelWide}>
          {!selectedRole ? (
            <div className={styles.emptyState}>
              Select a role on the left to edit its permissions.
            </div>
          ) : (
            <>
              <div className={styles.permHeader}>
                <div>
                  <div className={styles.permSectionLabel}>Permissions</div>
                  <div className={styles.permRoleName}>
                    {ROLE_LABELS[selectedRole.ROLE_NAME] || selectedRole.ROLE_NAME}
                  </div>
                  <div className={styles.permRoleDesc}>
                    {selectedRole.DESCRIPTION || "—"}
                    {selectedRole.IS_SYSTEM ? (
                      <span className={styles.permSystemBadge}>SYSTEM</span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.permActions}>
                  {!selectedRole.IS_SYSTEM && (
                    <button onClick={() => deleteRole(selectedRole)} className={styles.dangerBtn}>
                      🗑 Delete
                    </button>
                  )}
                  <button
                    onClick={savePermissions}
                    disabled={!isDirty || saving}
                    className={styles.primaryBtn}
                  >
                    {saving ? "Saving…" : `💾 Save (${draftPermIds.size})`}
                  </button>
                </div>
              </div>

              {/* Permission grid grouped by category */}
              {Object.entries(groupedPermissions).map(([cat, perms]) => {
                const allOn = perms.every((p) => draftPermIds.has(p.ID));
                const someOn = perms.some((p) => draftPermIds.has(p.ID));
                return (
                  <div key={cat} className={styles.catBlock}>
                    <div className={styles.catHeader}>
                      <div className={styles.catTitle}>
                        {cat} · {perms.filter((p) => draftPermIds.has(p.ID)).length} / {perms.length}
                      </div>
                      <button
                        onClick={() => {
                          setDraftPermIds((prev) => {
                            const n = new Set(prev);
                            if (allOn) perms.forEach((p) => n.delete(p.ID));
                            else perms.forEach((p) => n.add(p.ID));
                            return n;
                          });
                        }}
                        className={allOn ? styles.catToggleOn : styles.catToggleOff}
                      >
                        {allOn ? "Clear all" : (someOn ? "Select all" : "Select all")}
                      </button>
                    </div>
                    <div className={styles.catGrid}>
                      {perms.map((p) => {
                        const on = draftPermIds.has(p.ID);
                        return (
                          <label
                            key={p.ID}
                            className={on ? `${styles.permItem} ${styles.permItemOn}` : styles.permItem}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => togglePerm(p.ID)}
                              className={styles.permCheckbox}
                            />
                            <div>
                              <div className={on ? `${styles.permName} ${styles.permNameOn}` : styles.permName}>
                                {p.NAME}
                              </div>
                              <div className={styles.permCode}>{p.CODE}</div>
                              {p.DESCRIPTION && (
                                <div className={styles.permMeta}>{p.DESCRIPTION}</div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Employees with this role */}
              <div className={styles.empSection}>
                <div className={styles.empSectionTitle}>
                  Employees on this role · {assignedEmployees.length}
                </div>
                {assignedEmployees.length === 0 ? (
                  <div className={styles.empEmpty}>
                    No employees assigned to this role yet. Assign from the Employees page.
                  </div>
                ) : (
                  <div className={styles.empTags}>
                    {assignedEmployees.map((e) => (
                      <div key={e.ID} className={styles.empTag}>
                        {e.NAME} <span className={styles.empTagSub}>· {e.EMPLOYEE_CODE}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


