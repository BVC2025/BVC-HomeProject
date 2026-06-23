import { useEffect, useMemo, useState, useCallback } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./EmployeeOnboardingReview.module.css";


// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const STATUS_TABS = [
  { key: "ALL",       label: "All",       color: "#475569" },
  { key: "OPEN",      label: "Open",      color: "#0284c7" },
  { key: "SUBMITTED", label: "Submitted", color: "#d97706" },
  { key: "APPROVED",  label: "Approved",  color: "#16a34a" },
  { key: "REJECTED",  label: "Rejected",  color: "#dc2626" },
  { key: "EXPIRED",   label: "Expired",   color: "#94a3b8" }
];


const STATUS_THEMES = {
  OPEN:      { bg: "#e0f2fe", fg: "#075985" },
  SUBMITTED: { bg: "#fef3c7", fg: "#92400e" },
  APPROVED:  { bg: "#dcfce7", fg: "#166534" },
  REJECTED:  { bg: "#fee2e2", fg: "#991b1b" },
  EXPIRED:   { bg: "#f1f5f9", fg: "#475569" }
};


// ---------------------------------------------------------------------
// Toast — small ephemeral notification (top-right)
// ---------------------------------------------------------------------

function Toast({ toast, onDismiss }) {

  useEffect(() => {

    if (!toast) return;

    const t = setTimeout(() => onDismiss?.(), 4200);

    return () => clearTimeout(t);

  }, [toast, onDismiss]);

  if (!toast) return null;

  return (

    <div className={`${styles.toast} ${toast.kind === "error" ? styles.toastError : styles.toastOk}`}>
      {toast.msg}
    </div>
  );
}


// ---------------------------------------------------------------------
// Avatar / pill helpers
// ---------------------------------------------------------------------

function initials(name) {

  return (name || "")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}


function StatusPill({ status }) {

  const t = STATUS_THEMES[status] || STATUS_THEMES.OPEN;

  return (

    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {status || "—"}
    </span>
  );
}


function ProgressBar({ pct }) {

  const v = Math.max(0, Math.min(100, Number(pct) || 0));

  return (

    <div className={styles.progressTrack}>
      <div
        className={`${styles.progressFill} ${v >= 100 ? styles.progressFillDone : styles.progressFillPartial}`}
        style={{ width: `${v}%` }}
      />
      <div className={styles.progressLabel}>
        {v}% complete
      </div>
    </div>
  );
}


