import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import API, { API_BASE_URL } from "../services/api";
import ChatBot from "../components/ChatBot";
import HRAssistant from "../components/HRAssistant";
import LeaveChatbot from "../components/LeaveChatbot";
import MyAttendancePanel from "../components/MyAttendancePanel";
import EmployeeProfileForm from "./EmployeeProfileForm";

import {
  isVoiceSupported,
  isVoiceEnabled,
  setVoiceEnabled,
  speak,
  stopSpeaking
} from "../services/voiceAlerts";


// =================================================================
// CONSTANTS — BVC red palette + cadence
// =================================================================

const PORTAL_REFRESH_MS = 60000;   // 60s auto-refresh on the portal dashboard
const POLL_INTERVAL_MS = 15000;    // legacy poll for tasks/notifications

const BVC = {
  PRIMARY: "#C8102E",   // BVC red
  DARK:    "#8B0B1F",   // dark red
  DEEPEST: "#000000",   // deepest red — section headers
  INK:     "#1A0508",   // near black
  ACCENT:  "#F4B324",   // gold
  TINT:    "#fef2f2",
  BORDER:  "#fecaca",
  BG:      "#F5F6FA",   // page background
  TEXT:    "#0f172a",
  MUTED:   "#94a3b8"
};

const CARD_SHADOW = "0 4px 12px rgba(0,0,0,0.06)";

const SECTION_LABEL = {
  textTransform: "uppercase",
  fontSize: 17,
  letterSpacing: 1.2,
  fontWeight: 700,
  color: BVC.DEEPEST
};

const PRIORITY_THEME = {
  HIGH:   { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  MEDIUM: { bg: "#fef3c7", fg: "#854d0e", border: "#fde68a" },
  LOW:    { bg: "#dcfce7", fg: "#166534", border: "#a7f3d0" }
};

const STATUS_PILL = {
  PENDING:     { bg: "#f1f5f9", fg: "#475569", label: "Pending" },
  IN_PROGRESS: { bg: "#dbeafe", fg: "#1d4ed8", label: "In Progress" },
  ON_HOLD:     { bg: "#fef3c7", fg: "#854d0e", label: "On Hold" },
  COMPLETED:   { bg: "#dcfce7", fg: "#166534", label: "Completed" },
  UPCOMING:    { bg: "#ede9fe", fg: "#5b21b6", label: "Upcoming" },
  OVERDUE:     { bg: "#fee2e2", fg: "#b91c1c", label: "Overdue" }
};

const LEAVE_STATUS_PILL = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#854d0e", label: "Pending" },
  APPROVED:         { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  REJECTED:         { bg: "#fee2e2", fg: "#b91c1c", label: "Rejected" },
  CANCELLED:        { bg: "#f1f5f9", fg: "#475569", label: "Cancelled" }
};

const LEAVE_TYPE_THEMES = {
  CASUAL: "#3b82f6",
  SICK:   "#ef4444",
  EARNED: "#10b981",
  UNPAID: "#94a3b8",
  LOP:    "#6b7280"
};


// =================================================================
// FORMATTING HELPERS
// =================================================================

function fmtDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short", day: "2-digit", month: "short", year: "numeric"
    });
  } catch { return iso; }
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysRemaining(dueIso) {
  if (!dueIso) return null;
  try {
    const due = new Date(dueIso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.round((due - today) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}


// =================================================================
// TOAST — top-right transient toaster
// =================================================================

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(onClose, 5000);
    return () => clearTimeout(id);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        background: "#fff",
        border: `1px solid ${BVC.BORDER}`,
        borderLeft: `4px solid ${BVC.PRIMARY}`,
        borderRadius: 12,
        boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
        padding: "12px 16px",
        minWidth: 280,
        maxWidth: 380,
        color: BVC.INK,
        fontSize: 13,
        fontWeight: 600
      }}
      role="status"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ flex: 1 }}>{toast.message}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: BVC.MUTED,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}


// =================================================================
// EmployeeDashboard — top-level (profile gate)
// =================================================================

function EmployeeDashboard() {

  const navigate = useNavigate();
  const employeeId = localStorage.getItem("employee_id") || "";

  const [profileGate, setProfileGate] = useState({
    loading: true,
    employee: null,
    submitted: false
  });

  const reloadProfileGate = () => {
    if (!employeeId) {
      setProfileGate({ loading: false, employee: null, submitted: true });
      return;
    }
    setProfileGate((s) => ({ ...s, loading: true }));
    API.get(`/employees/by-code/${encodeURIComponent(employeeId)}`)
      .then((r) => {
        setProfileGate({
          loading: false,
          employee: r.data,
          submitted: !!r.data?.PROFILE_SUBMITTED
        });
      })
      .catch(() => {
        setProfileGate({ loading: false, employee: null, submitted: true });
      });
  };

  useEffect(() => {
    reloadProfileGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  if (profileGate.loading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: BVC.BG, color: BVC.DARK,
        fontFamily: "Arial, sans-serif"
      }}>
        Loading your profile…
      </div>
    );
  }

  if (profileGate.employee && !profileGate.submitted) {
    return (
      <EmployeeProfileForm
        employee={profileGate.employee}
        onSubmitted={() => reloadProfileGate()}
        onLogout={() => {
          localStorage.clear();
          navigate("/login", { replace: true });
        }}
      />
    );
  }

  return (
    <>
      <EmployeeDashboardBody />
      <HRAssistant
        employeeId={profileGate.employee?.EMPLOYEE_CODE || employeeId}
        employeeName={profileGate.employee?.NAME || ""}
      />
    </>
  );
}


// =================================================================
// EmployeeDashboardBody — drives portal-dashboard + actions
// =================================================================

