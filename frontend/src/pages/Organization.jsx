import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import TablePagination from "../components/TablePagination";

import IconButton from "../components/IconButton";

const VENDOR_ID = 1;


function Organization() {

  const [tab, setTab] = useState("departments");

  return (

    <div>

      <h1>Organization Setup</h1>

      <p style={{ color: "#64748b", marginBottom: 18 }}>
        Define your company's departments, designations, and
        roles. This is the foundation — employees, projects,
        and permissions all build on top.
      </p>

      <SeedBar />

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          borderBottom: "1px solid #e5e7eb"
        }}
      >
        <Tab id="departments" current={tab} onSelect={setTab}>
          Departments
        </Tab>
        <Tab id="designations" current={tab} onSelect={setTab}>
          Designations
        </Tab>
        <Tab id="roles" current={tab} onSelect={setTab}>
          Roles & Permissions
        </Tab>
      </div>

      {tab === "departments" && <DepartmentsTab />}
      {tab === "designations" && <DesignationsTab />}
      {tab === "roles" && <RolesTab />}

    </div>
  );
}


function Tab({ id, current, onSelect, children }) {

  const active = id === current;

  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      style={{
        padding: "10px 18px",
        background: "transparent",
        border: "none",
        borderBottom: active
          ? "3px solid #2563eb"
          : "3px solid transparent",
        color: active ? "#2563eb" : "#64748b",
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        cursor: "pointer",
        marginBottom: -1
      }}
    >
      {children}
    </button>
  );
}


