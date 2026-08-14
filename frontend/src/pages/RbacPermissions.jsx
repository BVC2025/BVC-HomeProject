import { useEffect, useMemo, useState } from "react";
import API from "../services/api";
import styles from "./RbacPermissions.module.css";
import {
  PageHeader, StatsRow, SearchBar, EmptyState,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { useAuth } from "../context/AuthContext";
import RoleIcon from "../assets/Icons/roleIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";


// =====================================================================
// RBAC Permissions Admin — Phase 2 + Phase 3 (employee overrides)
// ---------------------------------------------------------------------
// Two modes, toggled at the top:
//   "roles"     — review/edit what each ROLE can do (unchanged from the
//                 prior redesign). SUPER_ADMIN is shown as fully
//                 granted + fully locked: its access is unconditional
//                 at the backend regardless of what this grid shows,
//                 and every write endpoint independently rejects any
//                 attempt to touch it — this UI lock is a courtesy,
//                 not the actual security boundary.
//   "employees" — grant/deny specific permissions for ONE employee on
//                 top of their role's defaults (backed by
//                 /rbac/employees/{id}/overrides). Only shown to a
//                 session that actually holds permission.override.manage
//                 (Root/SUPER_ADMIN/ADMIN always do, via the existing
//                 bypass in utils/rbac.js's hasPermission()).
//
// Both modes render the SAME permission catalogue (groupedPerms, loaded
// once) through the same grouped-grid markup — only the per-row
// checked-state and available actions differ.
// =====================================================================


const SUPER_ADMIN = "SUPER_ADMIN";


// Sub-groups a category's permissions by their PAGE hint (see
// backend/app/services/permission_catalogue.py's PAGE_LABELS),
// preserving first-seen order. Permissions with no PAGE hint land in
// one trailing unlabeled bucket, rendered flat — exactly like before
// this feature existed — so categories with no page data are
// unaffected.
function groupByPage(permissions) {
  const buckets = [];
  const indexByKey = new Map();
  for (const p of permissions) {
    const page = p.PAGE || null;
    const key = page ?? "__none__";
    if (!indexByKey.has(key)) {
      indexByKey.set(key, buckets.length);
      buckets.push({ page, permissions: [] });
    }
    buckets[indexByKey.get(key)].permissions.push(p);
  }
  const noneIdx = buckets.findIndex((b) => b.page === null);
  if (noneIdx !== -1 && noneIdx !== buckets.length - 1) {
    const [none] = buckets.splice(noneIdx, 1);
    buckets.push(none);
  }
  return buckets;
}


export default function RbacPermissions() {

  const { hasPermission } = useAuth();
  const canManageOverrides = hasPermission("permission.override.manage");

  const [mode, setMode] = useState("roles");

  const [roles, setRoles] = useState([]);
  const [groupedPerms, setGroupedPerms] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [grantedSet, setGrantedSet] = useState(new Set());
  const [originalSet, setOriginalSet] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState("");

  // Mobile-only tap-to-navigate state. "roles" = show the roles/employees
  // list, "perms" = show the permissions panel with a back button. CSS
  // media query below suppresses this on tablets/desktops where both
  // panels are always visible side-by-side.
  const [mobilePane, setMobilePane] = useState("roles");

  // Delete-role confirmation state.
  const [roleToDelete, setRoleToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ---- Employees mode state ------------------------------------------
  const [employees, setEmployees] = useState([]);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [employeeRoleCodes, setEmployeeRoleCodes] = useState(new Set());
  const [employeeOverrides, setEmployeeOverrides] = useState([]);
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Grant/Deny confirmation: { code, name, effect } | null
  const [overrideConfirm, setOverrideConfirm] = useState(null);

  // Revert-override confirmation: permission_id | null
  const [revertTarget, setRevertTarget] = useState(null);

  // ---- Shared loaders -------------------------------------------------
  function loadRoles() {
    return API.get("/rbac/roles").then((res) => {
      setRoles(res.data || []);
      return res.data || [];
    });
  }

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

  // ---- Load employees once, the first time Employees mode is opened -
  useEffect(() => {
    if (mode !== "employees" || employeesLoaded) return;
    let alive = true;
    API.get("/employees")
      .then((res) => {
        if (!alive) return;
        setEmployees(res.data || []);
        setEmployeesLoaded(true);
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || "Failed to load employees";
        setNotice({ type: "err", text: detail });
      });
    return () => { alive = false; };
  }, [mode, employeesLoaded]);

  // ---- Fetch the selected employee's role-codes + overrides ---------
  useEffect(() => {
    if (!selectedEmployeeId) {
      setEmployeeRoleCodes(new Set());
      setEmployeeOverrides([]);
      return;
    }
    const emp = employees.find((e) => e.ID === selectedEmployeeId);
    let alive = true;

    const roleCall = emp?.ROLE_ID
      ? API.get(`/rbac/roles/${emp.ROLE_ID}`)
      : Promise.resolve({ data: { granted_codes: [] } });

    Promise.all([
      roleCall,
      API.get(`/rbac/employees/${selectedEmployeeId}/overrides`),
    ])
      .then(([roleRes, overridesRes]) => {
        if (!alive) return;
        setEmployeeRoleCodes(new Set(roleRes.data?.granted_codes || []));
        setEmployeeOverrides(overridesRes.data || []);
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || "Failed to load employee permissions";
        setNotice({ type: "err", text: detail });
      });
    return () => { alive = false; };
  }, [selectedEmployeeId, employees]);

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

  const isSuperAdminRole = selectedRole?.ROLE_NAME === SUPER_ADMIN;

  const totalPermissions = useMemo(
    () => groupedPerms.reduce((n, g) => n + g.permissions.length, 0),
    [groupedPerms]
  );

  const allCodes = useMemo(
    () => new Set(groupedPerms.flatMap((g) => g.permissions.map((p) => p.CODE))),
    [groupedPerms]
  );

  const totalMembers = useMemo(
    () => roles.reduce((n, r) => n + (r.member_count || 0), 0),
    [roles]
  );

  // SUPER_ADMIN's real DB grants are irrelevant (unconditional bypass at
  // the backend) — display it as fully granted rather than the
  // confusing "0 permissions" a fresh/never-backfilled row would show.
  const displayGrantedSet = isSuperAdminRole ? allCodes : grantedSet;

  const dirtyAdds = useMemo(
    () => [...grantedSet].filter((c) => !originalSet.has(c)),
    [grantedSet, originalSet]
  );
  const dirtyRemoves = useMemo(
    () => [...originalSet].filter((c) => !grantedSet.has(c)),
    [grantedSet, originalSet]
  );
  const isDirty = !isSuperAdminRole && (dirtyAdds.length > 0 || dirtyRemoves.length > 0);

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

  const overridesByCode = useMemo(() => {
    const m = new Map();
    employeeOverrides.forEach((o) => m.set(o.CODE, o));
    return m;
  }, [employeeOverrides]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.ID === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const filteredEmployees = useMemo(() => {
    const s = employeeSearch.trim().toLowerCase();
    // SUPER_ADMIN's access is fixed — there's nothing to override, so
    // don't even offer them in the picker.
    const eligible = employees.filter((e) => e.ROLE?.NAME !== SUPER_ADMIN);
    if (!s) return eligible;
    return eligible.filter((e) =>
      [e.NAME, e.EMPLOYEE_CODE, e.ROLE?.NAME, e.DEPARTMENT?.NAME]
        .filter(Boolean).join(" ").toLowerCase().includes(s)
    );
  }, [employees, employeeSearch]);

  // ---- Toggle / bulk helpers (Roles mode) ----------------------------
  function toggle(code) {
    if (isSuperAdminRole) return;
    setGrantedSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function bulkSet(codes, value) {
    if (isSuperAdminRole) return;
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
    if (!selectedRoleId || isSuperAdminRole) return;
    setSaving(true);
    try {
      const res = await API.patch(
        `/rbac/roles/${selectedRoleId}/permissions`,
        { codes: [...grantedSet] }
      );
      setOriginalSet(new Set(grantedSet));
      await loadRoles();
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

  // ---- Delete role -----------------------------------------------------
  async function deleteRole() {
    if (!roleToDelete) return;
    setDeleting(true);
    try {
      await API.delete(`/roles/${roleToDelete.ID}`);
      if (selectedRoleId === roleToDelete.ID) {
        setSelectedRoleId(null);
        setMobilePane("roles");
      }
      await loadRoles();
      setNotice({ type: "ok", text: `Role "${roleToDelete.ROLE_NAME}" deleted.` });
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Delete failed.";
      setNotice({ type: "err", text: detail });
    } finally {
      setDeleting(false);
      setRoleToDelete(null);
    }
  }

  // ---- Employee override actions -------------------------------------
  async function confirmOverride() {
    if (!overrideConfirm || !selectedEmployeeId) return;
    setOverrideBusy(true);
    try {
      await API.post(`/rbac/employees/${selectedEmployeeId}/overrides`, {
        code: overrideConfirm.code,
        effect: overrideConfirm.effect,
      });
      const res = await API.get(`/rbac/employees/${selectedEmployeeId}/overrides`);
      setEmployeeOverrides(res.data || []);
      setNotice({
        type: "ok",
        text: `${overrideConfirm.effect === "GRANT" ? "Granted" : "Denied"} "${overrideConfirm.code}". ` +
          `The employee must re-login to pick up the change.`,
      });
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Could not save override.";
      setNotice({ type: "err", text: detail });
    } finally {
      setOverrideBusy(false);
      setOverrideConfirm(null);
    }
  }

  async function revertOverride() {
    if (!revertTarget || !selectedEmployeeId) return;
    setOverrideBusy(true);
    try {
      await API.delete(`/rbac/employees/${selectedEmployeeId}/overrides/${revertTarget.permissionId}`);
      const res = await API.get(`/rbac/employees/${selectedEmployeeId}/overrides`);
      setEmployeeOverrides(res.data || []);
      setNotice({ type: "ok", text: `"${revertTarget.code}" reverted to the role default.` });
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Could not revert override.";
      setNotice({ type: "err", text: detail });
    } finally {
      setOverrideBusy(false);
      setRevertTarget(null);
    }
  }

  // ---- Render: one permission row, branching on mode -----------------
  function renderPermissionRow(p) {
    if (mode === "employees") {
      const override = overridesByCode.get(p.CODE);
      const kind = override ? (override.EFFECT === "GRANT" ? "grant" : "deny") : (employeeRoleCodes.has(p.CODE) ? "role" : "none");
      const checked = kind === "grant" || kind === "role";
      const rowClass = [
        styles.permLabel,
        checked ? styles.permLabelGranted : "",
        kind === "grant" ? styles.permLabelOverrideGrant : "",
        kind === "deny" ? styles.permLabelOverrideDeny : "",
      ].filter(Boolean).join(" ");

      return (
        <div key={p.CODE} className={rowClass}>
          <div className={styles.permContent}>
            <div className={styles.permCode}>{p.CODE}</div>
            <div className={styles.permName}>{p.NAME}</div>
            {p.DESCRIPTION && <div className={styles.permDesc}>{p.DESCRIPTION}</div>}
            <div className={styles.permStateBadge}>
              {kind === "grant" && "Employee-granted"}
              {kind === "deny" && "Employee-restricted"}
              {kind === "role" && "Role default"}
              {kind === "none" && "Not granted"}
            </div>
          </div>
          <div className={styles.permOverrideActions}>
            {kind !== "grant" && (
              <button type="button" className={styles.miniBtnGrant} onClick={() => setOverrideConfirm({ code: p.CODE, name: p.NAME, effect: "GRANT" })}>
                Grant
              </button>
            )}
            {kind !== "deny" && (
              <button type="button" className={styles.miniBtnDeny} onClick={() => setOverrideConfirm({ code: p.CODE, name: p.NAME, effect: "DENY" })}>
                Deny
              </button>
            )}
            {override && (
              <button
                type="button"
                className={styles.miniBtn}
                onClick={() => setRevertTarget({ permissionId: override.PERMISSION_ID, code: p.CODE })}
              >
                Revert
              </button>
            )}
          </div>
        </div>
      );
    }

    const granted = displayGrantedSet.has(p.CODE);
    return (
      <label
        key={p.CODE}
        className={`${styles.permLabel}${granted ? ` ${styles.permLabelGranted}` : ""}${isSuperAdminRole ? ` ${styles.permLabelLocked}` : ""}`}
      >
        <input
          type="checkbox"
          checked={granted}
          onChange={() => toggle(p.CODE)}
          disabled={isSuperAdminRole}
          className={styles.permCheckbox}
        />
        <div className={styles.permContent}>
          <div className={styles.permCode}>{p.CODE}</div>
          <div className={styles.permName}>{p.NAME}</div>
          {p.DESCRIPTION && <div className={styles.permDesc}>{p.DESCRIPTION}</div>}
        </div>
      </label>
    );
  }

  // ---- Render -------------------------------------------------------
  return (
    <div className={styles.page}>

      <PageHeader
        icon={RoleIcon}
        iconAlt="RBAC"
        title="RBAC Permissions"
        subtitle={
          mode === "roles"
            ? "Choose a role, then check or uncheck permissions to control exactly what its members can do."
            : "Choose an employee to grant or restrict specific permissions on top of their role's defaults."
        }
        actions={
          <>
            {canManageOverrides && (
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={`${styles.modeToggleBtn}${mode === "roles" ? ` ${styles.modeToggleBtnActive}` : ""}`}
                  onClick={() => { setMode("roles"); setMobilePane("roles"); }}
                >
                  Roles
                </button>
                <button
                  type="button"
                  className={`${styles.modeToggleBtn}${mode === "employees" ? ` ${styles.modeToggleBtnActive}` : ""}`}
                  onClick={() => { setMode("employees"); setMobilePane("roles"); }}
                >
                  Employees
                </button>
              </div>
            )}
          </>
        }
      />

      <StatsRow
        stats={
          mode === "roles"
            ? [
              { value: roles.length, label: "Roles" },
              { value: totalPermissions, label: "Permissions" },
              { value: totalMembers, label: "Employees covered" },
            ]
            : [
              { value: filteredEmployees.length, label: "Employees" },
              { value: employeeOverrides.filter((o) => o.EFFECT === "GRANT").length, label: "Active grants" },
              { value: employeeOverrides.filter((o) => o.EFFECT === "DENY").length, label: "Active restrictions" },
            ]
        }
      />

      {notice && (
        <div className={`${styles.notice} ${notice.type === "ok" ? styles.noticeOk : styles.noticeErr}`}>
          {notice.text}
        </div>
      )}

      <div className={`${styles.layout} ${styles["mobile_" + mobilePane]}`}>

        {/* LEFT: ROLES or EMPLOYEES */}
        <div className={`${styles.card} ${styles.rolesCard}`}>
          {mode === "roles" ? (
            <>
              <div className={styles.cardHeader}>Roles</div>
              {roles.length === 0 ? (
                <EmptyState
                  icon={RoleIcon}
                  iconAlt="Roles"
                  title={loading ? "Loading roles…" : "No roles yet"}
                  description={loading ? undefined : "Click \"+ New Role\" to create the first one."}
                />
              ) : (
                <div>
                  {roles.map((r) => {
                    const active = r.ID === selectedRoleId;
                    return (
                      <div
                        key={r.ID}
                        className={`${styles.roleRow}${active ? ` ${styles.roleRowActive}` : ""}`}
                      >
                        <button
                          onClick={() => {
                            setSelectedRoleId(r.ID);
                            setMobilePane("perms");
                          }}
                          className={styles.roleBtn}
                        >
                          <div className={styles.accentBar} />
                          <div className={styles.roleName}>{r.ROLE_NAME}</div>
                          <div className={styles.roleMeta}>
                            {r.permission_count} perms · {r.member_count} member{r.member_count === 1 ? "" : "s"}
                          </div>
                        </button>
                        <button
                          type="button"
                          className={styles.roleDeleteBtn}
                          onClick={() => setRoleToDelete(r)}
                          disabled={r.IS_SYSTEM}
                          title={r.IS_SYSTEM ? "System roles cannot be deleted" : `Delete ${r.ROLE_NAME}`}
                          aria-label={`Delete ${r.ROLE_NAME}`}
                        >
                          <img src={DeleteIcon} alt="" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.cardHeader}>Employees</div>
              <div className={styles.searchWrap}>
                <SearchBar
                  value={employeeSearch}
                  onChange={setEmployeeSearch}
                  placeholder="Search by name, code, role, department…"
                />
              </div>
              {filteredEmployees.length === 0 ? (
                <EmptyState title="No employees found" />
              ) : (
                <div>
                  {filteredEmployees.map((e) => {
                    const active = e.ID === selectedEmployeeId;
                    return (
                      <div
                        key={e.ID}
                        className={`${styles.roleRow}${active ? ` ${styles.roleRowActive}` : ""}`}
                      >
                        <button
                          onClick={() => {
                            setSelectedEmployeeId(e.ID);
                            setMobilePane("perms");
                          }}
                          className={styles.roleBtn}
                        >
                          <div className={styles.roleName}>{e.NAME}</div>
                          <div className={styles.roleMeta}>
                            {e.ROLE?.NAME || "No role"}{e.DEPARTMENT?.NAME ? ` · ${e.DEPARTMENT.NAME}` : ""}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT: PERMISSIONS */}
        <div className={`${styles.card} ${styles.permsCard}`}>

          {/* Mobile-only "back" button — CSS shows this only ≤ 768px */}
          <button
            type="button"
            className={styles.mobileBackBtn}
            onClick={() => setMobilePane("roles")}
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Back</span>
          </button>

          {mode === "roles" ? (
            <>
              <div className={styles.permPanelTop}>
                <div>
                  <div className={styles.cardHeader}>
                    Permissions {selectedRole ? `· ${selectedRole.ROLE_NAME}` : ""}
                  </div>
                  {selectedRole && (
                    <div className={styles.permCount}>
                      {displayGrantedSet.size} of {totalPermissions} granted
                      {isDirty && (
                        <span className={styles.permDirty}>
                          · unsaved: +{dirtyAdds.length} / -{dirtyRemoves.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className={styles.actionRow}>
                  <PMButton variant="outline" onClick={discardChanges} disabled={!isDirty || saving}>
                    Discard
                  </PMButton>
                  <PMButton variant="primary" onClick={save} disabled={!isDirty || saving} loading={saving}>
                    Save changes
                  </PMButton>
                </div>
              </div>

              {isSuperAdminRole && (
                <div className={styles.lockedNotice}>
                  SUPER_ADMIN has unconditional full access to every module. Its permissions are fixed and cannot be edited.
                </div>
              )}
            </>
          ) : (
            <div className={styles.permPanelTop}>
              <div>
                <div className={styles.cardHeader}>
                  Permissions {selectedEmployee ? `· ${selectedEmployee.NAME}` : ""}
                </div>
                {selectedEmployee && (
                  <div className={styles.permCount}>
                    Role: {selectedEmployee.ROLE?.NAME || "No role"} · {employeeOverrides.length} override{employeeOverrides.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            </div>
          )}

          {((mode === "roles" && selectedRoleId) || (mode === "employees" && selectedEmployeeId)) && totalPermissions > 0 && (
            <div className={styles.searchWrap}>
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder="Filter permissions by code, name or description…"
              />
            </div>
          )}

          {mode === "roles" && !selectedRoleId && (
            <EmptyState
              icon={RoleIcon}
              iconAlt="Permissions"
              title="Select a role"
              description="Choose a role on the left to view and edit its permissions."
            />
          )}

          {mode === "employees" && !selectedEmployeeId && (
            <EmptyState
              icon={RoleIcon}
              iconAlt="Permissions"
              title="Select an employee"
              description="Choose an employee on the left to grant or restrict their permissions."
            />
          )}

          {((mode === "roles" && selectedRoleId) || (mode === "employees" && selectedEmployeeId)) && totalPermissions === 0 && (
            <EmptyState
              title="No permissions configured yet"
              description="The permission catalogue is empty. Ask an administrator to run the permission seeding script."
            />
          )}

          {((mode === "roles" && selectedRoleId) || (mode === "employees" && selectedEmployeeId)) && totalPermissions > 0 &&
            filteredGroups.map((g) => {
              const codes = g.permissions.map((p) => p.CODE);
              const allOn = codes.every((c) => displayGrantedSet.has(c));
              return (
                <div key={g.category} className={styles.permGroup}>
                  <div className={styles.permGroupHeader}>
                    <span className={styles.permGroupLabel}>{g.category}</span>
                    {mode === "roles" && !isSuperAdminRole && (
                      <button
                        onClick={() => bulkSet(codes, !allOn)}
                        className={styles.miniBtn}
                      >
                        {allOn ? "Revoke all in group" : "Grant all in group"}
                      </button>
                    )}
                  </div>

                  {groupByPage(g.permissions).map((bucket, i) => (
                    <div key={bucket.page || `__none_${i}`}>
                      {bucket.page && (
                        <div className={styles.permPageLabel}>{bucket.page}</div>
                      )}
                      <div className={styles.permGrid}>
                        {bucket.permissions.map((p) => renderPermissionRow(p))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          }

          {((mode === "roles" && selectedRoleId) || (mode === "employees" && selectedEmployeeId)) &&
            totalPermissions > 0 && filteredGroups.length === 0 && (
              <EmptyState
                title={`No permissions match "${search}"`}
                description="Try a different search term."
              />
            )}
        </div>

      </div>

      {/* Delete-role confirmation */}
      <PMConfirmModal
        open={!!roleToDelete}
        onClose={() => !deleting && setRoleToDelete(null)}
        onConfirm={deleteRole}
        title="Delete role"
        description={
          roleToDelete
            ? `Delete role "${roleToDelete.ROLE_NAME}"? Employees with this role will need to be reassigned. This cannot be undone.`
            : ""
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
      />

      {/* Grant/Deny confirmation */}
      <PMConfirmModal
        open={!!overrideConfirm}
        onClose={() => !overrideBusy && setOverrideConfirm(null)}
        onConfirm={confirmOverride}
        title={overrideConfirm ? `${overrideConfirm.effect === "GRANT" ? "Grant" : "Deny"} "${overrideConfirm.code}"` : ""}
        description={
          overrideConfirm
            ? `${overrideConfirm.effect === "GRANT" ? "Grant" : "Deny"} "${overrideConfirm.code}" for ${selectedEmployee?.NAME || "this employee"}? They must re-login (or refresh their session) for this to take effect.`
            : ""
        }
        confirmLabel={
          overrideBusy
            ? "Saving…"
            : overrideConfirm?.effect === "GRANT" ? "Grant" : "Deny"
        }
      />

      {/* Revert-override confirmation */}
      <PMConfirmModal
        open={!!revertTarget}
        onClose={() => !overrideBusy && setRevertTarget(null)}
        onConfirm={revertOverride}
        title="Revert to role default"
        description={
          revertTarget
            ? `Remove this override for "${revertTarget.code}"? ${selectedEmployee?.NAME || "This employee"} will fall back to whatever their role grants.`
            : ""
        }
        confirmLabel={overrideBusy ? "Reverting…" : "Revert"}
      />

    </div>
  );
}