function EmployeeDashboardBody() {

  const navigate = useNavigate();

  // localStorage keys written by Login.jsx (Employee login flow):
  //   employee_id, employee_name, department, employee_role,
  //   loginTime, attendance_status, auth, role, token, username
  const employeeId       = localStorage.getItem("employee_id") || "";
  const employeeName     = localStorage.getItem("employee_name") || "";
  const department       = localStorage.getItem("department") || "";
  const role             = localStorage.getItem("employee_role") || "EMPLOYEE";
  const loginTime        = localStorage.getItem("loginTime") || "";
  const attendanceStatus = localStorage.getItem("attendance_status") || "PRESENT";

  // ----- portal-dashboard state -----
  const [portal, setPortal]   = useState(null);
  const [portalErr, setPortalErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState({}); // { [assignmentId]: true }
  const [toast, setToast]     = useState(null);
  const [tab, setTab]         = useState("pending");

  // ----- legacy supporting state -----
  const [productionStages, setProductionStages] = useState([]);
  const [stageBusy, setStageBusy] = useState({});
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [permissionHistory, setPermissionHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastNotifIdRef = useRef(0);

  const [voiceOn, setVoiceOn] = useState(
    () => isVoiceSupported() && isVoiceEnabled()
  );


  // -------------------------------------------------------------
  // PORTAL-DASHBOARD FETCH (single endpoint, 60s refresh)
  // -------------------------------------------------------------

  const fetchPortalDashboard = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(`/employee/${employeeId}/portal-dashboard`);
      setPortal(res.data || {});
      setPortalErr("");
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "";
      if (status === 404) {
        setPortalErr(
          "Portal dashboard endpoint not yet available on the server."
        );
      } else {
        setPortalErr(detail || "Failed to load dashboard.");
      }
    }
  };

  // -------------------------------------------------------------
  // LEGACY FETCHERS — production stages + leave history + notifs
  // -------------------------------------------------------------

  const fetchProductionStages = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(`/employee/${employeeId}/production-stages`);
      setProductionStages(res.data?.stages || []);
    } catch { /* non-critical */ }
  };

  const fetchLeaveBalance = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(`/leave/balance/${employeeId}`);
      setLeaveBalance(res.data?.balance || null);
    } catch { /* ignore */ }
  };

  const fetchLeaveHistory = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(`/leave/my-requests`, {
        params: { employee_id: employeeId }
      });
      setLeaveHistory(res.data || []);
    } catch { /* ignore */ }
  };

  const fetchPermissionHistory = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(`/leave/my-permissions`, {
        params: { employee_id: employeeId }
      });
      setPermissionHistory(res.data || []);
    } catch { setPermissionHistory([]); }
  };

  const refetchLeaveAll = async () => {
    await Promise.all([
      fetchLeaveBalance(),
      fetchLeaveHistory(),
      fetchPermissionHistory()
    ]);
  };

  const fetchNotifications = async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        API.get("/notifications"),
        API.get("/notifications/unread-count")
      ]);
      const items = listRes.data || [];
      setNotifications(items);
      setUnreadCount(countRes.data?.count ?? countRes.data?.unread ?? 0);
      if (items.length > 0) {
        const newest = items[0];
        if (voiceOn && lastNotifIdRef.current !== 0 && newest.ID > lastNotifIdRef.current) {
          speak(`${newest.TITLE}. ${newest.MESSAGE}`);
        }
        lastNotifIdRef.current = Math.max(lastNotifIdRef.current, newest.ID || 0);
      }
    } catch { /* ignore */ }
  };


  // -------------------------------------------------------------
  // ACTIONS
  // -------------------------------------------------------------

  // Optimistic PATCH /employee/{id}/tasks/{assignment_id}/status
  const updateAssignmentStatus = async (assignmentId, newStatus, currentStatus) => {
    if (!assignmentId || actionBusy[assignmentId]) return;

    setActionBusy((b) => ({ ...b, [assignmentId]: true }));

    // optimistic local update across the portal payload
    setPortal((prev) => {
      if (!prev) return prev;
      return applyOptimisticStatus(prev, assignmentId, newStatus);
    });

    try {
      const res = await API.patch(
        `/employee/${employeeId}/tasks/${assignmentId}/status`,
        { status: newStatus }
      );

      // unlock_result toast
      const unlock = res?.data?.unlock_result;
      if (unlock && unlock.next_stage_name && unlock.assigned_to_name) {
        setToast({
          message: `+10 points. Next stage '${unlock.next_stage_name}' assigned to ${unlock.assigned_to_name}.`
        });
      } else if (newStatus === "COMPLETED") {
        setToast({ message: "+10 points. Task completed." });
      }

      // re-fetch so every tile updates
      await fetchPortalDashboard();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to update task";
      setToast({ message: `⚠ ${detail}` });
      // roll back optimistic change
      setPortal((prev) => {
        if (!prev) return prev;
        return applyOptimisticStatus(prev, assignmentId, currentStatus);
      });
    } finally {
      setActionBusy((b) => {
        const next = { ...b };
        delete next[assignmentId];
        return next;
      });
    }
  };

  const updateStage = async (stage, newStatus) => {
    const key = `${stage.WORK_ORDER_ID}-${stage.STAGE_ID}`;
    setStageBusy((b) => ({ ...b, [key]: true }));
    try {
      await API.patch(
        `/process/wo/${stage.WORK_ORDER_ID}/stages/${stage.STAGE_ID}`,
        { STATUS: newStatus }
      );
      await fetchProductionStages();
    } catch (e) {
      alert(e?.response?.data?.detail || `Failed to update ${stage.STAGE_NAME}`);
    } finally {
      setStageBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const submitLeave = async (form) => {
    const res = await API.post("/leave/apply", {
      EMPLOYEE_ID: employeeId,
      LEAVE_TYPE: form.leaveType,
      START_DATE: form.startDate,
      END_DATE: form.endDate,
      REASON: (form.reason || "").trim() || null,
      HALF_DAY: !!form.halfDay
    });
    await refetchLeaveAll();
    return res.data;
  };

  const submitPermission = async (form) => {
    // The form's startTime is a datetime-local value (e.g. "2026-06-13T17:00"),
    // but the backend's PERMISSION_DATE is a plain date. Send the date part only
    // (string split avoids any Date() timezone shift on the day boundary).
    const res = await API.post("/leave/apply-permission", {
      EMPLOYEE_ID: employeeId,
      PERMISSION_DATE: (form.startTime || "").split("T")[0],
      DURATION_HOURS: Number(form.durationHours),
      REASON: (form.reason || "").trim() || null
    });
    await refetchLeaveAll();
    return res.data;
  };

  const cancelLeave = async (id) => {
    if (!window.confirm("Cancel this request?")) return;
    try {
      await API.patch(`/leave/${id}/cancel`, { EMPLOYEE_ID: employeeId });
      await refetchLeaveAll();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    if (!next) stopSpeaking();
  };

  const handleLogout = async () => {
    if (!window.confirm("Log out now?")) return;
    try {
      await API.post("/employee-logout", { EMPLOYEE_ID: employeeId });
    } catch { /* ignore */ }
    localStorage.clear();
    navigate("/login", { replace: true });
  };


  // -------------------------------------------------------------
  // MOUNT + AUTO-REFRESH
  // -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      await Promise.all([
        fetchPortalDashboard(),
        fetchProductionStages(),
        refetchLeaveAll(),
        fetchNotifications()
      ]);
      if (!cancelled) setLoading(false);
    })();

    const portalTimer = setInterval(fetchPortalDashboard, PORTAL_REFRESH_MS);
    const sideTimer = setInterval(() => {
      fetchProductionStages();
      fetchNotifications();
      refetchLeaveAll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(portalTimer);
      clearInterval(sideTimer);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // -------------------------------------------------------------
  // DERIVED VIEW DATA
  // -------------------------------------------------------------

  const profile = portal?.profile || {
    employee_code: employeeId,
    name: employeeName,
    designation: role,
    department: department,
    photo_url: null
  };

  const productivity = portal?.productivity || {
    score: 0,
    rating: 0,
    badge: "Getting Started",
    on_time_pct: 0,
    attendance_pct: 0,
    avg_completion_hours: 0,
    project_contribution_pct: 0,
    delayed_tasks: 0,
    points_total: 0,
    current_streak: 0
  };

  const kpis = portal?.kpis || {};
  const taskBuckets = {
    today:      portal?.tasks?.today      || [],
    pending:    portal?.tasks?.pending    || [],
    in_progress: portal?.tasks?.in_progress || [],
    on_hold:    portal?.tasks?.on_hold    || [],
    upcoming:   portal?.tasks?.upcoming   || [],
    completed:  portal?.tasks?.completed  || []
  };
  const projects = portal?.projects || [];
  const monthlyChart = portal?.monthly_productivity || [];
  const attendance = portal?.attendance || {
    present: 0, absent: 0, leave: 0, permission: 0, percentage: 0
  };

  const tilesActiveTab = (() => {
    switch (tab) {
      case "pending":     return taskBuckets.pending;
      case "in_progress": return taskBuckets.in_progress;
      case "on_hold":     return taskBuckets.on_hold;
      case "upcoming":    return taskBuckets.upcoming;
      case "completed":   return taskBuckets.completed;
      default:            return [];
    }
  })();


  // =============================================================
  // RENDER
  // =============================================================

  return (

    <div
      style={{
        minHeight: "100vh",
        background: BVC.BG,
        fontFamily: "Arial, sans-serif",
        color: BVC.TEXT
      }}
    >

      {/* ---------- TOP BAR ---------- */}
      <header
        style={{
          background: `linear-gradient(135deg, ${BVC.INK}, ${BVC.DEEPEST} 50%, ${BVC.DARK})`,
          color: "#fff",
          padding: "14px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 4px 14px rgba(0,0,0,0.18)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img
            src="/bharath-logo.png"
            alt="logo"
            style={{ height: 38, width: "auto" }}
          />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.4 }}>
              BVC24 · Employee Portal
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {employeeName || profile.name} · {profile.employee_code}{" "}
              {profile.department ? `· ${profile.department}` : ""}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "5px 10px",
              borderRadius: 999,
              background: attendanceStatus === "LATE"
                ? "rgba(244,179,36,0.22)"
                : "rgba(34,197,94,0.22)",
              color: attendanceStatus === "LATE" ? BVC.ACCENT : "#86efac",
              letterSpacing: 0.4
            }}
            title={`Login: ${fmtTime(loginTime)}`}
          >
            {attendanceStatus} · {fmtTime(loginTime)}
          </span>

          {isVoiceSupported() && (
            <button
              type="button"
              onClick={toggleVoice}
              style={topbarBtn}
              title="Toggle voice alerts"
            >
              {voiceOn ? "🔊" : "🔇"} Voice
            </button>
          )}

          <button type="button" style={topbarBtn} onClick={handleLogout}>
            Logout
          </button>

          {unreadCount > 0 && (
            <span
              style={{
                fontSize: 11,
                background: BVC.ACCENT,
                color: BVC.DEEPEST,
                padding: "4px 8px",
                borderRadius: 999,
                fontWeight: 800
              }}
            >
              🔔 {unreadCount}
            </span>
          )}
        </div>
      </header>

      <main
        style={{
          maxWidth: 1380,
          margin: "0 auto",
          padding: "20px 22px 40px"
        }}
      >

        {portalErr && (
          <div
            style={{
              background: "#fff",
              border: `1px solid ${BVC.BORDER}`,
              borderLeft: `4px solid ${BVC.PRIMARY}`,
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13,
              color: BVC.DARK,
              marginBottom: 16,
              boxShadow: CARD_SHADOW
            }}
          >
            ⚠ {portalErr}{" "}
            <span style={{ color: BVC.MUTED }}>
              — supporting widgets below remain functional.
            </span>
          </div>
        )}

        {loading && !portal && (
          <div
            style={{
              ...cardBase,
              textAlign: "center",
              padding: 40,
              color: BVC.MUTED
            }}
          >
            Loading your workspace…
          </div>
        )}

        {/* ---------- 1. PROFILE STRIP ---------- */}
        <ProfileStrip
          profile={profile}
          productivity={productivity}
        />

        {/* ---------- 1b. MY ATTENDANCE — check-in / check-out ---------- */}
        {/* Mirrors the admin Attendance widget but auto-targets the logged-in */}
        {/* employee. Hits the SAME /check-in and /check-out endpoints, so the */}
        {/* attendance ledger HR sees stays a single source of truth.          */}
        <MyAttendancePanel employeeId={employeeId} />

        {/* ---------- 2. KPI GRID ---------- */}
        <KpiGrid kpis={kpis} />

        {/* ---------- 3. TODAY'S TASKS ---------- */}
        <TodayTasksCard
          tasks={taskBuckets.today}
          busyMap={actionBusy}
          onUpdate={updateAssignmentStatus}
        />

        {/* ---------- 4. TABBED TASK LISTS ---------- */}
        <TabbedTaskLists
          tab={tab}
          onTabChange={setTab}
          counts={{
            pending:     taskBuckets.pending.length,
            in_progress: taskBuckets.in_progress.length,
            on_hold:     taskBuckets.on_hold.length,
            upcoming:    taskBuckets.upcoming.length,
            completed:   taskBuckets.completed.length
          }}
          tasks={tilesActiveTab}
          busyMap={actionBusy}
          onUpdate={updateAssignmentStatus}
        />

        {/* ---------- 5. ASSIGNED PROJECTS ---------- */}
        <AssignedProjectsCard projects={projects} />

        {/* ---------- 5b. MY MEMOS — employee-side view ---------- */}
        <MyMemosCard employeeId={employeeId} />

        {/* ---------- 6. PERFORMANCE BREAKDOWN ---------- */}
        <PerformanceBreakdownCard productivity={productivity} />

        {/* ---------- 7. MONTHLY PRODUCTIVITY CHART ---------- */}
        <MonthlyProductivityChart data={monthlyChart} />

        {/* ---------- 8. ATTENDANCE SUMMARY ---------- */}
        <AttendanceSummaryCard attendance={attendance} />

        {/* ---------- 9. REWARDS ---------- */}
        <RewardsCard productivity={productivity} />

        {/* ---------- (retained) Production Stages ---------- */}
        {productionStages.length > 0 && (
          <ProductionStagesSection
            stages={productionStages}
            busyMap={stageBusy}
            onUpdate={updateStage}
          />
        )}

        {/* ---------- AI Leave Chatbot — new feature ---------- */}
        {/* Sits above the existing form. Does NOT replace it — both    */}
        {/* coexist. The chatbot calls the same POST /leave/apply       */}
        {/* endpoint the form does, so the rest of the workflow         */}
        {/* (HR email, dashboard update, balance deduction) stays put.  */}
        <LeaveChatbot
          employeeId={employeeId}
          onLeaveSubmitted={() => {
            // Re-fetch so the Leave History panel + balance refresh
            fetchLeaveHistory?.();
            fetchLeaveBalance?.();
          }}
        />

        {/* ---------- (retained) Leave & Permission ---------- */}
        <LeavePermissionSection
          balance={leaveBalance}
          leaveHistory={leaveHistory}
          permissionHistory={permissionHistory}
          onSubmitLeave={submitLeave}
          onSubmitPermission={submitPermission}
          onCancel={cancelLeave}
        />

      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />
      <ChatBot />
    </div>
  );
}