function SeedBar() {

  const [presets, setPresets] = useState([]);

  const [chosen, setChosen] = useState("MANUFACTURING");

  const [busy, setBusy] = useState(false);

  const [msg, setMsg] = useState(null);

  useEffect(() => {

    API.get("/org-presets")
      .then((r) => setPresets(r.data || []))
      .catch(() => {});

  }, []);

  const runSeed = async () => {

    setBusy(true);

    setMsg(null);

    try {

      const res = await API.post(
        `/seed-org?preset=${chosen}&vendor_id=${VENDOR_ID}`
      );

      setMsg({
        ok: true,
        text: `${res.data.message} — ` +
          `+${res.data.departments_added} depts, ` +
          `+${res.data.designations_added} designations, ` +
          `+${res.data.permissions_added} perms, ` +
          `+${res.data.roles_added} roles`
      });

    } catch (e) {

      setMsg({
        ok: false,
        text: e?.response?.data?.detail || "Seed failed"
      });

    } finally {

      setBusy(false);
    }
  };

  return (

    <div
      style={{
        background: "#f0f9ff",
        border: "1px solid #7dd3fc",
        borderRadius: 8,
        padding: 14,
        marginBottom: 18,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap"
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong style={{ color: "#0c4a6e" }}>
          One-click setup
        </strong>
        <div style={{ fontSize: 12, color: "#0369a1", marginTop: 2 }}>
          Pick an industry preset and we'll seed standard
          departments, designations, roles, and permissions.
          Idempotent — safe to re-run.
        </div>
      </div>

      <select
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        style={selectStyle}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={runSeed}
        disabled={busy}
        style={primaryBtnStyle}
      >
        {busy ? "Seeding…" : "Run seed"}
      </button>

      {msg && (
        <div
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 6,
            fontSize: 12,
            color: msg.ok ? "#166534" : "#b91c1c",
            background: msg.ok ? "#dcfce7" : "#fee2e2"
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}


// =========================
// DEPARTMENTS
// =========================

function DepartmentsTab() {

  const [rows, setRows] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [name, setName] = useState("");

  const [code, setCode] = useState("");

  const [description, setDescription] = useState("");

  // Per-row head selection state
  const [pendingHead, setPendingHead] = useState({});

  // Per-row save status (transient)
  const [savedHeadId, setSavedHeadId] = useState(null);

  const fetchRows = async () => {

    try {

      const r = await API.get(
        `/departments?vendor_id=${VENDOR_ID}`
      );

      setRows(r.data || []);

    } catch (e) { console.log(e); }
  };

  const fetchEmployees = async () => {

    try {

      const r = await API.get("/employees?status=ACTIVE");

      setEmployees(r.data || []);

    } catch (e) { console.log(e); }
  };

  useEffect(() => {

    fetchRows();

    fetchEmployees();

  }, []);

  const setHead = async (deptId, employeeId) => {

    try {

      await API.put(`/departments/${deptId}`, {
        HEAD_EMPLOYEE_ID: employeeId || null
      });

      setSavedHeadId(deptId);

      setTimeout(() => setSavedHeadId(null), 1500);

      fetchRows();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed to set head");
    }
  };

  const employeeName = (id) => {

    if (!id) return "—";

    const e = employees.find((x) => x.ID === id);

    return e ? `${e.NAME} (${e.EMPLOYEE_CODE})` : "—";
  };

  const add = async () => {

    if (!name.trim() || !code.trim()) {

      alert("Name and code are required");
      return;
    }

    try {

      await API.post("/departments", {
        NAME: name,
        CODE: code,
        DESCRIPTION: description || null,
        VENDOR_ID: VENDOR_ID
      });

      setName(""); setCode(""); setDescription("");

      fetchRows();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const remove = async (id) => {

    if (!window.confirm("Delete this department?")) return;

    try {

      await API.delete(`/departments/${id}`);

      fetchRows();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  return (

    <div>

      <div className="employee-form">
        <input
          type="text"
          placeholder="Department name (e.g. Welding)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Short code (e.g. WLD)"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button onClick={add}>Add Department</button>
      </div>

      <div className="table-wrapper">
        <table className="employee-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Code</th>
              <th>Name</th>
              <th style={{ minWidth: 260 }}>
                Head / Supervisor
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#6b7280" }}>
                No departments yet. Run the seed above or add manually.
              </td></tr>
            )}
            {rows.map((d) => {

              const currentValue =
                pendingHead[d.ID] !== undefined
                  ? pendingHead[d.ID]
                  : (d.HEAD_EMPLOYEE_ID || "");

              const isDirty =
                pendingHead[d.ID] !== undefined &&
                pendingHead[d.ID] !== (d.HEAD_EMPLOYEE_ID || "");

              const wasJustSaved = savedHeadId === d.ID;

              // Show every active non-admin employee as a candidate
              // head/supervisor. Admins manage the ERP — they don't
              // run departments — so filter their role names out
              // (matches the admin exclusion used by the project
              // task allocator). Same-dept employees float to the
              // top so picking the obvious choice stays fast.
              const isAdminRole = (e) => {

                const name = (
                  e.ROLE?.NAME ||
                  e.ROLE_NAME ||
                  ""
                ).toLowerCase();

                return [
                  "super_admin",
                  "admin",
                  "system_administrator",
                  "manager"
                ].includes(name);
              };

              const candidates = employees
                .filter((e) =>
                  !isAdminRole(e) || e.ID === d.HEAD_EMPLOYEE_ID
                )
                .sort((a, b) => {

                  const aMatch =
                    a.DEPARTMENT?.ID === d.ID ||
                    a.DEPARTMENT_ID === d.ID;

                  const bMatch =
                    b.DEPARTMENT?.ID === d.ID ||
                    b.DEPARTMENT_ID === d.ID;

                  if (aMatch !== bMatch) return aMatch ? -1 : 1;

                  return (a.NAME || "").localeCompare(b.NAME || "");
                });

              return (
              <tr key={d.ID}>
                <td>{d.ID}</td>
                <td><strong>{d.CODE}</strong></td>
                <td>{d.NAME}</td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap"
                    }}
                  >
                    <select
                      value={currentValue}
                      onChange={(e) =>
                        setPendingHead((p) => ({
                          ...p,
                          [d.ID]: e.target.value
                        }))
                      }
                      style={{
                        padding: "6px 10px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        background: "#fff",
                        fontSize: 13,
                        minWidth: 200
                      }}
                    >
                      <option value="">— no head set —</option>
                      {candidates.map((e) => {

                        const sameDept =
                          e.DEPARTMENT?.ID === d.ID ||
                          e.DEPARTMENT_ID === d.ID;

                        return (

                          <option key={e.ID} value={e.ID}>
                            {sameDept ? "★ " : ""}
                            {e.NAME} ({e.EMPLOYEE_CODE})
                            {sameDept ? " — same dept" : ""}
                          </option>
                        );
                      })}
                    </select>

                    <button
                      type="button"
                      onClick={() => setHead(d.ID, currentValue)}
                      disabled={!isDirty}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "none",
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: isDirty ? "pointer" : "default",
                        color: "white",
                        background: isDirty
                          ? "linear-gradient(135deg, #2563eb, #1e40af)"
                          : "#cbd5e1",
                        transition: "all 0.15s"
                      }}
                    >
                      Save
                    </button>

                    {wasJustSaved && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#16a34a",
                          fontWeight: 700
                        }}
                      >
                        ✓ saved
                      </span>
                    )}
                  </div>

                  {d.HEAD_EMPLOYEE_ID && !isDirty && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        marginTop: 4
                      }}
                    >
                      Current head:{" "}
                      <strong>{employeeName(d.HEAD_EMPLOYEE_ID)}</strong>
                    </div>
                  )}
                </td>
                <td>
                  <IconButton
                    variant="delete"
                    onClick={() => remove(d.ID)}
                    title="Delete"
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}


// =========================
// DESIGNATIONS
// =========================

function DesignationsTab() {

  const [rows, setRows] = useState([]);

  const [depts, setDepts] = useState([]);

  const [title, setTitle] = useState("");

  const [deptId, setDeptId] = useState("");

  const [salary, setSalary] = useState("");

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(25);

  const [filterDept, setFilterDept] = useState("");

  const fetchAll = async () => {

    try {

      const [desRes, dRes] = await Promise.all([
        API.get(`/designations?vendor_id=${VENDOR_ID}`),
        API.get(`/departments?vendor_id=${VENDOR_ID}`)
      ]);

      setRows(desRes.data || []);

      setDepts(dRes.data || []);

    } catch (e) { console.log(e); }
  };

  useEffect(() => { fetchAll(); }, []);

  const add = async () => {

    if (!title.trim() || !deptId) {

      alert("Title and department are required");
      return;
    }

    try {

      await API.post("/designations", {
        TITLE: title,
        DEPARTMENT_ID: Number(deptId),
        BASE_SALARY: Number(salary) || 0,
        VENDOR_ID: VENDOR_ID
      });

      setTitle(""); setSalary("");

      fetchAll();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const remove = async (id) => {

    if (!window.confirm("Delete this designation?")) return;

    try {

      await API.delete(`/designations/${id}`);

      fetchAll();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const visible = filterDept
    ? rows.filter((r) => String(r.DEPARTMENT_ID) === String(filterDept))
    : rows;

  useEffect(() => { setPage(1); }, [filterDept]);

  const pagedVisible = useMemo(
    () => visible.slice((page - 1) * pageSize, page * pageSize),
    [visible, page, pageSize]
  );

  return (

    <div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap"
        }}
      >
        <label style={{ fontWeight: 600, color: "#374151" }}>
          Filter by department:
        </label>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          style={selectStyle}
        >
          <option value="">All departments</option>
          {depts.map((d) => (
            <option key={d.ID} value={d.ID}>
              {d.NAME}
            </option>
          ))}
        </select>
      </div>

      <div className="employee-form">
        <input
          type="text"
          placeholder="Designation title (e.g. Senior Welder)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          value={deptId}
          onChange={(e) => setDeptId(e.target.value)}
          style={selectStyle}
        >
          <option value="">— Department —</option>
          {depts.map((d) => (
            <option key={d.ID} value={d.ID}>
              {d.NAME}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Base salary"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
        <button onClick={add}>Add Designation</button>
      </div>

      <div className="table-wrapper">
        <table className="employee-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Department</th>
              <th>Title</th>
              <th>Base Salary</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#6b7280" }}>
                No designations. Run the seed or add manually.
              </td></tr>
            )}
            {pagedVisible.map((d) => (
              <tr key={d.ID}>
                <td>{d.ID}</td>
                <td>{d.DEPARTMENT_NAME}</td>
                <td>{d.TITLE}</td>
                <td>₹ {Number(d.BASE_SALARY).toLocaleString()}</td>
                <td>
                  <IconButton
                    variant="delete"
                    onClick={() => remove(d.ID)}
                    title="Delete"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination
        total={visible.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

    </div>
  );
}


// =========================
// ROLES & PERMISSIONS
// =========================

function RolesTab() {

  const [roles, setRoles] = useState([]);

  const [permissions, setPermissions] = useState([]);

  const [activeRoleId, setActiveRoleId] = useState(null);

  const [selectedPerms, setSelectedPerms] = useState(new Set());

  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {

    try {

      const [rRes, pRes] = await Promise.all([
        API.get(`/roles?vendor_id=${VENDOR_ID}`),
        API.get(`/permissions`)
      ]);

      setRoles(rRes.data || []);

      setPermissions(pRes.data || []);

      if (rRes.data?.length && !activeRoleId) {

        const first = rRes.data[0];

        setActiveRoleId(first.ID);

        setSelectedPerms(new Set(first.PERMISSION_IDS));
      }

    } catch (e) { console.log(e); }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const selectRole = (r) => {

    setActiveRoleId(r.ID);

    setSelectedPerms(new Set(r.PERMISSION_IDS));
  };

  const toggle = (pid) => {

    setSelectedPerms((prev) => {

      const next = new Set(prev);

      if (next.has(pid)) next.delete(pid);
      else next.add(pid);

      return next;
    });
  };

  const save = async () => {

    if (!activeRoleId) return;

    setSaving(true);

    try {

      await API.put(`/roles/${activeRoleId}/permissions`, {
        PERMISSION_IDS: Array.from(selectedPerms)
      });

      await fetchAll();

      alert("Permissions saved");

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");

    } finally {

      setSaving(false);
    }
  };

  // Group permissions by category
  const byCategory = useMemo(() => {

    const acc = {};

    for (const p of permissions) {

      const cat = p.CATEGORY || "Other";

      if (!acc[cat]) acc[cat] = [];

      acc[cat].push(p);
    }

    return acc;

  }, [permissions]);

  const activeRole = roles.find((r) => r.ID === activeRoleId);

  return (

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        gap: 16
      }}
    >
      {/* Role list */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
          background: "#fff",
          maxHeight: "70vh",
          overflowY: "auto"
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "#64748b",
            textTransform: "uppercase",
            padding: "6px 8px",
            fontWeight: 700
          }}
        >
          Roles
        </div>

        {roles.length === 0 && (
          <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}>
            No roles yet. Run the seed above.
          </div>
        )}

        {roles.map((r) => {

          const isActive = r.ID === activeRoleId;

          return (
            <button
              key={r.ID}
              type="button"
              onClick={() => selectRole(r)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                marginBottom: 4,
                background: isActive ? "#eff6ff" : "transparent",
                border: "1px solid "
                  + (isActive ? "#2563eb" : "transparent"),
                borderRadius: 6,
                cursor: "pointer",
                color: "#0f172a",
                fontSize: 13,
                fontWeight: isActive ? 700 : 500
              }}
            >
              {r.ROLE_NAME}
              {r.IS_SYSTEM ? (
                <span
                  style={{
                    fontSize: 9,
                    marginLeft: 6,
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: "#dbeafe",
                    color: "#1e40af",
                    fontWeight: 600
                  }}
                >
                  SYSTEM
                </span>
              ) : null}
              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  fontWeight: 400,
                  marginTop: 2
                }}
              >
                {r.PERMISSION_IDS.length} permissions
              </div>
            </button>
          );
        })}
      </div>

      {/* Permission grid */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          background: "#fff"
        }}
      >
        {!activeRole && (
          <p style={{ color: "#6b7280", margin: 0 }}>
            Pick a role on the left to manage its permissions.
          </p>
        )}

        {activeRole && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>
                  {activeRole.ROLE_NAME}
                </h3>
                {activeRole.DESCRIPTION && (
                  <div
                    style={{ fontSize: 12, color: "#64748b" }}
                  >
                    {activeRole.DESCRIPTION}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={primaryBtnStyle}
              >
                {saving ? "Saving…" : "Save permissions"}
              </button>
            </div>

            {Object.keys(byCategory).sort().map((cat) => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#0f172a",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 6,
                    paddingBottom: 4,
                    borderBottom: "1px solid #e5e7eb"
                  }}
                >
                  {cat}
                </div>

                {byCategory[cat].map((p) => {

                  const isOn = selectedPerms.has(p.ID);

                  return (
                    <label
                      key={p.ID}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "6px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: isOn ? "#f0fdf4" : "transparent"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(p.ID)}
                        style={{ marginTop: 3 }}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#0f172a"
                          }}
                        >
                          {p.NAME}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            fontFamily: "monospace"
                          }}
                        >
                          {p.CODE}
                          {p.DESCRIPTION ? " — " + p.DESCRIPTION : ""}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}


const selectStyle = {
  padding: "10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 14,
  minWidth: 180
};


const primaryBtnStyle = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer"
};


export default Organization;
