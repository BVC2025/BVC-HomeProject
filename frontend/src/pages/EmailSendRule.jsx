import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PageHeader, EmptyState, Loader, PMButton, PMSelect } from "../components/pm";
import { emailSendRuleService } from "../services/emailSendRuleService";
import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { employeeService } from "../services/employeeService";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";
import MailIcon from "../assets/Icons/mailIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./LeadManagementConfig.module.css";

const EVENT_OPTIONS = [
  { value: "QUOTATION_DECISION", label: "Customer Quotation Approval / Rejection" },
  { value: "PO_REQUESTED", label: "Purchase Order Requested / Re-requested" },
  { value: "PO_UPLOADED", label: "Purchase Order Uploaded / Reuploaded" },
];

const LEAD_OWNER_ID = "__LEAD_OWNER__";

export default function EmailSendRule() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("system.email_send_rule.manage");

  const [eventType, setEventType] = useState("QUOTATION_DECISION");
  const [recipients, setRecipients] = useState([]); // [{EMPLOYEE_ID, IS_LEAD_OWNER}]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [allDepartments, setAllDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const refDataRef = useRef(false);

  const [deptId, setDeptId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [employeeChoice, setEmployeeChoice] = useState("");

  useEffect(() => {
    if (refDataRef.current) return;
    refDataRef.current = true;
    Promise.all([departmentService.getAll(), roleService.getAll(), employeeService.getAll({ status: "ACTIVE" })])
      .then(([deptRes, roleRes, empRes]) => {
        setAllDepartments(deptRes.data || []);
        setAllRoles(roleRes.data || []);
        setAllEmployees(empRes.data || []);
      })
      .catch(() => toast.showError("Failed to load Department/Role/Employee reference data"));
  }, [toast]);

  const empByIdMap = useMemo(
    () => Object.fromEntries(allEmployees.map((e) => [e.ID, e])),
    [allEmployees]
  );

  const load = useCallback(async (evt) => {
    setLoading(true);
    try {
      const res = await emailSendRuleService.getByEvent(evt);
      setRecipients((res.data?.RECIPIENTS || []).map((r) => ({
        EMPLOYEE_ID: r.EMPLOYEE_ID || null,
        IS_LEAD_OWNER: !!r.IS_LEAD_OWNER,
      })));
    } catch {
      toast.showError("Failed to load email send rule");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // `load` is deliberately excluded — it's a useCallback that depends on
  // `toast`, which useToast() recreates (new object/functions) on every
  // render. Depending on `load` here would re-run this effect on every
  // render (new toast -> new load -> effect fires -> setLoading -> render
  // -> ...), flickering the loader forever. `eventType` is the only real
  // trigger for a refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(eventType); }, [eventType]);

  const rolesForDept = useCallback(
    (id) => (id ? allRoles.filter((r) => String(r.DEPARTMENT_ID) === String(id)) : allRoles),
    [allRoles]
  );
  const employeesForFilters = useCallback(
    (dId, rId) => allEmployees.filter((e) =>
      (!dId || String(e.DEPARTMENT_ID) === String(dId)) &&
      (!rId || String(e.ROLE_ID) === String(rId))
    ),
    [allEmployees]
  );

  const employeeOptions = useMemo(() => {
    // Flag employees with no email on file right in the picker, before
    // they're added — they'd otherwise be silently skipped at send time.
    const base = employeesForFilters(deptId, roleId).map((e) => ({
      ID: e.ID,
      _label: (e.EMAIL || "").trim() ? e.NAME : `${e.NAME} (no email on file)`,
    }));
    return [{ ID: LEAD_OWNER_ID, _label: "Lead Owner" }, ...base];
  }, [employeesForFilters, deptId, roleId]);

  const handleDeptChange = useCallback((v) => {
    setDeptId(v || ""); setRoleId(""); setEmployeeChoice("");
  }, []);
  const handleRoleChange = useCallback((v) => {
    setRoleId(v || ""); setEmployeeChoice("");
  }, []);

  const handleAddRecipient = useCallback(() => {
    if (!employeeChoice) return;
    if (employeeChoice === LEAD_OWNER_ID) {
      if (recipients.some((r) => r.IS_LEAD_OWNER)) {
        toast.showWarning("Lead Owner is already in the recipient list.");
        return;
      }
      setRecipients((prev) => [...prev, { EMPLOYEE_ID: null, IS_LEAD_OWNER: true }]);
    } else {
      if (recipients.some((r) => r.EMPLOYEE_ID === employeeChoice)) {
        toast.showWarning("This employee is already in the recipient list.");
        return;
      }
      setRecipients((prev) => [...prev, { EMPLOYEE_ID: employeeChoice, IS_LEAD_OWNER: false }]);
    }
    setEmployeeChoice("");
  }, [employeeChoice, recipients, toast]);

  const handleRemoveRecipient = useCallback((index) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        RECIPIENTS: recipients.map((r) =>
          r.IS_LEAD_OWNER ? { IS_LEAD_OWNER: true } : { EMPLOYEE_ID: r.EMPLOYEE_ID }
        ),
      };
      await emailSendRuleService.update(eventType, body);
      toast.showSuccess("Email send rule saved");
      load(eventType);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [recipients, eventType, load, toast]);

  const recipientLabel = useCallback((r) => {
    if (r.IS_LEAD_OWNER) return "Lead Owner (resolved per-lead automatically)";
    return empByIdMap[r.EMPLOYEE_ID]?.NAME || "Unknown employee (inactive or removed)";
  }, [empByIdMap]);

  // Requirement: the UI must make it clear when a configured recipient
  // can't actually receive the notification because their Employee record
  // has no email address on file — the backend already skips them silently
  // (with a server-side log entry) rather than failing the whole send, but
  // that's invisible to whoever configured the rule without this.
  const recipientEmailWarning = useCallback((r) => {
    if (r.IS_LEAD_OWNER) return null; // resolved dynamically per lead — can't validate in advance
    const emp = empByIdMap[r.EMPLOYEE_ID];
    if (emp && !(emp.EMAIL || "").trim()) {
      return "No email address on file for this employee — they will not receive this notification.";
    }
    return null;
  }, [empByIdMap]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={MailIcon}
        iconAlt="Email Send Rule"
        title="Email Send Rule"
        subtitle="Configure which employees are notified by email when a customer approves or rejects a quotation"
      />

      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <div className={styles.settingsCardIconWrap}>
            <img src={MailIcon} alt="" />
          </div>
          <div className={styles.settingsCardHeaderText}>
            <h3 className={styles.settingsCardTitle}>Email Send Rule</h3>
            <p className={styles.settingsCardSubtitle}>
              Pick an event, then choose which employees — or the dynamic "Lead Owner" placeholder —
              get notified by email when it happens.
            </p>
          </div>
          {!loading && (
            <span className={styles.settingsCardStatusPill} data-active={recipients.length > 0}>
              <span className={styles.statusDot} />
              {recipients.length > 0 ? `${recipients.length} Recipient${recipients.length !== 1 ? "s" : ""}` : "Not Configured"}
            </span>
          )}
        </div>

        <div className={styles.settingsCardBody}>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>Rule / Event</label>
              <PMSelect
                options={EVENT_OPTIONS}
                value={eventType}
                onChange={(v) => setEventType(v || "QUOTATION_DECISION")}
                valueKey="value"
                labelKey="label"
              />
            </div>
          </div>

          <hr className={styles.settingsCardDivider} />

          <h4 className={styles.settingsCardSectionTitle}>Recipients</h4>
          <p className={styles.hint}>
            Department and Role are search filters to help you find an employee — the saved recipient is
            always a specific employee, or the dynamic "Lead Owner" placeholder (resolved to whichever
            employee owns the specific Lead at send time).
          </p>

          {canManage && (
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Department</label>
                <PMSelect
                  options={allDepartments}
                  value={deptId}
                  onChange={handleDeptChange}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="All Departments"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Role</label>
                <PMSelect
                  options={rolesForDept(deptId)}
                  value={roleId}
                  onChange={handleRoleChange}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="All Roles"
                />
              </div>
              <div className={styles.formGroup}>
                <label>User / Employee</label>
                <PMSelect
                  options={employeeOptions}
                  value={employeeChoice}
                  onChange={(v) => setEmployeeChoice(v || "")}
                  valueKey="ID"
                  labelKey="_label"
                  allowClear
                  clearLabel="— Select —"
                  placeholder="Search employees…"
                />
              </div>
              <div className={styles.formGroup}>
                <label>&nbsp;</label>
                <PMButton variant="outline" onClick={handleAddRecipient} disabled={!employeeChoice}>
                  Add Recipient
                </PMButton>
              </div>
            </div>
          )}

          {loading ? (
            <Loader />
          ) : recipients.length === 0 ? (
            <EmptyState
              icon={MailIcon}
              iconAlt="Recipients"
              title="No recipients configured"
              description="Add at least one recipient above so internal staff are notified when a customer responds to a quotation."
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r, i) => (
                    <tr key={r.IS_LEAD_OWNER ? "lead-owner" : r.EMPLOYEE_ID}>
                      <td>
                        {recipientLabel(r)}
                        {recipientEmailWarning(r) && (
                          <div className={styles.recipientWarning}>{recipientEmailWarning(r)}</div>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnDanger} onClick={() => handleRemoveRecipient(i)} title="Remove">
                              <img src={DeleteIcon} alt="Remove" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <div style={{ marginTop: "var(--sp-4)" }}>
              <PMButton variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Rule"}
              </PMButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