// =================================================================
// applyOptimisticStatus — walk every task bucket and patch status
// =================================================================

function applyOptimisticStatus(portal, assignmentId, newStatus) {
  if (!portal?.tasks) return portal;
  const buckets = portal.tasks;
  const patched = {};
  for (const key of Object.keys(buckets)) {
    const arr = buckets[key] || [];
    patched[key] = arr.map((t) =>
      String(t.assignment_id) === String(assignmentId)
        ? { ...t, status: newStatus }
        : t
    );
  }
  return { ...portal, tasks: patched };
}


// =================================================================
// 1. PROFILE STRIP
// =================================================================

function ProfileStrip({ profile, productivity }) {

  const initials = (profile?.name || "?")
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const score = Math.max(0, Math.min(100, Number(productivity?.score || 0)));
  const rating = Math.max(0, Math.min(5, Math.round(Number(productivity?.rating || 0))));
  const badge = productivity?.badge || "Getting Started";

  const badgeTheme = badge === "On Fire"
    ? { bg: BVC.ACCENT, fg: BVC.DEEPEST }
    : badge === "Steady"
      ? { bg: BVC.PRIMARY, fg: "#fff" }
      : { bg: "#e5e7eb", fg: "#475569" };

  return (
    <section style={{ ...cardBase, marginBottom: 18, padding: 20 }}>
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        {/* LEFT — identity */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", flex: 1, minWidth: 280 }}>
          {profile?.photo_url ? (
            <img
              src={profile.photo_url}
              alt={profile.name}
              style={{
                width: 78,
                height: 78,
                borderRadius: "50%",
                objectFit: "cover",
                border: `3px solid ${BVC.PRIMARY}`
              }}
            />
          ) : (
            <div
              style={{
                width: 78,
                height: 78,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DEEPEST})`,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: 1,
                boxShadow: "0 6px 16px rgba(200,16,46,0.30)"
              }}
            >
              {initials}
            </div>
          )}

          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BVC.INK, marginBottom: 2 }}>
              {profile?.name || "Employee"}
            </div>
            <div style={{ fontSize: 12, color: BVC.MUTED, fontWeight: 700, letterSpacing: 0.4 }}>
              {profile?.employee_code || "—"}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#475569" }}>
              {profile?.designation || "—"}
              {profile?.department ? ` · ${profile.department}` : ""}
            </div>
          </div>
        </div>

        {/* RIGHT — score + rating + badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            paddingLeft: 18,
            borderLeft: "1px solid #f1f5f9"
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 56,
                fontWeight: 900,
                lineHeight: 1,
                color: BVC.PRIMARY
              }}
            >
              {score}
            </div>
            <div style={{ ...SECTION_LABEL, marginTop: 4 }}>
              Productivity
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, color: BVC.ACCENT, letterSpacing: 2 }}>
              {"★".repeat(rating)}
              <span style={{ color: "#e5e7eb" }}>{"★".repeat(5 - rating)}</span>
            </div>
            <div
              style={{
                marginTop: 8,
                display: "inline-block",
                padding: "5px 12px",
                borderRadius: 999,
                background: badgeTheme.bg,
                color: badgeTheme.fg,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.8,
                textTransform: "uppercase"
              }}
            >
              {badge === "On Fire" ? "🔥 " : ""}{badge}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


// =================================================================
// 2. KPI GRID — 8 tiles
// =================================================================

function KpiGrid({ kpis }) {
  const tiles = [
    { key: "total_assigned", label: "Total Assigned", color: BVC.PRIMARY },
    { key: "today",          label: "Today",          color: BVC.ACCENT },
    { key: "pending",        label: "Pending",        color: "#64748b" },
    { key: "in_progress",    label: "In Progress",    color: "#1d4ed8" },
    { key: "on_hold",        label: "On Hold",        color: "#d97706" },
    { key: "completed",      label: "Completed",      color: "#16a34a" },
    { key: "upcoming",       label: "Upcoming",       color: "#7c3aed" },
    { key: "overdue",        label: "Overdue",        color: "#dc2626" }
  ];

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 10 }}>Task KPIs</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.key}
            style={{
              ...cardBase,
              padding: "14px 14px 12px 16px",
              borderLeft: `4px solid ${t.color}`,
              display: "flex",
              flexDirection: "column",
              gap: 2
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900, color: t.color, lineHeight: 1.1 }}>
              {kpis?.[t.key] ?? 0}
            </div>
            <div
              style={{
                fontSize: 11,
                color: BVC.MUTED,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: "uppercase"
              }}
            >
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


// =================================================================
// 3. TODAY'S TASKS CARD — sticky red header
// =================================================================

function TodayTasksCard({ tasks, busyMap, onUpdate }) {
  return (
    <section style={{ ...cardBase, padding: 0, marginBottom: 18, overflow: "hidden" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DEEPEST})`,
          color: "#fff",
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div
          style={{
            ...SECTION_LABEL,
            color: "#fff"
          }}
        >
          📌 Today's Tasks
        </div>
        <span
          style={{
            background: "rgba(255,255,255,0.18)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 12,
            padding: "3px 10px",
            borderRadius: 999
          }}
        >
          {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ padding: 16 }}>
        {tasks.length === 0 ? (
          <EmptyState message="No tasks scheduled for today. Enjoy the breathing room." />
        ) : (
          tasks.map((t) => (
            <TaskRow
              key={t.assignment_id}
              task={t}
              busy={!!busyMap[t.assignment_id]}
              onUpdate={onUpdate}
            />
          ))
        )}
      </div>
    </section>
  );
}


// =================================================================
// 4. TABBED TASK LISTS
// =================================================================

function TabbedTaskLists({ tab, onTabChange, counts, tasks, busyMap, onUpdate }) {

  const tabs = [
    { key: "pending",     label: "Pending" },
    { key: "in_progress", label: "In Progress" },
    { key: "on_hold",     label: "On Hold" },
    { key: "upcoming",    label: "Upcoming" },
    { key: "completed",   label: "Completed" }
  ];

  return (
    <section style={{ ...cardBase, padding: 0, marginBottom: 18, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #f1f5f9",
          padding: "0 16px",
          background: "#fafbff",
          flexWrap: "wrap"
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              style={{
                padding: "12px 14px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: active ? BVC.PRIMARY : "#64748b",
                borderBottom: active
                  ? `3px solid ${BVC.PRIMARY}`
                  : "3px solid transparent",
                marginBottom: -1
              }}
            >
              {t.label}{" "}
              <span
                style={{
                  background: active ? BVC.PRIMARY : "#e5e7eb",
                  color: active ? "#fff" : "#475569",
                  borderRadius: 999,
                  padding: "1px 7px",
                  fontSize: 10,
                  marginLeft: 4
                }}
              >
                {counts?.[t.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16 }}>
        {(!tasks || tasks.length === 0) ? (
          <EmptyState message={`No ${tab.replace("_", " ")} tasks.`} />
        ) : (
          tasks.map((t) => (
            <TaskRow
              key={t.assignment_id}
              task={t}
              busy={!!busyMap[t.assignment_id]}
              onUpdate={onUpdate}
            />
          ))
        )}
      </div>
    </section>
  );
}


// =================================================================
// TaskRow — used by Today's & Tabbed lists
// =================================================================

function TaskRow({ task, busy, onUpdate }) {

  const status = (task?.status || "PENDING").toUpperCase();
  const priority = (task?.priority || "MEDIUM").toUpperCase();
  const priorityTheme = PRIORITY_THEME[priority] || PRIORITY_THEME.MEDIUM;
  const statusPill = STATUS_PILL[status] || STATUS_PILL.PENDING;

  const remain = daysRemaining(task?.due_date);
  let remainTheme = { bg: "#dcfce7", fg: "#166534" };
  let remainLabel = "—";
  if (remain != null) {
    if (remain < 0) {
      remainTheme = { bg: "#fee2e2", fg: "#b91c1c" };
      remainLabel = `${Math.abs(remain)} day${Math.abs(remain) === 1 ? "" : "s"} overdue`;
    } else if (remain <= 2) {
      remainTheme = { bg: "#fef3c7", fg: "#854d0e" };
      remainLabel = remain === 0
        ? "Due today"
        : `${remain} day${remain === 1 ? "" : "s"} remaining`;
    } else {
      remainLabel = `${remain} days remaining`;
    }
  }

  const actions = actionsForStatus(status);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #f1f5f9",
        borderLeft: `4px solid ${BVC.PRIMARY}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        boxShadow: CARD_SHADOW
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap"
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: BVC.INK }}>
              {task?.title || task?.task_name || "Untitled task"}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.6,
                padding: "3px 9px",
                borderRadius: 999,
                background: priorityTheme.bg,
                color: priorityTheme.fg,
                border: `1px solid ${priorityTheme.border}`,
                textTransform: "uppercase"
              }}
            >
              {priority}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.5,
                padding: "3px 9px",
                borderRadius: 999,
                background: statusPill.bg,
                color: statusPill.fg
              }}
            >
              {statusPill.label}
            </span>
          </div>

          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {task?.project_name ? `📁 ${task.project_name}` : ""}
            {task?.stage_name ? ` · 🔧 ${task.stage_name}` : ""}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 6
            }}
          >
            <span style={{ fontSize: 12, color: "#475569" }}>
              ⏰ Due {fmtDate(task?.due_date)}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "3px 9px",
                borderRadius: 999,
                background: remainTheme.bg,
                color: remainTheme.fg
              }}
            >
              {remainLabel}
            </span>
          </div>

          {task?.description && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "#475569",
                whiteSpace: "pre-wrap",
                lineHeight: 1.4
              }}
            >
              {task.description.length > 200
                ? task.description.slice(0, 200) + "…"
                : task.description}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {actions.length === 0 ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "6px 12px",
                borderRadius: 999,
                background: "#dcfce7",
                color: "#166534"
              }}
            >
              ✓ Done
            </span>
          ) : (
            actions.map((a) => (
              <button
                key={a.target}
                type="button"
                disabled={busy}
                onClick={() => onUpdate(task.assignment_id, a.target, status)}
                style={taskActionBtn(a.color, busy)}
              >
                {a.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function actionsForStatus(status) {
  switch (status) {
    case "PENDING":
      return [
        { target: "IN_PROGRESS", label: "▶ Start Task", color: "#1d4ed8" },
        { target: "ON_HOLD",     label: "⏸ Hold",       color: "#d97706" },
        { target: "COMPLETED",   label: "✓ Complete",   color: "#16a34a" }
      ];
    case "IN_PROGRESS":
      return [
        { target: "ON_HOLD",   label: "⏸ Hold",     color: "#d97706" },
        { target: "COMPLETED", label: "✓ Complete", color: "#16a34a" }
      ];
    case "ON_HOLD":
      return [
        { target: "IN_PROGRESS", label: "▶ Resume",   color: "#1d4ed8" },
        { target: "COMPLETED",   label: "✓ Complete", color: "#16a34a" }
      ];
    case "COMPLETED":
    default:
      return [];
  }
}

function taskActionBtn(color, busy) {
  return {
    padding: "7px 12px",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
    boxShadow: `0 4px 10px ${color}40`
  };
}


// =================================================================
// 5. ASSIGNED PROJECTS CARD
// =================================================================

function AssignedProjectsCard({ projects }) {
  return (
    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>
        Assigned Projects
      </div>

      {(!projects || projects.length === 0) ? (
        <EmptyState message="You have no projects assigned yet." />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12
          }}
        >
          {projects.map((p) => {
            const total = Number(p.my_stages_count || 0);
            const done = Number(p.my_completed_count || 0);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const statusKey = (p.status || "PENDING").toUpperCase();
            const sPill = STATUS_PILL[statusKey] || STATUS_PILL.PENDING;
            return (
              <div
                key={p.project_id || p.id || p.name}
                style={{
                  border: "1px solid #f1f5f9",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fff"
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 14,
                    color: BVC.INK,
                    marginBottom: 6
                  }}
                >
                  {p.project_name || p.name || "Untitled project"}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: 10
                  }}
                >
                  {p.customer_name && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: BVC.TINT,
                        color: BVC.DARK,
                        border: `1px solid ${BVC.BORDER}`
                      }}
                    >
                      👤 {p.customer_name}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: sPill.bg,
                      color: sPill.fg
                    }}
                  >
                    {sPill.label}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: BVC.MUTED,
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4
                  }}
                >
                  <span>My progress</span>
                  <span style={{ color: BVC.DARK, fontWeight: 700 }}>
                    {done} / {total} stages · {pct}%
                  </span>
                </div>
                <div
                  style={{
                    height: 8,
                    background: "#f1f5f9",
                    borderRadius: 999,
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DEEPEST})`
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


// =================================================================
// 6. PERFORMANCE BREAKDOWN
// =================================================================

function PerformanceBreakdownCard({ productivity }) {

  const rows = [
    { label: "Productivity Score", value: productivity?.score, suffix: "/ 100", bar: productivity?.score },
    { label: "On-Time Completion", value: productivity?.on_time_pct, suffix: "%", bar: productivity?.on_time_pct },
    { label: "Attendance", value: productivity?.attendance_pct, suffix: "%", bar: productivity?.attendance_pct },
    { label: "Avg Completion Hours", value: productivity?.avg_completion_hours, suffix: " hrs", bar: null },
    { label: "Project Contribution", value: productivity?.project_contribution_pct, suffix: "%", bar: productivity?.project_contribution_pct },
    { label: "Delayed Tasks", value: productivity?.delayed_tasks, suffix: "", bar: null },
    { label: "Total Points Earned", value: productivity?.points_total, suffix: " pts", bar: null },
    { label: "Overall Rating", value: null, suffix: "", bar: null, stars: Math.round(Number(productivity?.rating || 0)) }
  ];

  return (
    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>
        Performance Breakdown
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 8
        }}
      >
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr 100px",
              gap: 12,
              alignItems: "center",
              padding: "10px 12px",
              background: "#fafbff",
              borderRadius: 10
            }}
          >
            <div style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>
              {r.label}
            </div>
            <div>
              {r.bar != null ? (
                <div
                  style={{
                    height: 10,
                    background: "#f1f5f9",
                    borderRadius: 999,
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, Number(r.bar) || 0))}%`,
                      height: "100%",
                      background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DEEPEST})`
                    }}
                  />
                </div>
              ) : (
                <div style={{ height: 10 }} />
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: BVC.DARK, textAlign: "right" }}>
              {r.stars != null
                ? <span style={{ color: BVC.ACCENT, letterSpacing: 2 }}>
                    {"★".repeat(r.stars)}<span style={{ color: "#e5e7eb" }}>{"★".repeat(5 - r.stars)}</span>
                  </span>
                : `${r.value ?? 0}${r.suffix}`}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


