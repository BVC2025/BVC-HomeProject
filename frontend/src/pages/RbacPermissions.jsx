import { useEffect, useMemo, useState } from "react";
import API from "../services/api";
import styles from "./RbacPermissions.module.css";


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

  void loading;

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
        if ((rolesRes.data || []).length > 0) {
          setSelectedRoleId(rolesRes.data[0].ID);
        }
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || err?.message || "Failed to load RBAC data";
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
        const detail = err?.response?.data?.detail || "Failed to load role detail";
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
      codes.forEach((c) => { if (value) next.add(c); else next.delete(c); });
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
    <div className={styles.page}>

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>🔐 RBAC Permissions</h1>
        <p className={styles.pageDesc}>
          Choose a role on the left, then check or uncheck permissions to
          control exactly what members of that role can do. Members will
          need to log out and back in for changes to apply.
        </p>
      </div>

      {notice && (
        <div className={`${styles.notice} ${notice.type === "ok" ? styles.noticeOk : styles.noticeErr}`}>
          {notice.text}
        </div>
      )}

      <div className={styles.layout}>

        {/* LEFT: ROLES */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>Roles</div>
          {roles.length === 0 ? (
            <div className={styles.empty}>Loading…</div>
          ) : (
            <div>
              {roles.map((r) => {
                const active = r.ID === selectedRoleId;
                return (
                  <button
                    key={r.ID}
                    onClick={() => setSelectedRoleId(r.ID)}
                    className={`${styles.roleBtn}${active ? ` ${styles.roleBtnActive}` : ""}`}
                  >
                    <div className={styles.roleName}>{r.ROLE_NAME}</div>
                    <div
                      className={styles.roleMeta}
                      style={active ? { color: "#fce7ec" } : undefined}
                    >
                      {r.permission_count} perms · {r.member_count} member{r.member_count === 1 ? "" : "s"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: PERMISSIONS */}
        <div className={styles.card}>

          <div className={styles.permPanelTop}>
            <div>
              <div className={styles.cardHeader}>
                Permissions {selectedRole ? `· ${selectedRole.ROLE_NAME}` : ""}
              </div>
              {selectedRole && (
                <div className={styles.permCount}>
                  {grantedSet.size} of {groupedPerms.reduce((n, g) => n + g.permissions.length, 0)} granted
                  {isDirty && (
                    <span className={styles.permDirty}>
                      · unsaved: +{dirtyAdds.length} / -{dirtyRemoves.length}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className={styles.actionRow}>
              <button
                onClick={discardChanges}
                disabled={!isDirty || saving}
                className={styles.btnGhost}
              >
                Discard
              </button>
              <button
                onClick={save}
                disabled={!isDirty || saving}
                className={styles.btnPrimary}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="Filter permissions by code, name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />

          {!selectedRoleId ? (
            <div className={styles.empty}>Select a role on the left to view its permissions.</div>
          ) : (
            filteredGroups.map((g) => {
              const codes = g.permissions.map((p) => p.CODE);
              const allOn = codes.every((c) => grantedSet.has(c));
              return (
                <div key={g.category} className={styles.permGroup}>
                  <div className={styles.permGroupHeader}>
                    <span className={styles.permGroupLabel}>{g.category}</span>
                    <button
                      onClick={() => bulkSet(codes, !allOn)}
                      className={styles.miniBtn}
                    >
                      {allOn ? "Revoke all in group" : "Grant all in group"}
                    </button>
                  </div>

                  <div className={styles.permGrid}>
                    {g.permissions.map((p) => {
                      const granted = grantedSet.has(p.CODE);
                      return (
                        <label
                          key={p.CODE}
                          className={`${styles.permLabel}${granted ? ` ${styles.permLabelGranted}` : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={granted}
                            onChange={() => toggle(p.CODE)}
                            className={styles.permCheckbox}
                          />
                          <div className={styles.permContent}>
                            <div className={styles.permCode}>{p.CODE}</div>
                            <div className={styles.permName}>{p.NAME}</div>
                            {p.DESCRIPTION && (
                              <div className={styles.permDesc}>{p.DESCRIPTION}</div>
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
            <div className={styles.empty}>No permissions match "{search}".</div>
          )}
        </div>

      </div>
    </div>
  );
}
