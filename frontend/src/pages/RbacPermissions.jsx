import { useEffect, useMemo, useState } from "react";
import API from "../services/api";


// =====================================================================
// RBAC Permissions Admin — Phase 2
// ---------------------------------------------------------------------
// Lets an admin (with the `role.manage` permission) review and edit
// what each role can do. Talks to the /rbac/* endpoints introduced in
// app/routes/rbac.py.
//
// UX:
//   - Left column: list of roles with member + permission count
//   - Right column: when a role is selected, the full permission
//     catalogue grouped by category, each with a checkbox showing
//     whether the role currently has it.
//   - Click checkboxes, then "Save changes" to PATCH the role's grants.
// =====================================================================

const BVC = {
  primary: "#C8102E",
  dark:    "#8B0B1F",
  deepest: "#4A0E18",
  ink:     "#0f172a",
  muted:   "#94a3b8",
  bg:      "#F5F6FA",
  tint:    "#fef2f2",
  border:  "#e5e7eb",
};


export default function RbacPermissions() {

  const [roles, setRoles]               = useState([]);
  const [groupedPerms, setGroupedPerms] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [grantedSet, setGrantedSet]     = useState(new Set());
  const [originalSet, setOriginalSet]   = useState(new Set());
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [notice, setNotice]             = useState(null);
  const [search, setSearch]             = useState("");

  // ---- Initial fetch ------------------------------------------------
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      API.get("/rbac/roles"),
      API.get("/rbac/permissions?grouped=true"),
    ])
      .then(([rolesRes, permsRes]) => {
        if (!alive) return;
        setRoles(rolesRes.data || []);
        setGroupedPerms(permsRes.data || []);
        // Auto-select the first role
        if ((rolesRes.data || []).length > 0) {
          setSelectedRoleId(rolesRes.data[0].ID);
        }
      })
      .catch((err) => {
        const detail =
          err?.response?.data?.detail ||
          err?.message ||
          "Failed to load RBAC data";
        setNotice({ type: "err", text: detail });
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // ---- Fetch the selected role's grants -----------------------------
  useEffect(() => {
    if (!selectedRoleId) {
      setGrantedSet(new Set());
      setOriginalSet(new Set());
      return;
    }
    let alive = true;
    API.get(`/rbac/roles/${selectedRoleId}`)
      .then((res) => {
        if (!alive) return;
        const codes = new Set(res.data?.granted_codes || []);
        setGrantedSet(codes);
        setOriginalSet(new Set(codes));
      })
      .catch((err) => {
        const detail =
          err?.response?.data?.detail ||
          "Failed to load role detail";
        setNotice({ type: "err", text: detail });
      });
    return () => { alive = false; };
  }, [selectedRoleId]);

  // ---- Auto-clear notice -------------------------------------------
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  // ---- Derived state ------------------------------------------------
  const selectedRole = useMemo(
    () => roles.find((r) => r.ID === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  const dirtyAdds = useMemo(
    () => [...grantedSet].filter((c) => !originalSet.has(c)),
    [grantedSet, originalSet]
  );
  const dirtyRemoves = useMemo(
    () => [...originalSet].filter((c) => !grantedSet.has(c)),
    [grantedSet, originalSet]
  );
  const isDirty = dirtyAdds.length > 0 || dirtyRemoves.length > 0;

  const filteredGroups = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return groupedPerms;
    return groupedPerms
      .map((g) => ({
        category: g.category,
        permissions: g.permissions.filter((p) =>
          p.CODE.toLowerCase().includes(s) ||
          (p.NAME || "").toLowerCase().includes(s) ||
          (p.DESCRIPTION || "").toLowerCase().includes(s)
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [groupedPerms, search]);

  // ---- Toggle / bulk helpers ---------------------------------------
  function toggle(code) {
    setGrantedSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function bulkSet(codes, value) {
    setGrantedSet((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => {
        if (value) next.add(c);
        else next.delete(c);
      });
      return next;
    });
  }

  function discardChanges() {
    setGrantedSet(new Set(originalSet));
  }

  // ---- Save ---------------------------------------------------------
  async function save() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const res = await API.patch(
        `/rbac/roles/${selectedRoleId}/permissions`,
        { codes: [...grantedSet] }
      );
      setOriginalSet(new Set(grantedSet));
      // Refresh the role list so permission_count updates
      const rolesRes = await API.get("/rbac/roles");
      setRoles(rolesRes.data || []);
      setNotice({
        type: "ok",
        text: `Saved. +${res.data?.added || 0} added, -${res.data?.removed || 0} removed. ` +
              `Members must re-login to pick up the change.`
      });
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Save failed";
      setNotice({ type: "err", text: detail });
    } finally {
      setSaving(false);
    }
  }

  // ---- Render -------------------------------------------------------
  return (
    <div style={{ padding: 20 }}>

      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          margin: 0,
          fontSize: 26,
          color: BVC.deepest,
          letterSpacing: -0.3
        }}>
          🔐 RBAC Permissions
        </h1>
        <p style={{ margin: "6px 0 0", color: BVC.muted, fontSize: 14 }}>
          Choose a role on the left, then check or uncheck permissions to
          control exactly what members of that role can do. Members will
          need to log out and back in for changes to apply.
        </p>
      </div>

      {/* Notice */}
      {notice && (
        <div style={{
          marginBottom: 14,
          padding: "10px 14px",
          background: notice.type === "ok" ? "#dcfce7" : "#fee2e2",
          color:      notice.type === "ok" ? "#166534" : "#991b1b",
          border: "1px solid " + (notice.type === "ok" ? "#86efac" : "#fca5a5"),
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600
        }}>
          {notice.text}
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        gap: 18,
        alignItems: "flex-start"
      }}>

        {/* =========== LEFT: ROLES ============ */}
        <div style={card()}>
          <div style={cardHeader()}>Roles</div>
          {loading && roles.length === 0
            ? <div style={empty()}>Loading…</div>
            : roles.length === 0
              ? <div style={empty()}>No roles found.</div>
              : (
                <div>
                  {roles.map((r) => {
                    const active = r.ID === selectedRoleId;
                    return (
                      <button
                        key={r.ID}
                        onClick={() => setSelectedRoleId(r.ID)}
                        style={roleBtn(active)}
                      >
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{r.ROLE_NAME}</div>
                        <div style={{
                          fontSize: 11,
                          color: active ? "#fce7ec" : BVC.muted,
                          marginTop: 2,
                        }}>
                          {r.permission_count} perms · {r.member_count} member{r.member_count === 1 ? "" : "s"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
          }
        </div>

        {/* =========== RIGHT: PERMISSIONS ============ */}
        <div style={card()}>

          {/* Header with role label + dirty indicator */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 14,
          }}>
            <div>
              <div style={cardHeader()}>
                Permissions {selectedRole ? `· ${selectedRole.ROLE_NAME}` : ""}
              </div>
              {selectedRole && (
                <div style={{ fontSize: 11, color: BVC.muted, marginTop: 2 }}>
                  {grantedSet.size} of {groupedPerms.reduce((n, g) => n + g.permissions.length, 0)} granted
                  {isDirty && (
                    <span style={{ color: "#b45309", marginLeft: 8, fontWeight: 700 }}>
                      · unsaved: +{dirtyAdds.length} / -{dirtyRemoves.length}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={discardChanges}
                disabled={!isDirty || saving}
                style={btnGhost(!isDirty || saving)}
              >
                Discard
              </button>
              <button
                onClick={save}
                disabled={!isDirty || saving}
                style={btnPrimary(!isDirty || saving)}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Filter permissions by code, name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              border: `1px solid ${BVC.border}`,
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 14,
              boxSizing: "border-box",
            }}
          />

          {/* Grouped checkboxes */}
          {!selectedRoleId ? (
            <div style={empty()}>Select a role on the left to view its permissions.</div>
          ) : (
            filteredGroups.map((g) => {
              const codes = g.permissions.map((p) => p.CODE);
              const allOn = codes.every((c) => grantedSet.has(c));
              return (
                <div key={g.category} style={{ marginBottom: 18 }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                    paddingBottom: 4,
                    borderBottom: `2px solid ${BVC.border}`,
                  }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: 1.2,
                      color: BVC.deepest,
                    }}>
                      {g.category}
                    </span>
                    <button
                      onClick={() => bulkSet(codes, !allOn)}
                      style={miniBtn()}
                    >
                      {allOn ? "Revoke all in group" : "Grant all in group"}
                    </button>
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 8,
                  }}>
                    {g.permissions.map((p) => {
                      const granted = grantedSet.has(p.CODE);
                      return (
                        <label
                          key={p.CODE}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "8px 10px",
                            border: `1px solid ${granted ? "#fecaca" : BVC.border}`,
                            background: granted ? "#fef2f2" : "#fff",
                            borderRadius: 8,
                            cursor: "pointer",
                            transition: "0.2s",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={granted}
                            onChange={() => toggle(p.CODE)}
                            style={{
                              marginTop: 2,
                              cursor: "pointer",
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 12,
                              color: BVC.ink,
                              fontWeight: 700,
                              wordBreak: "break-all",
                            }}>
                              {p.CODE}
                            </div>
                            <div style={{
                              fontSize: 12,
                              color: BVC.ink,
                              marginTop: 1,
                            }}>
                              {p.NAME}
                            </div>
                            {p.DESCRIPTION && (
                              <div style={{
                                fontSize: 11,
                                color: BVC.muted,
                                marginTop: 2,
                                lineHeight: 1.4,
                              }}>
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
            })
          )}

          {selectedRoleId && filteredGroups.length === 0 && (
            <div style={empty()}>No permissions match "{search}".</div>
          )}
        </div>

      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------
function card() {
  return {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
    padding: 18,
  };
}

function cardHeader() {
  return {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: BVC.deepest,
    marginBottom: 10,
  };
}

function empty() {
  return {
    padding: "30px 10px",
    textAlign: "center",
    color: BVC.muted,
    fontSize: 13,
  };
}

function roleBtn(active) {
  return {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    marginBottom: 4,
    background: active
      ? `linear-gradient(135deg, ${BVC.primary}, ${BVC.dark})`
      : "transparent",
    color: active ? "#fff" : BVC.ink,
    border: `1px solid ${active ? BVC.dark : BVC.border}`,
    borderRadius: 10,
    cursor: "pointer",
    transition: "0.15s",
  };
}

function btnPrimary(disabled) {
  return {
    padding: "8px 16px",
    border: "none",
    borderRadius: 8,
    background: disabled
      ? "#cbd5e1"
      : `linear-gradient(135deg, ${BVC.primary}, ${BVC.dark})`,
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 3px 10px rgba(200,16,46,0.3)",
    transition: "0.2s",
  };
}

function btnGhost(disabled) {
  return {
    padding: "8px 14px",
    border: `1px solid ${BVC.border}`,
    borderRadius: 8,
    background: "#fff",
    color: disabled ? BVC.muted : BVC.ink,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "0.2s",
  };
}

function miniBtn() {
  return {
    padding: "4px 10px",
    border: `1px solid ${BVC.border}`,
    borderRadius: 6,
    background: "#fff",
    color: BVC.ink,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  };
}