// =================================================================
// 7. MONTHLY PRODUCTIVITY CHART — inline SVG
// =================================================================

function MonthlyProductivityChart({ data }) {

  const months = (data || []).slice(-6);
  const [hover, setHover] = useState(null);

  if (months.length === 0) {
    return (
      <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>Monthly Productivity</div>
        <EmptyState message="Monthly productivity data will appear after your first completed month." />
      </section>
    );
  }

  const W = 640;
  const H = 240;
  const padL = 40, padR = 16, padT = 16, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barWidth = innerW / months.length * 0.6;
  const gap = innerW / months.length * 0.4;
  const yMax = 100;

  const yFor = (v) => padT + (1 - v / yMax) * innerH;

  return (
    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>
        Monthly Productivity (last 6 months)
      </div>

      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", maxHeight: 280 }}
          role="img"
        >
          {/* gridlines */}
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yFor(g)}
                y2={yFor(g)}
                stroke="#e2e8f0"
                strokeDasharray={g === 0 ? "0" : "3 3"}
              />
              <text
                x={padL - 6}
                y={yFor(g) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#94a3b8"
              >
                {g}
              </text>
            </g>
          ))}

          {/* bars */}
          {months.map((m, idx) => {
            const score = Math.max(0, Math.min(100, Number(m.score || 0)));
            const x = padL + idx * (barWidth + gap) + gap / 2;
            const y = yFor(score);
            const h = innerH - (y - padT);
            return (
              <g
                key={idx}
                onMouseEnter={() => setHover({ idx, m, x: x + barWidth / 2, y })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  rx={4}
                  fill={BVC.PRIMARY}
                  style={{ transition: "opacity 0.2s" }}
                  opacity={hover && hover.idx !== idx ? 0.45 : 1}
                />
                <text
                  x={x + barWidth / 2}
                  y={H - padB + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#475569"
                  fontWeight="600"
                >
                  {m.month_label || m.label || `M${idx + 1}`}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize="10"
                  fill={BVC.DEEPEST}
                  fontWeight="700"
                >
                  {score}
                </text>
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            style={{
              position: "absolute",
              left: `${(hover.x / W) * 100}%`,
              top: `${(hover.y / H) * 100}%`,
              transform: "translate(-50%, -110%)",
              background: BVC.INK,
              color: "#fff",
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 11,
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              whiteSpace: "nowrap"
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 2 }}>
              {hover.m.month_label || hover.m.label}
            </div>
            <div>Score: {hover.m.score ?? 0}</div>
            <div>Completed: {hover.m.tasks_completed ?? 0}</div>
            <div>On-time: {hover.m.on_time_pct ?? 0}%</div>
          </div>
        )}
      </div>
    </section>
  );
}


// =================================================================
// 8. ATTENDANCE SUMMARY CARD
// =================================================================

function AttendanceSummaryCard({ attendance }) {

  const tiles = [
    { key: "present",    label: "Present",    color: "#16a34a" },
    { key: "absent",     label: "Absent",     color: "#dc2626" },
    { key: "leave",      label: "Leave",      color: BVC.ACCENT },
    { key: "permission", label: "Permission", color: "#0891b2" }
  ];

  const pct = Math.max(0, Math.min(100, Number(attendance?.percentage || 0)));

  return (
    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>
        Attendance — this month
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 18,
          alignItems: "center"
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.key}
              style={{
                border: "1px solid #f1f5f9",
                borderLeft: `4px solid ${t.color}`,
                borderRadius: 10,
                padding: "12px 14px"
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 900, color: t.color, lineHeight: 1.1 }}>
                {attendance?.[t.key] ?? 0}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: BVC.MUTED,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase"
                }}
              >
                {t.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DEEPEST})`,
            color: "#fff",
            borderRadius: 12,
            padding: "16px 22px",
            textAlign: "center",
            minWidth: 140,
            boxShadow: "0 8px 22px rgba(200,16,46,0.25)"
          }}
        >
          <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1 }}>
            {pct}%
          </div>
          <div
            style={{
              ...SECTION_LABEL,
              color: "#fff",
              opacity: 0.85,
              marginTop: 6
            }}
          >
            Monthly
          </div>
        </div>
      </div>
    </section>
  );
}


// =================================================================
// 9. REWARDS CARD
// =================================================================

function RewardsCard({ productivity }) {
  const points = Number(productivity?.points_total || 0);
  const streak = Number(productivity?.current_streak || 0);
  const badge = productivity?.badge || "Getting Started";

  const badgeTheme = badge === "On Fire"
    ? { bg: BVC.ACCENT, fg: BVC.DEEPEST }
    : badge === "Steady"
      ? { bg: BVC.PRIMARY, fg: "#fff" }
      : { bg: "#e5e7eb", fg: "#475569" };

  return (
    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>
        Rewards
      </div>
      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 200,
            background: `linear-gradient(135deg, ${BVC.DEEPEST}, ${BVC.INK})`,
            color: "#fff",
            borderRadius: 12,
            padding: "20px 22px"
          }}
        >
          <div
            style={{
              ...SECTION_LABEL,
              color: BVC.ACCENT,
              opacity: 0.9
            }}
          >
            Points Total
          </div>
          <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1, marginTop: 6 }}>
            {points.toLocaleString()}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 200,
            border: `1px solid ${BVC.BORDER}`,
            borderRadius: 12,
            padding: "18px 22px",
            background: "#fff"
          }}
        >
          <div style={SECTION_LABEL}>Current Streak</div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: BVC.DARK,
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}
          >
            {streak >= 5 && <span aria-hidden="true">🔥</span>}
            {streak} day{streak === 1 ? "" : "s"}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 200,
            border: `1px solid ${BVC.BORDER}`,
            borderRadius: 12,
            padding: "18px 22px",
            background: "#fff",
            textAlign: "center"
          }}
        >
          <div style={SECTION_LABEL}>Badge</div>
          <div
            style={{
              marginTop: 8,
              display: "inline-block",
              padding: "8px 16px",
              borderRadius: 999,
              background: badgeTheme.bg,
              color: badgeTheme.fg,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase"
            }}
          >
            {badge === "On Fire" ? "🔥 " : ""}{badge}
          </div>
        </div>
      </div>
    </section>
  );
}


// =================================================================
// SHARED — empty state, card base, topbar btn
// =================================================================

const cardBase = {
  background: "#fff",
  borderRadius: 12,
  boxShadow: CARD_SHADOW,
  padding: 16
};

const topbarBtn = {
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.2)",
  padding: "6px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700
};

function EmptyState({ message }) {
  return (
    <div
      style={{
        padding: "22px 16px",
        textAlign: "center",
        color: BVC.MUTED,
        background: "#fafbff",
        border: "1px dashed #e2e8f0",
        borderRadius: 10,
        fontSize: 13
      }}
    >
      {message}
    </div>
  );
}


// =================================================================
// LEAVE & PERMISSION SECTION (retained from previous build)
// =================================================================

function LeavePermissionSection({
  balance, leaveHistory, permissionHistory,
  onSubmitLeave, onSubmitPermission, onCancel
}) {
  return (
    <section
      style={{
        marginTop: 18,
        background: `linear-gradient(135deg, ${BVC.TINT} 0%, #fff7ed 100%)`,
        border: `1px solid ${BVC.BORDER}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: CARD_SHADOW
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={SECTION_LABEL}>
          🌴 Leave &amp; Permission
        </div>
        <div style={{ fontSize: 13, color: "#7c2d12", marginTop: 2 }}>
          Apply for leave or a short-duration permission. All requests are
          emailed to your manager for approval.
        </div>
      </div>

      {balance && <InlineBalanceRow balance={balance} />}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 16
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <InlineApplyLeaveForm onSubmit={onSubmitLeave} />
          <InlineApplyPermissionForm onSubmit={onSubmitPermission} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <LeaveHistoryList
            rows={leaveHistory.filter(
              (r) => (r.LEAVE_TYPE || "").toUpperCase() !== "PERMISSION"
            )}
            onCancel={onCancel}
          />
          <PermissionHistoryList
            rows={permissionHistory}
            onCancel={onCancel}
          />
        </div>
      </div>
    </section>
  );
}


function InlineBalanceRow({ balance }) {
  const types = ["CASUAL", "SICK", "EARNED"];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 14
      }}
    >
      {types.map((t) => {
        const b = balance[t];
        if (!b) return null;
        const pct = Math.max(0, Math.min(100, (b.remaining / b.total) * 100));
        return (
          <div
            key={t}
            style={{
              background: "white",
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${BVC.BORDER}`,
              borderTop: `3px solid ${LEAVE_TYPE_THEMES[t]}`
            }}
          >
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
              color: "#64748b", textTransform: "uppercase"
            }}>
              {t} leave
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: BVC.TEXT, marginTop: 2 }}>
              {b.remaining}
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
                {" "}/ {b.total}d
              </span>
            </div>
            <div style={{
              height: 4, background: "#f1f5f9", borderRadius: 999,
              marginTop: 6, overflow: "hidden"
            }}>
              <div style={{
                height: "100%", width: `${pct}%`,
                background: LEAVE_TYPE_THEMES[t], borderRadius: 999
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function InlineApplyLeaveForm({ onSubmit }) {

  const [leaveType, setLeaveType] = useState("CASUAL");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const days = (() => {
    if (halfDay) return 0.5;
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    return Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
  })();

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setOk("");
    if (!reason.trim()) {
      setErr("Reason is required — every leave needs manager approval.");
      return;
    }
    if (days <= 0) {
      setErr("Please pick a valid date range.");
      return;
    }
    setBusy(true);
    try {
      const res = await onSubmit({ leaveType, startDate, endDate, halfDay, reason });
      setOk(res?.message || "Leave request submitted for manager approval.");
      setReason("");
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Failed to apply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: "white",
        border: `1px solid ${BVC.BORDER}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: CARD_SHADOW
      }}
    >
      <div style={{
        fontSize: 14, fontWeight: 800, color: BVC.DARK,
        marginBottom: 12, display: "flex", alignItems: "center", gap: 8
      }}>
        <span style={{
          background: BVC.PRIMARY, color: "white",
          width: 24, height: 24, borderRadius: 6,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 13
        }}>📅</span>
        Apply for Leave
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8, marginBottom: 10
      }}>
        <LabeledField label="Type">
          <select
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value)}
            style={inputStyle}
          >
            <option value="CASUAL">Casual</option>
            <option value="SICK">Sick</option>
            <option value="EARNED">Earned</option>
            <option value="UNPAID">Unpaid</option>
            <option value="LOP">Loss of Pay</option>
          </select>
        </LabeledField>

        <LabeledField label="From">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
            style={inputStyle}
          />
        </LabeledField>

        <LabeledField label="To">
          <input
            type="date"
            value={endDate}
            min={startDate}
            disabled={halfDay}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ ...inputStyle, background: halfDay ? "#f1f5f9" : "white" }}
          />
        </LabeledField>
      </div>

      <label style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, color: "#475569", marginBottom: 10, cursor: "pointer"
      }}>
        <input
          type="checkbox"
          checked={halfDay}
          onChange={(e) => {
            setHalfDay(e.target.checked);
            if (e.target.checked) setEndDate(startDate);
          }}
        />
        Half-day leave (0.5 day)
      </label>

      <LabeledField label="Reason (required)">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Manager will read this before approving..."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </LabeledField>

      {err && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca",
          color: "#b91c1c", padding: 8, borderRadius: 6,
          fontSize: 12, marginTop: 8
        }}>{err}</div>
      )}

      {ok && (
        <div style={{
          background: "#dcfce7", border: "1px solid #86efac",
          color: "#166534", padding: 8, borderRadius: 6,
          fontSize: 12, marginTop: 8
        }}>{ok}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 12,
          width: "100%",
          border: "none",
          background: busy
            ? "#94a3b8"
            : `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`,
          color: "white",
          padding: "10px 16px",
          borderRadius: 8,
          fontWeight: 800,
          cursor: busy ? "not-allowed" : "pointer",
          fontSize: 13,
          boxShadow: "0 6px 14px rgba(200,16,46,0.25)"
        }}
      >
        {busy ? "Submitting…" : `📧 Submit Leave (${days || 0} day${days === 1 ? "" : "s"})`}
      </button>
    </form>
  );
}


function InlineApplyPermissionForm({ onSubmit }) {

  const [startTime, setStartTime] = useState(nowDateTimeLocal());
  const [durationHours, setDurationHours] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setOk("");
    if (!startTime) { setErr("Pick a start date & time."); return; }
    if (!durationHours || Number(durationHours) <= 0) {
      setErr("Duration must be greater than 0 hours."); return;
    }
    if (!reason.trim()) {
      setErr("Reason is required."); return;
    }
    setBusy(true);
    try {
      const res = await onSubmit({ startTime, durationHours, reason });
      setOk(res?.message || "Permission request submitted.");
      setReason("");
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Failed to submit permission");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: "white",
        border: `1px solid ${BVC.BORDER}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: CARD_SHADOW
      }}
    >
      <div style={{
        fontSize: 14, fontWeight: 800, color: BVC.DARK,
        marginBottom: 12, display: "flex", alignItems: "center", gap: 8
      }}>
        <span style={{
          background: BVC.ACCENT, color: BVC.DARK,
          width: 24, height: 24, borderRadius: 6,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 13
        }}>⏱</span>
        Apply for Permission (short hours)
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "2fr 1fr",
        gap: 8, marginBottom: 10
      }}>
        <LabeledField label="Start (date & time)">
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={inputStyle}
          />
        </LabeledField>

        <LabeledField label="Hours">
          <input
            type="number"
            min={0.25}
            step={0.25}
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
            style={inputStyle}
          />
        </LabeledField>
      </div>

      <LabeledField label="Reason (required)">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Doctor visit, bank work…"
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </LabeledField>

      {err && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca",
          color: "#b91c1c", padding: 8, borderRadius: 6,
          fontSize: 12, marginTop: 8
        }}>{err}</div>
      )}

      {ok && (
        <div style={{
          background: "#dcfce7", border: "1px solid #86efac",
          color: "#166534", padding: 8, borderRadius: 6,
          fontSize: 12, marginTop: 8
        }}>{ok}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 12,
          width: "100%",
          border: "none",
          background: busy
            ? "#94a3b8"
            : `linear-gradient(135deg, ${BVC.ACCENT}, #d97706)`,
          color: "white",
          padding: "10px 16px",
          borderRadius: 8,
          fontWeight: 800,
          cursor: busy ? "not-allowed" : "pointer",
          fontSize: 13,
          boxShadow: "0 6px 14px rgba(244,179,36,0.3)"
        }}
      >
        {busy ? "Submitting…" : `⏱ Submit Permission (${Number(durationHours) || 0}h)`}
      </button>
    </form>
  );
}


