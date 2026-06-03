import { useEffect, useMemo, useState, useCallback } from "react";

import API, { API_BASE_URL } from "../services/api";


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

  const palette = toast.kind === "error"
    ? { bg: "#fef2f2", border: "#fecaca", fg: "#991b1b" }
    : { bg: "#dcfce7", border: "#bbf7d0", fg: "#166534" };

  return (

    <div style={{
      position: "fixed",
      top: 22,
      right: 22,
      zIndex: 2200,
      background: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.border}`,
      padding: "12px 18px",
      borderRadius: 10,
      fontSize: 13,
      fontWeight: 700,
      boxShadow: "0 14px 36px rgba(15,23,42,0.18)",
      maxWidth: 360
    }}>
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

    <span style={{
      background: t.bg,
      color: t.fg,
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.6,
      textTransform: "uppercase"
    }}>
      {status || "—"}
    </span>
  );
}


function ProgressBar({ pct }) {

  const v = Math.max(0, Math.min(100, Number(pct) || 0));

  return (

    <div style={{ width: "100%" }}>
      <div style={{
        height: 6,
        borderRadius: 999,
        background: "#e2e8f0",
        overflow: "hidden"
      }}>
        <div style={{
          width: `${v}%`,
          height: "100%",
          background: v >= 100
            ? "linear-gradient(90deg, #16a34a, #15803d)"
            : "linear-gradient(90deg, #C8102E, #8B0B1F)",
          transition: "width 0.3s"
        }} />
      </div>
      <div style={{
        fontSize: 10,
        color: "#64748b",
        fontWeight: 700,
        marginTop: 3
      }}>
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
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid white",
          boxShadow: "0 4px 12px rgba(15,23,42,0.15)",
          flexShrink: 0
        }}
      />
    );
  }

  return (

    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
      color: "white",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: size * 0.38,
      border: "2px solid white",
      boxShadow: "0 4px 12px rgba(15,23,42,0.15)",
      flexShrink: 0
    }}>
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

    <div style={{
      background: "white",
      borderRadius: 14,
      padding: 16,
      boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
      border: "1px solid #eef2f7",
      display: "flex",
      gap: 14,
      alignItems: "flex-start"
    }}>
      <PhotoThumb
        photoUrl={session.photo_url}
        name={session.invited_name}
        size={56}
      />

      <div style={{ flex: 1, minWidth: 0 }}>

        <div style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 4
        }}>
          <div style={{
            fontWeight: 800,
            color: "#0f172a",
            fontSize: 15,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
            {session.invited_name || (
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>
                (no name yet)
              </span>
            )}
          </div>
          <StatusPill status={session.status} />
          {session.employee_code && (
            <span style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 800,
              background: "#f1f5f9",
              color: "#475569",
              padding: "3px 7px",
              borderRadius: 5
            }}>
              {session.employee_code}
            </span>
          )}
        </div>

        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
          {session.invited_email && <>✉️ {session.invited_email}</>}
          {session.invited_email && session.invited_phone && <>{" · "}</>}
          {session.invited_phone && <>📞 {session.invited_phone}</>}
          {!session.invited_email && !session.invited_phone && (
            <span style={{ color: "#94a3b8" }}>No contact yet</span>
          )}
        </div>

        <div style={{
          fontSize: 10,
          color: "#94a3b8",
          marginBottom: 8
        }}>
          {sub}
        </div>

        <ProgressBar pct={session.progress_pct} />

        <div style={{
          display: "flex",
          gap: 6,
          marginTop: 12,
          flexWrap: "wrap"
        }}>
          <button
            onClick={() => onView(session)}
            style={{
              padding: "7px 14px",
              background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
              color: "white",
              border: "none",
              borderRadius: 7,
              fontWeight: 700,
              fontSize: 11,
              cursor: "pointer"
            }}
          >
            🔍 View
          </button>
          {session.status !== "APPROVED" && (
            <button
              onClick={() => onResend(session)}
              style={{
                padding: "7px 12px",
                background: "white",
                color: "#0369a1",
                border: "1px solid #bae6fd",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 11,
                cursor: "pointer"
              }}
            >
              🔄 Resend
            </button>
          )}
          {session.status !== "APPROVED" && (
            <button
              onClick={() => onDelete(session)}
              style={{
                padding: "7px 12px",
                background: "white",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 11,
                cursor: "pointer"
              }}
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1500
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 100%)",
          maxHeight: "100vh",
          background: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-24px 0 60px rgba(0,0,0,0.35)",
          overflow: "hidden"
        }}
      >

        {/* Sticky header */}
        <div style={{
          background: "linear-gradient(135deg, #1A0508, #4A0E18, #8B0B1F, #C8102E)",
          color: "white",
          padding: "22px 26px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12
        }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
            <PhotoThumb
              photoUrl={detail?.photo_url}
              name={detail?.invited_name || eff("NAME")}
              size={56}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 10,
                letterSpacing: 2,
                opacity: 0.85,
                fontWeight: 800
              }}>
                ONBOARDING REVIEW
              </div>
              <div style={{
                fontSize: 20,
                fontWeight: 900,
                marginTop: 2,
                color: "white",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}>
                {detail?.invited_name || eff("NAME") || "(no name yet)"}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                {detail?.status && <StatusPill status={detail.status} />}
                {detail?.employee_code && (
                  <span style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    background: "rgba(255,255,255,0.18)",
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontWeight: 700
                  }}>
                    {detail.employee_code}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.18)",
              color: "white",
              border: "none",
              width: 34,
              height: 34,
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              flexShrink: 0
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 22
        }}>

          {loading && (
            <div style={{
              padding: 40,
              textAlign: "center",
              color: "#94a3b8"
            }}>
              Loading session…
            </div>
          )}

          {error && !loading && (
            <div style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              padding: 14,
              borderRadius: 10,
              fontWeight: 600
            }}>
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
                    style={{
                      background: "white",
                      border: "1px solid #cbd5e1",
                      color: "#475569",
                      padding: "5px 12px",
                      borderRadius: 7,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    {showChat ? "▲ Hide" : "▼ Show"}
                  </button>
                }
              >
                {showChat && (
                  <div style={{
                    maxHeight: 320,
                    overflowY: "auto",
                    background: "#f8fafc",
                    borderRadius: 10,
                    padding: 10,
                    border: "1px solid #eef2f7"
                  }}>
                    {(detail.chat_history || []).length === 0 && (
                      <div style={{
                        fontSize: 12,
                        color: "#94a3b8",
                        padding: 8,
                        fontStyle: "italic"
                      }}>
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
                accent="#C8102E"
              >
                <Grid2>
                  <Field label="Role *">
                    <select
                      value={orgForm.ROLE_ID}
                      onChange={set("ROLE_ID")}
                      style={inputStyle()}
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
                      style={inputStyle()}
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
                      style={inputStyle()}
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
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Shift start">
                    <input
                      type="time"
                      value={orgForm.SHIFT_START}
                      onChange={set("SHIFT_START")}
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Shift end">
                    <input
                      type="time"
                      value={orgForm.SHIFT_END}
                      onChange={set("SHIFT_END")}
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Employee Code">
                    <input
                      type="text"
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                      placeholder="EMP015"
                      style={inputStyle()}
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
                  style={inputStyle()}
                />
              </DrawerCard>

              {detail.reject_reason && (
                <div style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  padding: 12,
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16
                }}>
                  ⚠ Rejection reason on record: {detail.reject_reason}
                </div>
              )}

            </>
          )}

        </div>

        {/* Sticky footer with actions */}
        {!loading && detail && (
          <div style={{
            background: "white",
            borderTop: "1px solid #e2e8f0",
            padding: "14px 22px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            flexWrap: "wrap"
          }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "10px 18px",
                background: saving ? "#cbd5e1" : "white",
                color: "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: 9,
                fontWeight: 700,
                fontSize: 13,
                cursor: saving ? "wait" : "pointer"
              }}
            >
              {saving ? "Saving…" : "💾 Save Changes"}
            </button>
            <button
              onClick={handleReject}
              disabled={rejecting || detail.status === "APPROVED" || detail.status === "REJECTED"}
              style={{
                padding: "10px 18px",
                background: "white",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                borderRadius: 9,
                fontWeight: 700,
                fontSize: 13,
                cursor: rejecting ? "wait" : "pointer",
                opacity: (detail.status === "APPROVED" || detail.status === "REJECTED") ? 0.45 : 1
              }}
            >
              {rejecting ? "Rejecting…" : "✕ Reject"}
            </button>
            <button
              onClick={handleApprove}
              disabled={!canApprove}
              title={!orgForm.ROLE_ID ? "Pick a Role first" : "Approve onboarding"}
              style={{
                padding: "10px 22px",
                background: canApprove
                  ? "linear-gradient(135deg, #16a34a, #047857)"
                  : "#cbd5e1",
                color: "white",
                border: "none",
                borderRadius: 9,
                fontWeight: 800,
                fontSize: 13,
                cursor: canApprove ? "pointer" : "not-allowed",
                boxShadow: canApprove ? "0 6px 16px rgba(22,163,74,0.35)" : "none"
              }}
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

  const palette = isUser
    ? { bg: "#dbeafe", fg: "#1e3a8a", label: "Candidate" }
    : isAssistant
      ? { bg: "white", fg: "#0f172a", label: "AI Assistant" }
      : { bg: "#fef3c7", fg: "#854d0e", label: "System" };

  return (

    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 6
    }}>
      <div style={{
        maxWidth: "78%",
        background: palette.bg,
        color: palette.fg,
        padding: "7px 11px",
        borderRadius: 10,
        fontSize: 12,
        lineHeight: 1.45,
        border: isAssistant ? "1px solid #e2e8f0" : "none",
        boxShadow: isAssistant ? "0 1px 3px rgba(15,23,42,0.06)" : "none"
      }}>
        <div style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1,
          opacity: 0.7,
          marginBottom: 2,
          textTransform: "uppercase"
        }}>
          {palette.label}
        </div>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {text || <span style={{ opacity: 0.5 }}>(empty)</span>}
        </div>
      </div>
    </div>
  );
}


function DrawerCard({ title, action, children, accent }) {

  return (

    <div style={{
      background: "white",
      borderRadius: 12,
      padding: 18,
      marginBottom: 14,
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
      borderLeft: accent ? `4px solid ${accent}` : "none"
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.2,
          color: "#1e293b",
          textTransform: "uppercase"
        }}>
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

    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 12
    }}>
      {children}
    </div>
  );
}


function DRow({ label, value, wide }) {

  if (value === undefined || value === null || value === "") {

    return null;
  }

  return (

    <div style={{ gridColumn: wide ? "span 2" : undefined }}>
      <div style={{
        fontSize: 9,
        color: "#94a3b8",
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: 2
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        color: "#0f172a",
        fontWeight: 600,
        wordBreak: "break-word"
      }}>
        {String(value)}
      </div>
    </div>
  );
}


function Field({ label, children }) {

  return (

    <div>
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#475569",
        marginBottom: 4,
        letterSpacing: 0.3
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function inputStyle() {

  return {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white",
    boxSizing: "border-box",
    outline: "none"
  };
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

    <div style={{ padding: 26, minHeight: "100%", background: "#f1f5f9" }}>

      <Toast toast={toast} onDismiss={dismissToast} />

      {/* Hero */}
      <div style={{
        background: "linear-gradient(120deg, #1A0508 0%, #4A0E18 30%, #8B0B1F 60%, #C8102E 100%)",
        color: "white",
        padding: "26px 30px",
        borderRadius: 18,
        marginBottom: 18,
        boxShadow: "0 18px 50px rgba(139,11,31,0.32)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2.5,
            opacity: 0.85,
            fontWeight: 800,
            textTransform: "uppercase"
          }}>
            BVC24 · HR Onboarding
          </div>
          <h1 style={{
            fontSize: 26,
            fontWeight: 900,
            margin: "6px 0 6px",
            lineHeight: 1.15,
            color: "white"
          }}>
            Employee Onboarding Review
          </h1>
          <div style={{ fontSize: 13, opacity: 0.92, maxWidth: 620 }}>
            Review what the candidate filled out, fix anything that
            needs fixing, assign role + department + shift, then
            approve to spin up a real Employee record.
          </div>
        </div>

        <button
          onClick={fetchAll}
          style={{
            background: "rgba(255,255,255,0.15)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.4)",
            padding: "12px 20px",
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
            letterSpacing: 0.3
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{
        background: "white",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 14,
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center"
      }}>
        {STATUS_TABS.map((t) => {

          const isOn = statusTab === t.key;

          return (
            <button
              key={t.key}
              onClick={() => setStatusTab(t.key)}
              style={{
                padding: "8px 14px",
                background: isOn
                  ? "linear-gradient(135deg, #C8102E, #8B0B1F)"
                  : "white",
                color: isOn ? "white" : t.color,
                border: isOn ? "none" : "1px solid #e2e8f0",
                borderRadius: 8,
                fontWeight: 800,
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: 0.3
              }}
            >
              {t.label}
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                opacity: 0.85,
                background: isOn ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                padding: "1px 6px",
                borderRadius: 6
              }}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{
        background: "white",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 18,
        display: "flex",
        gap: 10,
        alignItems: "center"
      }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search by name, email, phone, or employee code…"
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
            outline: "none"
          }}
        />
        <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>
          {filtered.length} of {sessions.length}
        </div>
      </div>

      {/* List */}
      {loading && (
        <div style={{
          padding: 40,
          textAlign: "center",
          color: "#94a3b8"
        }}>
          Loading sessions…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 60,
          textAlign: "center",
          background: "white",
          borderRadius: 14,
          border: "1px dashed #cbd5e1",
          color: "#94a3b8"
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          {sessions.length === 0
            ? "No onboarding sessions yet. Start one from the Employees page using 🤖 Invite (AI Onboarding)."
            : "No sessions match these filters."}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 14
        }}>
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
