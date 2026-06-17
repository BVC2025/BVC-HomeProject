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


const BVC_RED = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";

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
    <div style={{ padding: 24, background: "#F8F4F5", minHeight: "calc(100vh - 80px)" }}>

      <style>{`
        @keyframes role-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Hero header */}
      <div style={{
        background: `linear-gradient(135deg,${BVC_DARK} 0%,${BVC_RED} 100%)`,
        borderRadius: 16,
        padding: "20px 26px",
        marginBottom: 20,
        color: "white",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            color: BVC_GOLD, textTransform: "uppercase",
          }}>
            BVC24 · Admin Module 2
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
            User & Role Management (RBAC)
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            9 standard roles · {permissions.length} permissions ·
            {" "}{employees.length} employees
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={seedBvc24}
            disabled={seeding}
            style={{
              padding: "10px 18px",
              background: seeding ? "#94a3b8" : BVC_GOLD,
              color: "#1A0508",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 12,
              cursor: seeding ? "wait" : "pointer",
              boxShadow: "0 6px 16px rgba(244,179,36,0.35)",
            }}
          >
            {seeding ? "Syncing…" : "↻ Refresh BVC24 9-role catalogue"}
          </button>
          <button
            onClick={() => setShowCreate((x) => !x)}
            style={{
              padding: "10px 18px",
              background: "white",
              color: BVC_DARK,
              border: "1px solid rgba(255,255,255,0.5)",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ＋ Custom Role
          </button>
        </div>
      </div>

      {/* New-role inline form */}
      {showCreate && (
        <div style={{
          background: "white",
          padding: 18,
          borderRadius: 12,
          marginBottom: 16,
          border: "1px dashed #fecaca",
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto auto",
          gap: 10,
          alignItems: "end",
          animation: "role-fade-in 0.25s ease-out",
        }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: BVC_DARK }}>
            Role Name (will be UPPER_SNAKE)
            <input
              type="text"
              value={newRole.ROLE_NAME}
              onChange={(e) => setNewRole({ ...newRole, ROLE_NAME: e.target.value })}
              placeholder="e.g. QA Lead"
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 11, fontWeight: 700, color: BVC_DARK }}>
            Description
            <input
              type="text"
              value={newRole.DESCRIPTION}
              onChange={(e) => setNewRole({ ...newRole, DESCRIPTION: e.target.value })}
              placeholder="Short summary of the role"
              style={inputStyle}
            />
          </label>
          <button onClick={createRole} style={primaryBtn}>Create</button>
          <button
            onClick={() => { setShowCreate(false); setNewRole({ ROLE_NAME: "", DESCRIPTION: "" }); }}
            style={ghostBtn}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          background: "#0f172a",
          color: "white",
          padding: "12px 18px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
          zIndex: 9999,
          animation: "role-fade-in 0.25s ease-out",
        }}>
          ✓ {toast}
        </div>
      )}

      {/* Main 2-pane layout */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>

        {/* LEFT — Role list */}
        <div style={{
          background: "white",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          maxHeight: "calc(100vh - 220px)",
          overflowY: "auto",
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: "#64748b",
            textTransform: "uppercase",
            marginBottom: 10,
            paddingLeft: 4,
          }}>
            Roles ({orderedRoles.length})
          </div>
          {loading && (
            <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Loading…</div>
          )}
          {orderedRoles.map((r) => {
            const active = r.ID === selectedRoleId;
            const isBvc24 = BVC24_ROLE_ORDER.includes(r.ROLE_NAME);
            const empCount = (employeesByRole[r.ID] || []).length;
            return (
              <div
                key={r.ID}
                onClick={() => selectRole(r)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  marginBottom: 6,
                  background: active
                    ? `linear-gradient(135deg,${BVC_RED},${BVC_DARK})`
                    : isBvc24 ? "#fffbeb" : "#f8fafc",
                  color: active ? "white" : "#0f172a",
                  border: active
                    ? "none"
                    : `1px solid ${isBvc24 ? "#fde68a" : "#e2e8f0"}`,
                  transition: "all 0.18s",
                }}
              >
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>
                    {ROLE_LABELS[r.ROLE_NAME] || r.ROLE_NAME}
                  </div>
                  {r.IS_SYSTEM ? (
                    <span style={{
                      fontSize: 9,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: active ? "rgba(255,255,255,0.20)" : "#e0e7ff",
                      color: active ? "white" : "#3730a3",
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}>
                      SYSTEM
                    </span>
                  ) : null}
                </div>
                <div style={{
                  fontSize: 10,
                  marginTop: 4,
                  opacity: active ? 0.9 : 0.65,
                  color: active ? "rgba(255,255,255,0.85)" : "#64748b",
                }}>
                  {r.DESCRIPTION || (r.ROLE_NAME)}
                </div>
                <div style={{
                  fontSize: 10,
                  marginTop: 6,
                  display: "flex",
                  gap: 8,
                  color: active ? "rgba(255,255,255,0.95)" : "#475569",
                  fontWeight: 600,
                }}>
                  <span>🔑 {(r.PERMISSION_IDS || []).length} perms</span>
                  <span>· 👥 {empCount} employees</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT — Permissions grid for selected role */}
        <div style={{
          background: "white",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          minHeight: 400,
        }}>
          {!selectedRole ? (
            <div style={{
              padding: 40,
              textAlign: "center",
              color: "#94a3b8",
              fontStyle: "italic",
              fontSize: 13,
            }}>
              Select a role on the left to edit its permissions.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 1.5,
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}>
                    Permissions
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: BVC_DARK, marginTop: 4 }}>
                    {ROLE_LABELS[selectedRole.ROLE_NAME] || selectedRole.ROLE_NAME}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {selectedRole.DESCRIPTION || "—"}
                    {selectedRole.IS_SYSTEM ? (
                      <span style={{
                        marginLeft: 8,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "#fef3c7",
                        color: "#92400e",
                        fontWeight: 700,
                        fontSize: 10,
                      }}>
                        SYSTEM
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!selectedRole.IS_SYSTEM && (
                    <button onClick={() => deleteRole(selectedRole)} style={dangerBtn}>
                      🗑 Delete
                    </button>
                  )}
                  <button
                    onClick={savePermissions}
                    disabled={!isDirty || saving}
                    style={{
                      ...primaryBtn,
                      background: !isDirty || saving ? "#cbd5e1" : `linear-gradient(135deg,${BVC_RED},${BVC_DARK})`,
                      cursor: !isDirty || saving ? "not-allowed" : "pointer",
                    }}
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
                  <div key={cat} style={{
                    marginBottom: 12,
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                    }}>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 1.2,
                        color: BVC_DARK,
                        textTransform: "uppercase",
                      }}>
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
                        style={{
                          fontSize: 10,
                          padding: "4px 10px",
                          background: allOn ? "#fef2f2" : "#ecfdf5",
                          color: allOn ? "#b91c1c" : "#047857",
                          border: `1px solid ${allOn ? "#fecaca" : "#a7f3d0"}`,
                          borderRadius: 6,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {allOn ? "Clear all" : (someOn ? "Select all" : "Select all")}
                      </button>
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                      padding: 8,
                    }}>
                      {perms.map((p) => {
                        const on = draftPermIds.has(p.ID);
                        return (
                          <label
                            key={p.ID}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              padding: 8,
                              borderRadius: 6,
                              cursor: "pointer",
                              background: on ? "#fef2f2" : "transparent",
                              border: `1px solid ${on ? "#fecaca" : "transparent"}`,
                              transition: "all 0.15s",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => togglePerm(p.ID)}
                              style={{ marginTop: 2, accentColor: BVC_RED }}
                            />
                            <div>
                              <div style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: on ? BVC_DARK : "#0f172a",
                              }}>
                                {p.NAME}
                              </div>
                              <div style={{
                                fontSize: 10,
                                color: "#64748b",
                                fontFamily: "ui-monospace, monospace",
                                marginTop: 2,
                              }}>
                                {p.CODE}
                              </div>
                              {p.DESCRIPTION && (
                                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                                  {p.DESCRIPTION}
                                </div>
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
              <div style={{ marginTop: 18 }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.2,
                  color: "#64748b",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}>
                  Employees on this role · {assignedEmployees.length}
                </div>
                {assignedEmployees.length === 0 ? (
                  <div style={{
                    padding: 12,
                    background: "#f8fafc",
                    border: "1px dashed #cbd5e1",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "#94a3b8",
                    fontStyle: "italic",
                    textAlign: "center",
                  }}>
                    No employees assigned to this role yet. Assign from the Employees page.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {assignedEmployees.map((e) => (
                      <div key={e.ID} style={{
                        padding: "5px 10px",
                        background: "#eef2ff",
                        color: "#3730a3",
                        border: "1px solid #c7d2fe",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                      }}>
                        {e.NAME} <span style={{ opacity: 0.6 }}>· {e.EMPLOYEE_CODE}</span>
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


// ---- Small inline styles ---------------------------------------------

const inputStyle = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};

const primaryBtn = {
  padding: "9px 16px",
  background: `linear-gradient(135deg,${BVC_RED},${BVC_DARK})`,
  color: "white",
  border: "none",
  borderRadius: 8,
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
};

const ghostBtn = {
  padding: "9px 16px",
  background: "white",
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const dangerBtn = {
  padding: "9px 14px",
  background: "white",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