function LeaveHistoryList({ rows, onCancel }) {
  return (
    <div style={{
      background: "white",
      border: `1px solid ${BVC.BORDER}`,
      borderRadius: 12,
      padding: 14,
      boxShadow: CARD_SHADOW
    }}>
      <div style={{
        fontSize: 13, fontWeight: 800, color: BVC.DARK,
        marginBottom: 10, display: "flex", justifyContent: "space-between"
      }}>
        <span>📜 Leave History</span>
        <span style={{
          fontSize: 11, color: "#94a3b8", fontWeight: 600
        }}>
          {rows.length} request{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 && (
        <div style={{
          fontSize: 12, color: "#94a3b8",
          textAlign: "center", padding: 20
        }}>
          No leave requests yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const pill = LEAVE_STATUS_PILL[r.STATUS] || LEAVE_STATUS_PILL.PENDING_APPROVAL;
          const canCancel = r.STATUS === "PENDING_APPROVAL" || r.STATUS === "APPROVED";
          return (
            <div
              key={r.ID}
              style={{
                background: "#fafafa",
                border: "1px solid #f1f5f9",
                borderRadius: 8,
                padding: "10px 12px"
              }}
            >
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 8, marginBottom: 4
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 0.6,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: `${LEAVE_TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"}22`,
                    color: LEAVE_TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"
                  }}>
                    {r.LEAVE_TYPE}
                  </span>
                  <span style={{ fontSize: 12, color: "#475569" }}>
                    {r.START_DATE}
                    {r.END_DATE !== r.START_DATE ? ` → ${r.END_DATE}` : ""}
                    {" · "}
                    <strong>{r.DAYS}d</strong>
                  </span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  padding: "3px 8px", borderRadius: 999,
                  background: pill.bg, color: pill.fg
                }}>
                  {pill.label}
                </span>
              </div>
              {r.REASON && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  {r.REASON}
                </div>
              )}
              {r.REJECTION_REASON && (
                <div style={{
                  fontSize: 11, color: "#b91c1c",
                  marginTop: 4, fontStyle: "italic"
                }}>
                  ⚠ {r.REJECTION_REASON}
                </div>
              )}
              {canCancel && (
                <div style={{ textAlign: "right", marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => onCancel(r.ID)}
                    style={{
                      border: `1px solid ${BVC.BORDER}`,
                      background: "white",
                      color: BVC.DARK,
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    Cancel request
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function PermissionHistoryList({ rows, onCancel }) {
  return (
    <div style={{
      background: "white",
      border: `1px solid ${BVC.BORDER}`,
      borderRadius: 12,
      padding: 14,
      boxShadow: CARD_SHADOW
    }}>
      <div style={{
        fontSize: 13, fontWeight: 800, color: BVC.DARK,
        marginBottom: 10, display: "flex", justifyContent: "space-between"
      }}>
        <span>⏱ Permission History</span>
        <span style={{
          fontSize: 11, color: "#94a3b8", fontWeight: 600
        }}>
          {rows.length} request{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 && (
        <div style={{
          fontSize: 12, color: "#94a3b8",
          textAlign: "center", padding: 20
        }}>
          No permission requests yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const pill = LEAVE_STATUS_PILL[r.STATUS] || LEAVE_STATUS_PILL.PENDING_APPROVAL;
          const canCancel = r.STATUS === "PENDING_APPROVAL" || r.STATUS === "APPROVED";
          const startLabel = r.START_TIME ? fmtDateTime(r.START_TIME) : (r.START_DATE || "—");
          return (
            <div
              key={r.ID}
              style={{
                background: "#fafafa",
                border: "1px solid #f1f5f9",
                borderRadius: 8,
                padding: "10px 12px"
              }}
            >
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 8, marginBottom: 4
              }}>
                <div style={{ fontSize: 12, color: "#475569" }}>
                  🕒 <strong>{startLabel}</strong>
                  {" · "}
                  <span style={{ color: BVC.DARK, fontWeight: 700 }}>
                    {r.DURATION_HOURS != null ? `${r.DURATION_HOURS}h` : "—"}
                  </span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  padding: "3px 8px", borderRadius: 999,
                  background: pill.bg, color: pill.fg
                }}>
                  {pill.label}
                </span>
              </div>
              {r.REASON && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  {r.REASON}
                </div>
              )}
              {r.REJECTION_REASON && (
                <div style={{
                  fontSize: 11, color: "#b91c1c",
                  marginTop: 4, fontStyle: "italic"
                }}>
                  ⚠ {r.REJECTION_REASON}
                </div>
              )}
              {canCancel && (
                <div style={{ textAlign: "right", marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => onCancel(r.ID)}
                    style={{
                      border: `1px solid ${BVC.BORDER}`,
                      background: "white",
                      color: BVC.DARK,
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    Cancel request
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// =================================================================
// FORM PRIMITIVES (shared)
// =================================================================

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box"
};


function LabeledField({ label, children }) {
  return (
    <div>
      <label style={{
        fontSize: 10, color: "#64748b",
        display: "block", marginBottom: 4,
        fontWeight: 700, letterSpacing: 0.5,
        textTransform: "uppercase"
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


// =================================================================
// PRODUCTION STAGES SECTION (retained — red theme)
// =================================================================

function ProductionStagesSection({ stages, busyMap, onUpdate }) {

  const stageTypeColor = {
    DESIGN: "#8b5cf6",
    MECHANICAL: "#3b82f6",
    ELECTRICAL: "#06b6d4",
    WIRING: "#0ea5e9",
    FABRICATION: "#f59e0b",
    ASSEMBLY: "#10b981",
    TESTING: "#ec4899",
    QC: "#ef4444",
    PACKAGING: "#64748b",
    OTHER: "#94a3b8"
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC.TINT} 0%, #fff7ed 100%)`,
      border: `1px solid ${BVC.BORDER}`,
      borderRadius: 14,
      padding: 18,
      marginBottom: 18,
      boxShadow: CARD_SHADOW
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12
      }}>
        <div>
          <div style={SECTION_LABEL}>
            🏭 Production Stages ({stages.length})
          </div>
          <div style={{ fontSize: 13, color: "#7c2d12", marginTop: 2 }}>
            Work-Order tasks assigned to you. Tap <b>Start</b> when you
            begin and <b>Complete</b> when done — production tracking
            updates automatically.
          </div>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 12
      }}>
        {stages.map((s) => {
          const key = `${s.WORK_ORDER_ID}-${s.STAGE_ID}`;
          const busy = busyMap?.[key];
          const inProgress = s.STATUS === "IN_PROGRESS";
          const typeColor = stageTypeColor[s.STAGE_TYPE] || "#94a3b8";
          return (
            <div
              key={key}
              style={{
                background: "white",
                borderRadius: 12,
                padding: 14,
                border: `1.5px solid ${inProgress ? "#f59e0b" : BVC.BORDER}`,
                boxShadow: inProgress
                  ? "0 6px 18px rgba(245,158,11,0.18)"
                  : CARD_SHADOW
              }}
            >
              <div style={{
                display: "flex", gap: 8,
                alignItems: "center", marginBottom: 8
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: `${typeColor}22`,
                  color: typeColor,
                  fontSize: 12, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "ui-monospace, monospace"
                }}>
                  {s.SEQUENCE}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 800, color: "#0f172a",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>
                    {s.STAGE_NAME}
                  </div>
                  <div style={{
                    fontSize: 10, color: typeColor,
                    fontWeight: 700, letterSpacing: 0.5
                  }}>
                    {s.STAGE_TYPE} · {s.ESTIMATED_HOURS}h
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                  padding: "3px 8px", borderRadius: 999,
                  background: inProgress ? "#fef3c7" : "#f1f5f9",
                  color: inProgress ? "#854d0e" : "#475569"
                }}>
                  {s.STATUS.replace("_", " ")}
                </span>
              </div>

              <div style={{
                fontSize: 11, color: "#475569", lineHeight: 1.5,
                padding: "8px 10px", background: "#f8fafc",
                borderRadius: 8, marginBottom: 10
              }}>
                <div>
                  📦 <b>{s.PRODUCT_NAME || "—"}</b>
                  {s.QUANTITY ? ` × ${s.QUANTITY}` : ""}
                </div>
                {s.CUSTOMER_NAME && <div>👤 {s.CUSTOMER_NAME}</div>}
                <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>
                  {s.WO_NUMBER}
                  {s.PROJECT_NAME ? ` · ${s.PROJECT_NAME}` : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {s.STATUS === "PENDING" && (
                  <button
                    disabled={busy}
                    onClick={() => onUpdate(s, "IN_PROGRESS")}
                    style={{
                      flex: 1, padding: "9px 12px",
                      background: "linear-gradient(135deg, #f59e0b, #d97706)",
                      color: "white", border: "none", borderRadius: 8,
                      fontWeight: 800, fontSize: 12,
                      cursor: busy ? "wait" : "pointer",
                      boxShadow: "0 4px 12px rgba(245,158,11,0.3)"
                    }}
                  >
                    {busy ? "…" : "▶ Start"}
                  </button>
                )}

                {s.STATUS !== "DONE" && (
                  <button
                    disabled={busy}
                    onClick={() => onUpdate(s, "DONE")}
                    style={{
                      flex: 1, padding: "9px 12px",
                      background: "linear-gradient(135deg, #16a34a, #15803d)",
                      color: "white", border: "none", borderRadius: 8,
                      fontWeight: 800, fontSize: 12,
                      cursor: busy ? "wait" : "pointer",
                      boxShadow: "0 4px 12px rgba(22,163,74,0.3)"
                    }}
                  >
                    {busy ? "…" : "✓ Complete"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// =====================================================================
// MY MEMOS — employee-side view of their own memos
//
// Self-contained: fetches via /memos/employee/<EMPLOYEE_CODE> (the
// backend accepts both UUID and code). Shows latest 5 by default with
// an "Show All" toggle. Lets the employee acknowledge memos they
// haven't seen yet. Read-only otherwise — HR is the editor.
// =====================================================================

function MyMemosCard({ employeeId }) {

  const [memos, setMemos] = useState([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [openMemo, setOpenMemo] = useState(null);

  const [showAll, setShowAll] = useState(false);

  const [filter, setFilter] = useState("ALL");
  // ALL | PENDING | ACKNOWLEDGED

  const [ackBusy, setAckBusy] = useState(false);

  const load = async () => {

    if (!employeeId) return;

    setLoading(true);

    setError("");

    try {

      const res = await API.get(`/memos/employee/${encodeURIComponent(employeeId)}`);

      setMemos(Array.isArray(res.data) ? res.data : []);

    } catch (e) {

      const status = e?.response?.status;

      if (status === 404) {

        setError("");                  // no memos / employee not found

        setMemos([]);

      } else {

        setError(e?.response?.data?.detail || "Failed to load memos.");
      }

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    load();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const filtered = memos.filter((m) => {

    if (filter === "PENDING")      return !m.ACKNOWLEDGED_BY_EMPLOYEE;

    if (filter === "ACKNOWLEDGED") return  m.ACKNOWLEDGED_BY_EMPLOYEE;

    return true;
  });

  const visible = showAll ? filtered : filtered.slice(0, 5);

  const counts = {
    total:        memos.length,
    pendingAck:   memos.filter((m) => !m.ACKNOWLEDGED_BY_EMPLOYEE).length,
    warnings:     memos.filter((m) => m.MEMO_TYPE === "WARNING").length,
    appreciations: memos.filter((m) =>
      m.MEMO_TYPE === "APPRECIATION" || m.MEMO_TYPE === "PERFORMANCE_RECOGNITION"
    ).length
  };

  const acknowledge = async (memo) => {

    if (memo.ACKNOWLEDGED_BY_EMPLOYEE) return;

    setAckBusy(true);

    try {

      await API.post(`/memos/${memo.ID}/acknowledge`, {});

      await load();

      setOpenMemo((prev) => prev && prev.ID === memo.ID
        ? { ...prev, ACKNOWLEDGED_BY_EMPLOYEE: true, ACKNOWLEDGED_DATE: new Date().toISOString() }
        : prev);

    } catch {
      /* non-fatal */
    } finally {

      setAckBusy(false);
    }
  };

  return (

    <section style={{ ...cardBase, padding: 18, marginBottom: 18 }}>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 12,
        gap: 12,
        flexWrap: "wrap"
      }}>
        <div>
          <div style={{ ...SECTION_LABEL }}>📋 My Memos</div>
          <div style={{ fontSize: 12, color: BVC.MUTED, marginTop: 2 }}>
            Official records issued to you by HR / Management.
          </div>
        </div>

        {memos.length > 0 && (

          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <MiniStat label="Total"        value={counts.total}        color={BVC.INK} />
            <MiniStat label="To Ack"       value={counts.pendingAck}   color="#f59e0b" />
            <MiniStat label="Warnings"     value={counts.warnings}     color="#dc2626" />
            <MiniStat label="Appreciations"value={counts.appreciations}color="#16a34a" />
          </div>
        )}
      </div>

      {/* Pending Ack callout */}
      {counts.pendingAck > 0 && filter === "ALL" && (

        <div
          onClick={() => setFilter("PENDING")}
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 13,
            color: "#9a3412",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          ⏳ You have <strong>{counts.pendingAck}</strong> memo
          {counts.pendingAck !== 1 ? "s" : ""} waiting for your acknowledgement.
          <span style={{ marginLeft: 6, color: "#c2410c", textDecoration: "underline" }}>
            Show only those →
          </span>
        </div>
      )}

      {/* Filter chips */}
      {memos.length > 0 && (

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[
            { key: "ALL",          label: "All" },
            { key: "PENDING",      label: `Pending (${counts.pendingAck})` },
            { key: "ACKNOWLEDGED", label: `Acknowledged (${counts.total - counts.pendingAck})` }
          ].map((c) => (

            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              style={{
                background: filter === c.key ? BVC.PRIMARY : "white",
                color:      filter === c.key ? "white" : BVC.TEXT,
                border:    `1px solid ${filter === c.key ? BVC.PRIMARY : "#e2e8f0"}`,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: 0.3
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading / empty / error states */}
      {loading && (
        <div style={{ padding: 20, color: BVC.MUTED, fontSize: 13 }}>
          Loading memos…
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 14px", background: "#fef2f2",
          border: "1px solid #fecaca", borderRadius: 8,
          color: "#991b1b", fontSize: 13
        }}>
          {error}
        </div>
      )}

      {!loading && !error && memos.length === 0 && (
        <EmptyState message="You have no memos on record. 👍" />
      )}

      {!loading && !error && filtered.length === 0 && memos.length > 0 && (
        <div style={{
          padding: 24, textAlign: "center", color: BVC.MUTED, fontSize: 13
        }}>
          No memos match this filter.
        </div>
      )}

      {/* Memo list */}
      {!loading && visible.length > 0 && (

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((m) => (
            <MemoRow key={m.ID} memo={m} onOpen={() => setOpenMemo(m)} />
          ))}
        </div>
      )}

      {filtered.length > 5 && !showAll && (
        <div style={{ marginTop: 10, textAlign: "center" }}>
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: "white", border: `1px solid ${BVC.BORDER}`,
              color: BVC.DARK, padding: "6px 14px", borderRadius: 6,
              fontSize: 12, fontWeight: 700, cursor: "pointer"
            }}
          >
            Show all {filtered.length} memos →
          </button>
        </div>
      )}

      {/* Detail modal */}
      {openMemo && (
        <MyMemoDetail
          memo={openMemo}
          onClose={() => setOpenMemo(null)}
          onAcknowledge={() => acknowledge(openMemo)}
          ackBusy={ackBusy}
        />
      )}
    </section>
  );
}


function MiniStat({ label, value, color }) {

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.8, color: BVC.MUTED,
        textTransform: "uppercase"
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20, fontWeight: 800, color, letterSpacing: -0.3, marginTop: 1
      }}>
        {value}
      </div>
    </div>
  );
}


const MEMO_TYPE_THEME = {
  WARNING:                { emoji: "⚠️", color: "#dc2626", bg: "#fef2f2", label: "Warning" },
  APPRECIATION:           { emoji: "👏", color: "#16a34a", bg: "#dcfce7", label: "Appreciation" },
  DISCIPLINARY:           { emoji: "🚫", color: "#991b1b", bg: "#fee2e2", label: "Disciplinary" },
  INFORMATION:            { emoji: "ℹ️", color: "#2563eb", bg: "#dbeafe", label: "Information" },
  CUSTOMER_COMPLAINT:     { emoji: "📨", color: "#ea580c", bg: "#fff7ed", label: "Customer Complaint" },
  PERFORMANCE_RECOGNITION:{ emoji: "🏆", color: "#0d9488", bg: "#ccfbf1", label: "Recognition" },
  SHOW_CAUSE_NOTICE:      { emoji: "📜", color: "#7c2d12", bg: "#fef3c7", label: "Show Cause" }
};


const MEMO_SEV_THEME = {
  LOW:      { color: "#10b981", bg: "#dcfce7" },
  MEDIUM:   { color: "#f59e0b", bg: "#fef3c7" },
  HIGH:     { color: "#ef4444", bg: "#fee2e2" },
  CRITICAL: { color: "#7c2d12", bg: "#fef2f2" }
};


function MemoRow({ memo, onOpen }) {

  const tt = MEMO_TYPE_THEME[memo.MEMO_TYPE] || MEMO_TYPE_THEME.INFORMATION;

  const st = MEMO_SEV_THEME[memo.SEVERITY]   || MEMO_SEV_THEME.LOW;

  return (
    <div
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "12px 14px",
        border: `1px solid ${memo.ACKNOWLEDGED_BY_EMPLOYEE ? "#e2e8f0" : tt.color + "55"}`,
        borderRadius: 10,
        background: memo.ACKNOWLEDGED_BY_EMPLOYEE ? "white" : tt.bg + "55",
        cursor: "pointer",
        transition: "all 0.15s"
      }}
      onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(15,23,42,0.08)"}
      onMouseLeave={(e) => e.currentTarget.style.boxShadow = "none"}
    >
      {/* Type emoji avatar */}
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: tt.color + "22",
        color: tt.color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18
      }}>
        {tt.emoji}
      </div>

      {/* Subject + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: BVC.INK, marginBottom: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
        }}>
          {memo.SUBJECT}
        </div>
        <div style={{ fontSize: 11, color: BVC.MUTED, display: "flex", gap: 10 }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#475569" }}>
            {memo.MEMO_NUMBER}
          </span>
          <span>·</span>
          <span>{memo.ISSUE_DATE || "—"}</span>
          {memo.ISSUED_BY && (
            <>
              <span>·</span>
              <span>by {memo.ISSUED_BY}</span>
            </>
          )}
        </div>
      </div>

      {/* Type + Severity pills */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        <span style={{
          background: tt.bg, color: tt.color, padding: "2px 8px",
          borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
          textTransform: "uppercase"
        }}>
          {tt.label}
        </span>
        <span style={{
          background: st.bg, color: st.color, padding: "1px 8px",
          borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: 0.5
        }}>
          {memo.SEVERITY}
        </span>
      </div>

      {/* Ack badge */}
      <div style={{
        width: 90, textAlign: "right", fontSize: 11, fontWeight: 800
      }}>
        {memo.ACKNOWLEDGED_BY_EMPLOYEE
          ? <span style={{ color: "#16a34a" }}>✓ Acknowledged</span>
          : <span style={{ color: "#f59e0b" }}>○ Pending</span>}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Memo → printable PDF.
//
// No PDF library in the project — the established pattern (see the
// *Print.jsx pages) is to render a print-styled document and let the
// browser "Save as PDF". We open a standalone window, write a formatted
// memo (BVC header + type ribbon + details + the attached image), and
// auto-trigger print once every image has loaded.
//
// Attachments are served by the BACKEND as relative /static/* paths, so
// they're resolved against API_BASE_URL (the frontend logo lives on the
// app origin instead).
// ---------------------------------------------------------------------
function resolveMemoAsset(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function memoAttachmentIsImage(memo) {
  const name = (memo.ATTACHMENT_NAME || memo.ATTACHMENT_URL || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(name);
}

function downloadMemoPdf(memo) {

  const tt = MEMO_TYPE_THEME[memo.MEMO_TYPE] || MEMO_TYPE_THEME.INFORMATION;

  const logoUrl = `${window.location.origin}/bharath-logo.png`;

  const attUrl  = resolveMemoAsset(memo.ATTACHMENT_URL);

  const showImage = !!attUrl && memoAttachmentIsImage(memo);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  const ackLine =
    memo.ACKNOWLEDGED_BY_EMPLOYEE && memo.ACKNOWLEDGED_DATE
      ? `Acknowledged by employee on ${new Date(memo.ACKNOWLEDGED_DATE).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
      : `Status: ${esc(memo.STATUS || "—")}`;

  const generatedOn = new Date().toLocaleDateString("en-IN", { dateStyle: "medium" });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(memo.MEMO_NUMBER || "Memo")}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Roboto, system-ui, sans-serif; color: #1f2933; }
  .page { width: 800px; margin: 0 auto; padding: 48px 56px; }
  .memono { float: right; margin-top: 30px; font-family: ui-monospace, monospace; font-weight: 700; font-size: 13px; color: ${tt.color}; }
  .top { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid ${tt.color}; padding-bottom: 18px; }
  .top img { width: 60px; height: 60px; object-fit: contain; }
  .org { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.2; }
  .org small { display: block; font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px; }
  .ribbon { display: inline-block; margin: 26px 0 14px; padding: 8px 20px; border-radius: 999px; background: ${tt.color}; color: #fff; font-weight: 800; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; }
  .subject { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 6px; }
  .meta { font-size: 13px; color: #64748b; margin-bottom: 22px; line-height: 1.7; }
  .meta b { color: #334155; }
  .desc { padding: 18px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
  .imgwrap { margin-top: 24px; text-align: center; }
  .imgwrap img { max-width: 100%; max-height: 540px; border: 1px solid #e2e8f0; border-radius: 10px; }
  .imgcap { margin-top: 6px; font-size: 11px; color: #94a3b8; }
  .foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
  @page { margin: 14mm; }
  @media print { .page { width: auto; padding: 0; } }
</style>
</head>
<body>
  <div class="page">
    <div class="memono">${esc(memo.MEMO_NUMBER || "")}</div>

    <div class="top">
      <img src="${logoUrl}" alt="" onerror="this.style.display='none'" />
      <div class="org">Bharath Vending Corporation<small>Employee Memo</small></div>
    </div>

    <div class="ribbon">${esc(tt.emoji)} ${esc(tt.label)}</div>

    <div class="subject">${esc(memo.SUBJECT || "")}</div>

    <div class="meta">
      Issued to <b>${esc(memo.EMPLOYEE_NAME || "—")}</b>${memo.EMPLOYEE_CODE ? ` (${esc(memo.EMPLOYEE_CODE)})` : ""}
      &nbsp;·&nbsp; Date: <b>${esc(memo.ISSUE_DATE || "—")}</b>
      ${memo.ISSUED_BY ? `&nbsp;·&nbsp; Issued by: <b>${esc(memo.ISSUED_BY)}</b>` : ""}
      &nbsp;·&nbsp; Severity: <b>${esc(memo.SEVERITY || "—")}</b>
    </div>

    ${memo.DESCRIPTION ? `<div class="desc">${esc(memo.DESCRIPTION)}</div>` : ""}

    ${showImage ? `<div class="imgwrap"><img src="${attUrl}" onerror="this.parentNode.style.display='none'" /><div class="imgcap">${esc(memo.ATTACHMENT_NAME || "Attachment")}</div></div>` : ""}

    <div class="foot">
      <span>${esc(ackLine)}</span>
      <span>Generated ${esc(generatedOn)}</span>
    </div>
  </div>

  <script>
    window.onload = function () {
      var imgs = document.images, total = imgs.length, done = 0;
      var go = function () { try { window.focus(); window.print(); } catch (e) {} };
      if (!total) { setTimeout(go, 200); return; }
      var tick = function () { if (++done >= total) setTimeout(go, 150); };
      for (var i = 0; i < total; i++) {
        if (imgs[i].complete) tick();
        else { imgs[i].addEventListener('load', tick); imgs[i].addEventListener('error', tick); }
      }
      setTimeout(go, 3000); // hard fallback if an image never settles
    };
  <\/script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=1000");

  if (!win) {
    alert("Please allow pop-ups for this site to download the memo PDF.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
}


function MyMemoDetail({ memo, onClose, onAcknowledge, ackBusy }) {

  const tt = MEMO_TYPE_THEME[memo.MEMO_TYPE] || MEMO_TYPE_THEME.INFORMATION;

  const st = MEMO_SEV_THEME[memo.SEVERITY]   || MEMO_SEV_THEME.LOW;

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 14,
          width: "min(620px, 100%)",
          maxHeight: "88vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 30px 80px rgba(0,0,0,0.3)"
        }}
      >

        {/* Header */}
        <div style={{
          padding: "18px 24px",
          background: `linear-gradient(135deg, ${tt.color}, ${tt.color}dd)`,
          color: "white"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, opacity: 0.85, textTransform: "uppercase" }}>
                {memo.MEMO_NUMBER}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, letterSpacing: -0.2 }}>
                {tt.emoji} {tt.label}
              </div>
              <div style={{ fontSize: 12, opacity: 0.92, marginTop: 4 }}>
                Issued {memo.ISSUE_DATE || "—"}{memo.ISSUED_BY ? ` · by ${memo.ISSUED_BY}` : ""}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.2)", color: "white", border: "none",
              padding: "4px 12px", borderRadius: 6, fontSize: 18, cursor: "pointer"
            }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <span style={{
              background: st.bg, color: st.color, padding: "3px 10px",
              borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
              textTransform: "uppercase"
            }}>
              {memo.SEVERITY}
            </span>
            <span style={{
              background: "#f1f5f9", color: "#475569", padding: "3px 10px",
              borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
              textTransform: "uppercase"
            }}>
              {memo.STATUS}
            </span>
            {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
              <span style={{
                background: "#dcfce7", color: "#15803d", padding: "3px 10px",
                borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                textTransform: "uppercase"
              }}>
                ✓ Acknowledged
              </span>
            )}
          </div>

          <div style={{ fontSize: 17, fontWeight: 800, color: BVC.INK, marginBottom: 12, letterSpacing: -0.2 }}>
            {memo.SUBJECT}
          </div>

          {memo.DESCRIPTION && (
            <div style={{
              padding: 14, background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: 10, fontSize: 13, color: "#334155",
              whiteSpace: "pre-wrap", lineHeight: 1.6, marginBottom: 14
            }}>
              {memo.DESCRIPTION}
            </div>
          )}

          {memo.ATTACHMENT_URL && (
            <div style={{ marginBottom: 14 }}>
              <a href={memo.ATTACHMENT_URL} target="_blank" rel="noreferrer"
                 style={{
                   display: "inline-flex", alignItems: "center", gap: 6,
                   color: "#2563eb", fontWeight: 700, textDecoration: "none",
                   padding: "8px 12px", border: "1px solid #bfdbfe",
                   borderRadius: 8, background: "#eff6ff", fontSize: 12
                 }}>
                📎 {memo.ATTACHMENT_NAME || "Download attachment"}
              </a>
            </div>
          )}

          {memo.ACKNOWLEDGED_BY_EMPLOYEE && memo.ACKNOWLEDGED_DATE && (
            <div style={{
              fontSize: 11, color: "#15803d", padding: "8px 12px",
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 8
            }}>
              ✓ You acknowledged this on {new Date(memo.ACKNOWLEDGED_DATE).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 22px",
          background: "#f8fafc",
          borderTop: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          gap: 10
        }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              background: "white", border: "1px solid #cbd5e1",
              color: "#475569", padding: "8px 16px", borderRadius: 8,
              fontWeight: 700, fontSize: 12, cursor: "pointer"
            }}>
              Close
            </button>

            <button onClick={() => downloadMemoPdf(memo)} style={{
              background: "white", border: `1px solid ${tt.color}`,
              color: tt.color, padding: "8px 16px", borderRadius: 8,
              fontWeight: 800, fontSize: 12, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6
            }}>
              ⬇ Download PDF
            </button>
          </div>

          {!memo.ACKNOWLEDGED_BY_EMPLOYEE && (
            <button
              onClick={onAcknowledge}
              disabled={ackBusy}
              style={{
                background: ackBusy ? "#94a3b8" : "linear-gradient(135deg, #10b981, #059669)",
                color: "white", border: "none",
                padding: "9px 22px", borderRadius: 8,
                fontWeight: 800, fontSize: 13,
                cursor: ackBusy ? "wait" : "pointer",
                letterSpacing: 0.3,
                boxShadow: "0 4px 14px rgba(16,185,129,0.30)"
              }}
            >
              {ackBusy ? "Recording…" : "✓ Acknowledge Memo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


export default EmployeeDashboard;