function PhotoThumb({ photoUrl, name, size = 48 }) {

  const full = photoUrl ? `${API_BASE_URL}${photoUrl}` : null;

  if (full) {

    return (

      <img
        src={full}
        alt={name || ""}
        className={styles.photoThumb}
        style={{ width: size, height: size }}
      />
    );
  }

  return (

    <div
      className={styles.photoInitials}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}


// ---------------------------------------------------------------------
// Session card — used in the list view
// ---------------------------------------------------------------------

function SessionCard({ session, onView, onResend, onDelete }) {

  const sub = session.submitted_at
    ? `Submitted ${new Date(session.submitted_at).toLocaleString("en-IN")}`
    : session.created_at
      ? `Invited ${new Date(session.created_at).toLocaleString("en-IN")}`
      : "—";

  return (

    <div className={styles.sessionCard}>
      <PhotoThumb
        photoUrl={session.photo_url}
        name={session.invited_name}
        size={56}
      />

      <div className={styles.cardBody}>

        <div className={styles.cardNameRow}>
          <div className={styles.cardName}>
            {session.invited_name || (
              <span className={styles.cardNameMuted}>
                (no name yet)
              </span>
            )}
          </div>
          <StatusPill status={session.status} />
          {session.employee_code && (
            <span className={styles.empCodeChip}>
              {session.employee_code}
            </span>
          )}
        </div>

        <div className={styles.cardContact}>
          {session.invited_email && <>✉️ {session.invited_email}</>}
          {session.invited_email && session.invited_phone && <>{" · "}</>}
          {session.invited_phone && <>📞 {session.invited_phone}</>}
          {!session.invited_email && !session.invited_phone && (
            <span className={styles.cardContactMuted}>No contact yet</span>
          )}
        </div>

        <div className={styles.cardMeta}>
          {sub}
        </div>

        <ProgressBar pct={session.progress_pct} />

        <div className={styles.cardActions}>
          <button
            onClick={() => onView(session)}
            className={styles.btnView}
          >
            🔍 View
          </button>
          {session.status !== "APPROVED" && (
            <button
              onClick={() => onResend(session)}
              className={styles.btnResend}
            >
              🔄 Resend
            </button>
          )}
          {session.status !== "APPROVED" && (
            <button
              onClick={() => onDelete(session)}
              className={styles.btnDelete}
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Drawer — full detail + admin overrides + approve/reject
// ---------------------------------------------------------------------

function SessionDrawer({
  sessionId,
  onClose,
  onApproved,
  onPatched,
  onRejected,
  showToast
}) {

  const [loading, setLoading]   = useState(true);

  const [detail, setDetail]     = useState(null);

  const [error, setError]       = useState("");

  const [roles, setRoles]               = useState([]);

  const [departments, setDepartments]   = useState([]);

  const [designations, setDesignations] = useState([]);

  const [showChat, setShowChat] = useState(false);

  // Admin override form (org block + notes)
  const [orgForm, setOrgForm] = useState({
    ROLE_ID: "",
    DEPARTMENT_ID: "",
    DESIGNATION_ID: "",
    SALARY: "",
    SHIFT_START: "",
    SHIFT_END: ""
  });

  const [employeeCode, setEmployeeCode] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving]     = useState(false);

  const [approving, setApproving] = useState(false);

  const [rejecting, setRejecting] = useState(false);

  // ESC closes the drawer
  useEffect(() => {

    const onKey = (e) => {

      if (e.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [onClose]);

  // Load detail + dropdowns
  useEffect(() => {

    let cancelled = false;

    setLoading(true);

    setError("");

    Promise.all([
      API.get(`/employee-onboarding/sessions/${sessionId}`),
      API.get("/roles").catch(() => ({ data: [] })),
      API.get("/departments").catch(() => ({ data: [] })),
      API.get("/designations").catch(() => ({ data: [] }))
    ])
      .then(([d, r, dp, dg]) => {

        if (cancelled) return;

        setDetail(d.data);

        setRoles(r.data || []);

        setDepartments(dp.data || []);

        setDesignations(dg.data || []);

        // Seed form from existing __admin__ overrides (if any)
        const collected = d.data?.collected_data || {};

        const adminBlock = collected.__admin__ || {};

        const org = adminBlock.ORG || {};

        setOrgForm({
          ROLE_ID:        org.ROLE_ID        ?? "",
          DEPARTMENT_ID:  org.DEPARTMENT_ID  ?? "",
          DESIGNATION_ID: org.DESIGNATION_ID ?? "",
          SALARY:         org.SALARY        ?? "",
          SHIFT_START:    org.SHIFT_START   ?? "",
          SHIFT_END:      org.SHIFT_END     ?? ""
        });

        setEmployeeCode(d.data?.employee_code || "");

        setNotes(d.data?.notes || "");

      })
      .catch((err) => {

        if (cancelled) return;

        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Could not load session."
        );

      })
      .finally(() => {

        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };

  }, [sessionId]);

  const collected = detail?.collected_data || {};

  const adminBlock = collected.__admin__ || {};

  // Effective values blend admin overrides on top of chat answers
  const eff = (key) => {

    if (adminBlock && adminBlock[key] !== undefined
        && adminBlock[key] !== null && adminBlock[key] !== "") {

      return adminBlock[key];
    }

    return collected[key];
  };

  const set = (k) => (e) => setOrgForm((f) => ({ ...f, [k]: e.target.value }));

  const buildPatchBody = () => ({
    NOTES: notes || null,
    EMPLOYEE_CODE: employeeCode || null,
    ORG: {
      ROLE_ID:        orgForm.ROLE_ID        ? Number(orgForm.ROLE_ID)        : null,
      DEPARTMENT_ID:  orgForm.DEPARTMENT_ID  ? Number(orgForm.DEPARTMENT_ID)  : null,
      DESIGNATION_ID: orgForm.DESIGNATION_ID ? Number(orgForm.DESIGNATION_ID) : null,
      SALARY:         orgForm.SALARY        ? Number(orgForm.SALARY)        : null,
      SHIFT_START:    orgForm.SHIFT_START   || null,
      SHIFT_END:      orgForm.SHIFT_END     || null
    }
  });

  const handleSave = async () => {

    setSaving(true);

    try {

      const res = await API.patch(
        `/employee-onboarding/sessions/${sessionId}`,
        buildPatchBody()
      );

      setDetail((prev) => ({
        ...prev,
        ...res.data?.session,
        collected_data: res.data?.collected_data || prev?.collected_data,
        notes: res.data?.notes ?? prev?.notes
      }));

      onPatched?.();

      showToast?.({ kind: "ok", msg: "Changes saved." });

    } catch (err) {

      showToast?.({
        kind: "error",
        msg: err?.response?.data?.detail || "Could not save changes."
      });

    } finally {

      setSaving(false);
    }
  };

  const handleApprove = async () => {

    if (!orgForm.ROLE_ID) {

      showToast?.({ kind: "error", msg: "Pick a Role before approving." });

      return;
    }

    setApproving(true);

    try {

      // Persist current overrides first so the backend has them.
      await API.patch(
        `/employee-onboarding/sessions/${sessionId}`,
        buildPatchBody()
      );

      const res = await API.post(
        `/employee-onboarding/sessions/${sessionId}/approve`,
        {
          EMPLOYEE_CODE: employeeCode || null,
          ORG: {
            ROLE_ID:        orgForm.ROLE_ID        ? Number(orgForm.ROLE_ID)        : null,
            DEPARTMENT_ID:  orgForm.DEPARTMENT_ID  ? Number(orgForm.DEPARTMENT_ID)  : null,
            DESIGNATION_ID: orgForm.DESIGNATION_ID ? Number(orgForm.DESIGNATION_ID) : null,
            SALARY:         orgForm.SALARY        ? Number(orgForm.SALARY)        : null,
            SHIFT_START:    orgForm.SHIFT_START   || null,
            SHIFT_END:      orgForm.SHIFT_END     || null
          }
        }
      );

      const code = res.data?.employee_code || "—";

      showToast?.({ kind: "ok", msg: `Employee created — ${code}` });

      onApproved?.();

    } catch (err) {

      showToast?.({
        kind: "error",
        msg: err?.response?.data?.detail || "Could not approve."
      });

    } finally {

      setApproving(false);
    }
  };

  const handleReject = async () => {

    const reason = window.prompt(
      "Reason for rejection? (required, will be stored on the session)"
    );

    if (reason === null) return;

    const trimmed = reason.trim();

    if (!trimmed) {

      showToast?.({ kind: "error", msg: "A reason is required to reject." });

      return;
    }

    setRejecting(true);

    try {

      await API.post(
        `/employee-onboarding/sessions/${sessionId}/reject`,
        { reason: trimmed }
      );

      showToast?.({ kind: "ok", msg: "Session rejected." });

      onRejected?.();

    } catch (err) {

      showToast?.({
        kind: "error",
        msg: err?.response?.data?.detail || "Could not reject."
      });

    } finally {

      setRejecting(false);
    }
  };

  const canApprove = !!orgForm.ROLE_ID
    && detail?.status === "SUBMITTED"
    && !approving;

  return (

    <div
      onClick={onClose}
      className={styles.drawerOverlay}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.drawer}
      >

        {/* Sticky header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <PhotoThumb
              photoUrl={detail?.photo_url}
              name={detail?.invited_name || eff("NAME")}
              size={56}
            />
            <div className={styles.drawerHeaderMeta}>
              <div className={styles.drawerHeaderTag}>
                ONBOARDING REVIEW
              </div>
              <div className={styles.drawerHeaderName}>
                {detail?.invited_name || eff("NAME") || "(no name yet)"}
              </div>
              <div className={styles.drawerHeaderPillRow}>
                {detail?.status && <StatusPill status={detail.status} />}
                {detail?.employee_code && (
                  <span className={styles.drawerEmpCode}>
                    {detail.employee_code}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className={styles.drawerCloseBtn}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className={styles.drawerBody}>

          {loading && (
            <div className={styles.drawerLoading}>
              Loading session…
            </div>
          )}

          {error && !loading && (
            <div className={styles.drawerError}>
              ⚠ {error}
            </div>
          )}

          {!loading && detail && (
            <>

              {/* Profile / Contact / Address */}
              <DrawerCard title="Profile">
                <Grid2>
                  <DRow label="Name"        value={eff("NAME")} />
                  <DRow label="Email"       value={eff("EMAIL")} />
                  <DRow label="Phone"       value={eff("PHONE")} />
                  <DRow label="Date of birth" value={eff("DOB")} />
                  <DRow label="Gender"      value={eff("GENDER")} />
                  <DRow label="Marital"     value={eff("MARITAL_STATUS")} />
                  <DRow label="Father"      value={eff("FATHER_NAME")} />
                  <DRow label="Mother"      value={eff("MOTHER_NAME")} />
                </Grid2>
              </DrawerCard>

              <DrawerCard title="Address">
                <Grid2>
                  <DRow label="Address" value={eff("ADDRESS")} wide />
                  <DRow label="City"    value={eff("CITY")} />
                  <DRow label="State"   value={eff("STATE")} />
                  <DRow label="Pincode" value={eff("PINCODE")} />
                </Grid2>
              </DrawerCard>

              <DrawerCard title="Education">
                <Grid2>
                  <DRow label="Qualification" value={eff("QUALIFICATION")} />
                  <DRow label="Year of passing" value={eff("YEAR_OF_PASSING")} />
                </Grid2>
              </DrawerCard>

              <DrawerCard title="Professional">
                <Grid2>
                  <DRow label="Type"       value={eff("EMPLOYMENT_TYPE")} />
                  <DRow label="Experience" value={eff("EXPERIENCE_YEARS")} />
                  <DRow label="Occupation" value={eff("OCCUPATION")} />
                  <DRow label="Skills"     value={eff("SKILLS")} wide />
                  <DRow label="Past experience" value={eff("EXPERIENCE_DETAILS")} wide />
                  <DRow label="Past projects"   value={eff("PAST_PROJECTS")} wide />
                </Grid2>
              </DrawerCard>

              {/* Chat history (collapsible) */}
              <DrawerCard
                title={`Chat history (${(detail.chat_history || []).length} messages)`}
                action={
                  <button
                    onClick={() => setShowChat((v) => !v)}
                    className={styles.chatToggleBtn}
                  >
                    {showChat ? "▲ Hide" : "▼ Show"}
                  </button>
                }
              >
                {showChat && (
                  <div className={styles.chatHistoryScroll}>
                    {(detail.chat_history || []).length === 0 && (
                      <div className={styles.chatHistoryEmpty}>
                        No chat messages yet.
                      </div>
                    )}
                    {(detail.chat_history || []).map((m, i) => (
                      <ChatBubble key={i} entry={m} />
                    ))}
                  </div>
                )}
              </DrawerCard>

              {/* Admin override section */}
              <DrawerCard
                title="⚙ Admin override — organization assignment (required for approval)"
                accent="#ef4444"
              >
                <Grid2>
                  <Field label="Role *">
                    <select
                      value={orgForm.ROLE_ID}
                      onChange={set("ROLE_ID")}
                      className={styles.formInput}
                    >
                      <option value="">— pick a role —</option>
                      {roles.map((r) => (
                        <option key={r.ID} value={r.ID}>
                          {r.ROLE_NAME}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Department">
                    <select
                      value={orgForm.DEPARTMENT_ID}
                      onChange={set("DEPARTMENT_ID")}
                      className={styles.formInput}
                    >
                      <option value="">— pick a department —</option>
                      {departments.map((d) => (
                        <option key={d.ID} value={d.ID}>{d.NAME}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Designation">
                    <select
                      value={orgForm.DESIGNATION_ID}
                      onChange={set("DESIGNATION_ID")}
                      className={styles.formInput}
                    >
                      <option value="">— pick a designation —</option>
                      {designations.map((d) => (
                        <option key={d.ID} value={d.ID}>{d.TITLE}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Salary (₹ / month)">
                    <input
                      type="number"
                      min="0"
                      value={orgForm.SALARY}
                      onChange={set("SALARY")}
                      placeholder="0"
                      className={styles.formInput}
                    />
                  </Field>
                  <Field label="Shift start">
                    <input
                      type="time"
                      value={orgForm.SHIFT_START}
                      onChange={set("SHIFT_START")}
                      className={styles.formInput}
                    />
                  </Field>
                  <Field label="Shift end">
                    <input
                      type="time"
                      value={orgForm.SHIFT_END}
                      onChange={set("SHIFT_END")}
                      className={styles.formInput}
                    />
                  </Field>
                  <Field label="Employee Code">
                    <input
                      type="text"
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                      placeholder="EMP015"
                      className={styles.formInput}
                    />
                  </Field>
                </Grid2>
              </DrawerCard>

              <DrawerCard title="Admin notes">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Private notes about this candidate…"
                  className={styles.formInput}
                />
              </DrawerCard>

              {detail.reject_reason && (
                <div className={styles.rejectNotice}>
                  ⚠ Rejection reason on record: {detail.reject_reason}
                </div>
              )}

            </>
          )}

        </div>

        {/* Sticky footer with actions */}
        {!loading && detail && (
          <div className={styles.drawerFooter}>
            <button
              onClick={handleSave}
              disabled={saving}
              className={styles.footerBtnSave}
            >
              {saving ? "Saving…" : "💾 Save Changes"}
            </button>
            <button
              onClick={handleReject}
              disabled={rejecting || detail.status === "APPROVED" || detail.status === "REJECTED"}
              className={styles.footerBtnReject}
            >
              {rejecting ? "Rejecting…" : "✕ Reject"}
            </button>
            <button
              onClick={handleApprove}
              disabled={!canApprove}
              title={!orgForm.ROLE_ID ? "Pick a Role first" : "Approve onboarding"}
              className={styles.footerBtnApprove}
            >
              {approving ? "Approving…" : "✓ Approve"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Drawer subcomponents
// ---------------------------------------------------------------------

function ChatBubble({ entry }) {

  const role = entry?.role || "system";

  const text = entry?.content || entry?.message || entry?.text || "";

  const isUser = role === "user";

  const isAssistant = role === "assistant";

  return (

    <div className={`${styles.chatBubbleRow} ${isUser ? styles.chatBubbleRowUser : styles.chatBubbleRowAssistant}`}>
      <div className={isUser ? styles.chatBubbleUser : isAssistant ? styles.chatBubbleAssistant : styles.chatBubbleSystem}>
        <div className={styles.chatBubbleRole}>
          {isUser ? "Candidate" : isAssistant ? "AI Assistant" : "System"}
        </div>
        <div className={styles.chatBubbleText}>
          {text || <span style={{ opacity: 0.5 }}>(empty)</span>}
        </div>
      </div>
    </div>
  );
}


function DrawerCard({ title, action, children, accent }) {

  return (

    <div
      className={styles.drawerCard}
      style={accent ? { borderLeft: `4px solid ${accent}` } : undefined}
    >
      <div className={styles.drawerCardHeader}>
        <div className={styles.drawerCardTitle}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}


function Grid2({ children }) {

  return (

    <div className={styles.grid2}>
      {children}
    </div>
  );
}


function DRow({ label, value, wide }) {

  if (value === undefined || value === null || value === "") {

    return null;
  }

  return (

    <div className={wide ? styles.dRowWide : undefined}>
      <div className={styles.dRowLabel}>
        {label}
      </div>
      <div className={styles.dRowValue}>
        {String(value)}
      </div>
    </div>
  );
}


function Field({ label, children }) {

  return (

    <div>
      <label className={styles.fieldLabel}>
        {label}
      </label>
      {children}
    </div>
  );
}


// ---------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------

function EmployeeOnboardingReview() {

  const [sessions, setSessions] = useState([]);

  const [loading, setLoading]   = useState(true);

  const [statusTab, setStatusTab] = useState("ALL");

  const [search, setSearch]     = useState("");

  const [openId, setOpenId]     = useState(null);

  const [toast, setToast]       = useState(null);

  const fetchAll = useCallback(() => {

    setLoading(true);

    API.get("/employee-onboarding/sessions")
      .then((r) => setSessions(Array.isArray(r.data) ? r.data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));

  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const counts = useMemo(() => {

    const c = { ALL: sessions.length };

    STATUS_TABS.forEach((t) => {

      if (t.key === "ALL") return;

      c[t.key] = sessions.filter((s) => s.status === t.key).length;
    });

    return c;

  }, [sessions]);

  const filtered = useMemo(() => {

    const q = search.trim().toLowerCase();

    return sessions.filter((s) => {

      if (statusTab !== "ALL" && s.status !== statusTab) return false;

      if (!q) return true;

      const hay = [
        s.invited_name,
        s.invited_email,
        s.invited_phone,
        s.employee_code
      ].filter(Boolean).join(" ").toLowerCase();

      return hay.includes(q);
    });

  }, [sessions, statusTab, search]);

  const showToast = useCallback((t) => setToast(t), []);

  const dismissToast = useCallback(() => setToast(null), []);

  const handleResend = async (session) => {

    if (!window.confirm(
      `Generate a fresh invite link for "${session.invited_name || "this candidate"}"?\n\n`
      + `The old link will stop working immediately.`
    )) return;

    try {

      const res = await API.post(
        `/employee-onboarding/sessions/${session.id}/resend-link`
      );

      try {

        await navigator.clipboard.writeText(res.data?.invite_link || "");

      } catch { /* clipboard could be blocked */ }

      showToast({
        kind: "ok",
        msg: "New invite link generated and copied to clipboard."
      });

      fetchAll();

    } catch (err) {

      showToast({
        kind: "error",
        msg: err?.response?.data?.detail || "Could not resend link."
      });
    }
  };

  const handleDelete = async (session) => {

    if (!window.confirm(
      `Delete onboarding session for "${session.invited_name || "this candidate"}"?\n\n`
      + `This cannot be undone. Chat history and the link will be removed.`
    )) return;

    try {

      await API.delete(`/employee-onboarding/sessions/${session.id}`);

      showToast({ kind: "ok", msg: "Session deleted." });

      fetchAll();

    } catch (err) {

      showToast({
        kind: "error",
        msg: err?.response?.data?.detail || "Could not delete session."
      });
    }
  };

  return (

    <div className={styles.page}>

      <Toast toast={toast} onDismiss={dismissToast} />

      {/* Hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroLabel}>
            BVC24 · HR Onboarding
          </div>
          <h1 className={styles.heroTitle}>
            Employee Onboarding Review
          </h1>
          <div className={styles.heroSubtitle}>
            Review what the candidate filled out, fix anything that
            needs fixing, assign role + department + shift, then
            approve to spin up a real Employee record.
          </div>
        </div>

        <button
          onClick={fetchAll}
          className={styles.btnRefresh}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className={styles.tabBar}>
        {STATUS_TABS.map((t) => {

          const isOn = statusTab === t.key;

          return (
            <button
              key={t.key}
              onClick={() => setStatusTab(t.key)}
              className={isOn ? styles.tabBtnActive : styles.tabBtn}
              style={!isOn ? { color: t.color } : undefined}
            >
              {t.label}
              <span className={isOn ? styles.tabCountActive : styles.tabCount}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className={styles.searchBar}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search by name, email, phone, or employee code…"
          className={styles.searchInput}
        />
        <div className={styles.searchCount}>
          {filtered.length} of {sessions.length}
        </div>
      </div>

      {/* List */}
      {loading && (
        <div className={styles.loadingState}>
          Loading sessions…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          {sessions.length === 0
            ? "No onboarding sessions yet. Start one from the Employees page using 🤖 Invite (AI Onboarding)."
            : "No sessions match these filters."}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.cardGrid}>
          {filtered.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onView={(sess) => setOpenId(sess.id)}
              onResend={handleResend}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {openId != null && (
        <SessionDrawer
          sessionId={openId}
          onClose={() => setOpenId(null)}
          onPatched={fetchAll}
          onApproved={() => {
            setOpenId(null);
            fetchAll();
          }}
          onRejected={() => {
            setOpenId(null);
            fetchAll();
          }}
          showToast={showToast}
        />
      )}

    </div>
  );
}


export default EmployeeOnboardingReview;
