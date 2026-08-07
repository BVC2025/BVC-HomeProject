import { useEffect, useRef, useState } from "react";

import API from "../services/api";

import { formatISTTime } from "../utils/time";
import styles from "./BiometricCheckIn.module.css";


// ----------------------------------------------------------------
// Live clock for the gate kiosk
// ----------------------------------------------------------------

function LiveClock() {

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {

    const id = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });

  const date = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  return (

    <div className={styles.clockWrap}>

      <div className={styles.clockTime}>
        {time}
      </div>

      <div className={styles.clockDate}>
        {date}
      </div>
    </div>
  );
}


function FingerprintIcon({ scanning }) {

  return (

    <svg
      width="140"
      height="140"
      viewBox="0 0 24 24"
      fill="none"
      stroke={scanning ? "#34d399" : "#f8fafc"}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        filter: scanning
          ? "drop-shadow(0 0 22px rgba(52,211,153,0.7))"
          : "drop-shadow(0 0 14px rgba(255,255,255,0.35))",
        transition: "all 0.3s ease"
      }}
    >
      <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28z" />
      <path d="M3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21z" />
      <path d="M9.75 21.79c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39S7.34 12.24 7.34 14.66c0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.1.1-.23.15-.37.15z" />
      <path d="M16.92 19.94c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12z" />
      <path d="M14.91 21.99c-.04 0-.09-.01-.13-.02-1.59-.44-2.63-1.03-3.72-2.1-1.4-1.39-2.17-3.24-2.17-5.21 0-1.62 1.38-2.94 3.08-2.94s3.08 1.32 3.08 2.94c0 1.07.93 1.94 2.08 1.94s2.08-.87 2.08-1.94c0-3.77-3.25-6.83-7.25-6.83-2.84 0-5.44 1.58-6.61 4.03-.39.81-.59 1.76-.59 2.8 0 .78.07 2.01.67 3.61.1.26-.03.55-.29.64-.26.1-.55-.04-.64-.29-.49-1.31-.73-2.61-.73-3.96 0-1.2.23-2.29.68-3.24 1.33-2.79 4.28-4.6 7.51-4.6 4.55 0 8.25 3.51 8.25 7.83 0 1.62-1.38 2.94-3.08 2.94s-3.08-1.32-3.08-2.94c0-1.07-.93-1.94-2.08-1.94s-2.08.87-2.08 1.94c0 1.7.66 3.29 1.87 4.5.95.94 1.86 1.46 3.27 1.85.27.07.42.35.35.61-.05.23-.26.38-.47.38z" />
    </svg>
  );
}


// ----------------------------------------------------------------
// Action-specific card variants
// ----------------------------------------------------------------

const ACTION_THEMES = {
  CHECKED_IN: {
    accent: "#10b981",
    bg: "#d1fae5",
    fg: "#047857",
    label: "Checked In"
  },
  TASK_IN_PROGRESS: {
    accent: "#3b82f6",
    bg: "#dbeafe",
    fg: "#1e40af",
    label: "Task In Progress"
  },
  TASK_COMPLETED_NEXT_ASSIGNED: {
    accent: "#8b5cf6",
    bg: "#ede9fe",
    fg: "#6d28d9",
    label: "Task Done · Next Assigned"
  },
  TASK_COMPLETED_READY_TO_LEAVE: {
    accent: "#0ea5e9",
    bg: "#e0f2fe",
    fg: "#0369a1",
    label: "Task Done · Ready to Leave"
  },
  CHECKED_OUT: {
    accent: "#f59e0b",
    bg: "#fef3c7",
    fg: "#b45309",
    label: "Checked Out"
  },
  ALREADY_OUT: {
    accent: "#94a3b8",
    bg: "#f1f5f9",
    fg: "#475569",
    label: "Already Checked Out"
  }
};


function ActionBadge({ action }) {

  const theme = ACTION_THEMES[action] || ACTION_THEMES.CHECKED_IN;

  return (

    <span
      className={styles.actionBadge}
      style={{ background: theme.bg, color: theme.fg }}
    >
      {theme.label}
    </span>
  );
}


function CompletionSummary({ completion }) {

  if (!completion) return null;

  const mins = completion.minutes_before_deadline;

  const onTime = completion.on_time;

  return (

    <div
      className={styles.completionBox}
      style={{
        background: onTime ? "#ecfdf5" : "#fef2f2",
        border: `1px solid ${onTime ? "#a7f3d0" : "#fecaca"}`
      }}
    >

      <div
        className={styles.completionTitle}
        style={{ color: onTime ? "#047857" : "#b91c1c" }}
      >
        Completion Details
      </div>

      <div className={styles.completionTaskName}>
        <strong>{completion.task_name}</strong>
      </div>

      <div className={styles.completionDetail}>

        Completed at{" "}
        <strong>
          {formatISTTime(completion.completed_at)}
        </strong>

        {completion.duration_minutes !== null && (
          <> · took <strong>{completion.duration_minutes} min</strong></>
        )}

        <br />

        {onTime ? (
          <span className={styles.completionOnTime}>
            {Math.round(mins)} min before deadline ✓
          </span>
        ) : (
          <span className={styles.completionLate}>
            {Math.round(Math.abs(mins))} min past deadline
          </span>
        )}
      </div>
    </div>
  );
}


function ProjectBlock({ project, task, alloc }) {

  if (!project) return null;

  // Priority badge colours are runtime-computed from data — kept inline.
  const priorityStyle = {
    background:
      project.PRIORITY === "HIGH"
        ? "#fee2e2"
        : project.PRIORITY === "LOW"
          ? "#f1f5f9"
          : "#fef9c3",
    color:
      project.PRIORITY === "HIGH"
        ? "#b91c1c"
        : project.PRIORITY === "LOW"
          ? "#475569"
          : "#854d0e"
  };

  return (

    <div className={styles.projectBlock}>

      <div className={styles.projectBlockLabel}>
        Project Assigned
      </div>

      <div className={styles.projectName}>
        {project.PROJECT_NAME}
      </div>

      {project.DESCRIPTION && (

        <div className={styles.projectDesc}>
          {project.DESCRIPTION}
        </div>
      )}

      <div className={styles.priorityBadge} style={priorityStyle}>
        {project.PRIORITY || "MEDIUM"} PRIORITY
      </div>

      {task && (

        <div className={styles.taskBox}>
          <div className={styles.taskBoxLabel}>
            Your Task
          </div>

          <div className={styles.taskName}>
            {task.TASK_NAME}
          </div>

          <div className={styles.taskDetails}>
            {task.TASK_DETAILS}
          </div>
        </div>
      )}

      {alloc?.reason && (

        <div className={styles.aiReason}>
          <strong>AI reason:</strong> {alloc.reason}
        </div>
      )}

      {alloc?.breakdown && (

        <div className={styles.scoreBreakdown}>
          score: {alloc.score} ({alloc.breakdown})
          {alloc.sequence > 1 && (
            <span className={styles.scoreSeq}>
              · task #{alloc.sequence} today
            </span>
          )}
        </div>
      )}
    </div>
  );
}


function CheckoutSummary({ result }) {

  const att = result?.attendance || {};

  const tasks = result?.tasks_completed_today ?? 0;

  return (

    <div className={styles.checkoutBox}>

      <div className={styles.checkoutInner}>

        <div className={styles.checkoutBoxTitle}>
          Day Summary
        </div>

        <div className={styles.checkoutGrid}>

          <div>

            <div className={styles.checkoutStatLabel}>
              Worked Hours
            </div>

            <div className={styles.checkoutStatValue}>
              {att.WORKED_HOURS ?? 0} h
            </div>
          </div>

          <div>

            <div className={styles.checkoutStatLabel}>
              Tasks Done
            </div>

            <div className={styles.checkoutStatValue}>
              {tasks}
            </div>
          </div>

          <div>

            <div className={styles.checkoutStatLabel}>
              Check-In
            </div>

            <div className={styles.checkoutTimeValue}>
              {att.CHECK_IN ? formatISTTime(att.CHECK_IN) : "—"}
            </div>
          </div>

          <div>

            <div className={styles.checkoutStatLabel}>
              Check-Out
            </div>

            <div className={styles.checkoutTimeValue}>
              {att.CHECK_OUT ? formatISTTime(att.CHECK_OUT) : "—"}
            </div>
          </div>
        </div>

        {att.OVERTIME_HOURS > 0 && (

          <div className={styles.overtimeNote}>
            ✨ {att.OVERTIME_HOURS}h overtime today.
          </div>
        )}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Master card — branches on result.action
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Print Task Sheet — opens browser print dialog with a styled
// receipt that an attached USB / network printer renders. Mirrors
// the "auto-print on biometric scan" requirement.
// ----------------------------------------------------------------

function printTaskSheet(result) {

  if (!result) return;

  const emp = result.employee || {};

  const att = result.attendance || {};

  const alloc = result.allocation || {};

  const project = alloc.project;

  const task = alloc.task;

  const completion = result.completion;

  // Enriched data from the upgraded /biometric/scan response
  const pendingTasks = result.pending_tasks || [];

  const bom = result.bom_for_project || [];

  const projectQty = result.project_quantity || 1;

  const now = new Date();

  const win = window.open("", "TaskSheet", "width=420,height=720");

  if (!win) {

    alert("Allow popups to print the task sheet.");

    return;
  }

  win.document.write(`
    <html>
    <head>
      <title>Task Sheet — ${emp.NAME || ""}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 13px;
          color: #000;
          padding: 12px;
          max-width: 320px;
          margin: 0 auto;
        }
        h1 {
          text-align: center;
          font-size: 16px;
          margin: 0 0 4px;
          letter-spacing: 2px;
        }
        .sub {
          text-align: center;
          font-size: 11px;
          margin-bottom: 12px;
          color: #555;
        }
        hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; }
        .row b { font-weight: bold; }
        .label { font-size: 10px; letter-spacing: 1px; color: #555;
                 text-transform: uppercase; margin-top: 10px; }
        .big { font-size: 15px; font-weight: bold; }
        .task-box {
          border: 2px solid #000;
          padding: 10px;
          margin-top: 10px;
        }
        .actions {
          display: flex;
          justify-content: space-around;
          margin-top: 16px;
          font-size: 11px;
          letter-spacing: 1px;
        }
        .check {
          width: 18px; height: 18px;
          border: 1.5px solid #000;
          display: inline-block;
          vertical-align: middle;
          margin-right: 4px;
        }
        .footer {
          text-align: center;
          font-size: 10px;
          margin-top: 18px;
          color: #555;
        }
      </style>
    </head>
    <body>
      <h1>BVC24</h1>
      <div class="sub">Bharath Vending Corporation<br/>Daily Task Sheet</div>
      <hr/>

      <div class="row"><span>Employee</span><b>${emp.NAME || "—"}</b></div>
      <div class="row"><span>Code</span><b>${emp.EMPLOYEE_CODE || "—"}</b></div>
      <div class="row"><span>Date</span><b>${now.toLocaleDateString("en-IN")}</b></div>
      <div class="row"><span>Check-in</span><b>${att.CHECK_IN?.slice(11, 16) || now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</b></div>
      <div class="row"><span>Status</span><b>${att.STATUS || "PRESENT"}</b></div>

      ${completion ? `
        <hr/>
        <div class="label">Previous Task Completed</div>
        <div>${completion.task_name}</div>
        <div class="row">
          <span>Finished at</span>
          <b>${completion.completed_at?.slice(11,16) || ""}</b>
        </div>
        <div class="row">
          <span>Time vs deadline</span>
          <b>${completion.on_time ? "+" : ""}${Math.round(completion.minutes_before_deadline)} min</b>
        </div>
      ` : ""}

      ${project ? `
        <div class="label">Today's Project</div>
        <div class="big">${project.PROJECT_NAME}</div>
        <div style="font-size:11px;color:#555;margin-top:2px;">
          Priority: ${project.PRIORITY || "MEDIUM"}
        </div>

        ${task ? `
          <div class="task-box">
            <div class="label" style="margin-top:0;">Task</div>
            <div class="big" style="font-size:13px;margin:4px 0;">
              ${task.TASK_NAME}
            </div>
            <div style="font-size:11px;color:#555;">
              ${task.TASK_DETAILS || ""}
            </div>
            <div class="row" style="margin-top:8px;">
              <span>Assigned</span>
              <b>${task.ASSIGNED_DATE || ""}</b>
            </div>
            <div class="row">
              <span>Due by</span>
              <b>6:00 PM today</b>
            </div>
          </div>
        ` : ""}

        ${alloc.reason ? `
          <div style="font-size:10px;font-style:italic;
                      margin-top:8px;color:#555;">
            AI: ${alloc.reason}
          </div>
        ` : ""}
      ` : `
        <div class="task-box">
          <div class="big" style="font-size:13px;">
            No task allocated yet
          </div>
          <div style="font-size:11px;color:#555;margin-top:4px;">
            ${alloc.reason || "Please contact your supervisor."}
          </div>
        </div>
      `}

      ${bom.length > 0 ? `
        <hr/>
        <div class="label">
          Required Materials &middot; project &times; ${projectQty}
        </div>
        <table style="
          width:100%;
          border-collapse:collapse;
          font-size:11px;
          margin-top:4px;
        ">
          <thead>
            <tr style="border-bottom:1px solid #000;">
              <th style="text-align:left;padding:2px 4px;width:30px;">#</th>
              <th style="text-align:left;padding:2px 4px;">Material</th>
              <th style="text-align:right;padding:2px 4px;width:50px;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${bom.map((b) => `
              <tr>
                <td style="padding:2px 4px;vertical-align:top;">
                  ${b.ITEM_NO ?? "—"}
                </td>
                <td style="padding:2px 4px;">
                  <span class="check" style="width:10px;height:10px;margin-right:4px;"></span>
                  ${b.MATERIAL_NAME || ""}
                </td>
                <td style="padding:2px 4px;text-align:right;
                           font-weight:bold;vertical-align:top;">
                  ${b.TOTAL_QUANTITY} ${b.UNIT || ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="font-size:9px;color:#555;margin-top:4px;
                    font-style:italic;">
          Tick the box once you've picked up the material from stores.
        </div>
      ` : ""}

      ${pendingTasks.length > 0 ? `
        <hr/>
        <div class="label">
          Other Pending Tasks (${pendingTasks.length})
        </div>
        ${pendingTasks.map((t) => `
          <div style="
            font-size:11px;
            padding:4px 0;
            border-bottom:1px dotted #999;
          ">
            <div style="display:flex;justify-content:space-between;">
              <div style="flex:1;">
                <b>${t.TASK_NAME || "—"}</b>
                ${t.PROJECT_NAME ? `
                  <div style="color:#555;font-size:10px;">
                    ${t.PROJECT_NAME}
                  </div>
                ` : ""}
              </div>
              <div style="font-size:9px;color:#555;text-align:right;
                          margin-left:6px;">
                ${t.TASK_STATUS || ""}
                ${t.DUE_DATE ? `
                  <div>due ${t.DUE_DATE.slice(5)}</div>
                ` : ""}
              </div>
            </div>
          </div>
        `).join("")}
      ` : ""}

      <div class="actions">
        <div><span class="check"></span>START</div>
        <div><span class="check"></span>HOLD</div>
        <div><span class="check"></span>COMPLETED</div>
      </div>

      <div class="footer">
        Tick the box once you finish. Re-scan your finger at
        the gate when the task is done.
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 150);
        };
      </script>
    </body>
    </html>
  `);

  win.document.close();
}


// ----------------------------------------------------------------
// Voice alert — used both for late-task warnings (5 PM) and to
// audibly announce the welcome on scan. Web Speech API; no server
// round trip.
// ----------------------------------------------------------------

function speakAlert(text, opts = {}) {

  try {

    const synth = window.speechSynthesis;

    if (!synth) return;

    synth.cancel();   // stop any in-flight utterance

    const u = new SpeechSynthesisUtterance(text);

    u.lang = opts.lang || "en-IN";

    u.rate = opts.rate || 0.95;

    u.pitch = opts.pitch || 1.0;

    u.volume = opts.volume ?? 1.0;

    synth.speak(u);

  } catch (e) {

    // SpeechSynthesis unavailable — fail silently
  }
}


function ResultCard({ result }) {

  if (!result) return null;

  const emp = result?.employee || {};

  const att = result?.attendance || {};

  const action = result?.action;

  const theme = ACTION_THEMES[action] || ACTION_THEMES.CHECKED_IN;

  return (

    <div
      className={styles.resultCard}
      style={{ borderTop: `4px solid ${theme.accent}` }}
    >

      {/* Header */}
      <div className={styles.resultCardHeader}>

        <div
          className={styles.resultAvatar}
          style={{ background: theme.bg, color: theme.fg }}
        >
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div className={styles.resultHeaderInfo}>

          <div className={styles.resultName}>
            {result.message}
          </div>

          <div className={styles.resultMeta}>

            <ActionBadge action={action} />

            <span>{emp.EMPLOYEE_CODE}</span>

            {att.CHECK_IN && (

              <span>
                · In {formatISTTime(att.CHECK_IN)}
              </span>
            )}

            {att.CHECK_OUT && (

              <span>
                · Out {formatISTTime(att.CHECK_OUT)}
              </span>
            )}

            {att.STATUS && (

              <span
                className={
                  att.STATUS === "LATE"
                    ? styles.resultStatusLate
                    : styles.resultStatusOnTime
                }
              >
                {att.STATUS}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body: branches on action */}
      {action === "CHECKED_OUT" && (
        <CheckoutSummary result={result} />
      )}

      {action === "ALREADY_OUT" && (

        <div className={styles.alreadyOutNotice}>
          Worked {att.WORKED_HOURS ?? 0}h today. See you tomorrow.
        </div>
      )}

      {(action === "TASK_COMPLETED_NEXT_ASSIGNED"
        || action === "TASK_COMPLETED_READY_TO_LEAVE") && (
        <CompletionSummary completion={result.completion} />
      )}

      {action === "TASK_COMPLETED_READY_TO_LEAVE" && (

        <div className={styles.readyToLeaveBox}>
          {result.minutes_to_shift_end > 0
            ? `~${Math.round(result.minutes_to_shift_end)} min to shift end. Scan again to check out.`
            : "Shift ended — scan again to check out."}
        </div>
      )}

      {(action === "CHECKED_IN"
        || action === "TASK_COMPLETED_NEXT_ASSIGNED"
        || action === "TASK_IN_PROGRESS") && (

        <ProjectBlock
          project={result?.allocation?.project}
          task={result?.allocation?.task}
          alloc={result?.allocation}
        />
      )}

      {/* Print + voice action row */}
      {(action === "CHECKED_IN"
        || action === "TASK_COMPLETED_NEXT_ASSIGNED") && (

        <div className={styles.actionRow}>

          <button
            onClick={() => printTaskSheet(result)}
            className={styles.btnPrint}
          >
            🖨️ Print Task Sheet
          </button>

          <button
            onClick={() => {

              const emp = result?.employee || {};

              const project = result?.allocation?.project;

              const task = result?.allocation?.task;

              const text = `Welcome ${emp.NAME}. ${
                project
                  ? `You are assigned to ${project.PROJECT_NAME}. Today's task: ${task?.TASK_NAME || ""}. Please complete it before 6 PM.`
                  : "No task allocated yet. Please contact your supervisor."
              }`;

              speakAlert(text);
            }}
            className={styles.btnVoice}
          >
            🔊 Voice Announcement
          </button>
        </div>
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

function BiometricCheckIn() {

  const [fingerprintId, setFingerprintId] = useState("");

  const [deviceId] = useState("BVC24-GATE-01");

  const [scanning, setScanning] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  const [recent, setRecent] = useState([]);

  const [board, setBoard] = useState(null);

  const [autoPrint, setAutoPrint] = useState(true);

  const [autoVoice, setAutoVoice] = useState(true);

  const [tick, setTick] = useState(0);

  const fpInputRef = useRef(null);

  const fetchRecent = async () => {

    try {

      const res = await API.get("/biometric/events?limit=8");

      setRecent(res.data || []);

    } catch (e) {

      // non-critical
    }
  };

  const fetchBoard = async () => {

    try {

      const res = await API.get("/attendance/live-board");

      setBoard(res.data);

    } catch (e) {

      // non-critical
    }
  };

  useEffect(() => {

    fetchRecent();

    fetchBoard();

    fpInputRef.current?.focus();

    // Poll the attendance board every 10 seconds for live updates
    const boardId = setInterval(fetchBoard, 10 * 1000);

    return () => clearInterval(boardId);

  }, []);

  // Local 1-sec ticker so live worked-hours counters animate
  useEffect(() => {

    const id = setInterval(() => setTick((t) => t + 1), 1000);

    return () => clearInterval(id);

  }, []);

  // ---- 5 PM deadline-reminder voice alert -----------------------
  // The kiosk page itself runs a clock. At 17:00 IST (5 PM), if any
  // task is still pending for the last-scanned employee, speak the
  // MD's exact warning message + flag an email to MD.
  useEffect(() => {

    if (!autoVoice) return;

    let lastFiredKey = null;

    const tick = () => {

      const now = new Date();

      const hr = now.getHours();

      const min = now.getMinutes();

      // Fire once per day at 17:00. Use date-string as key.
      const key = `${now.toDateString()}-17:00`;

      if (hr === 17 && min === 0 && lastFiredKey !== key) {

        lastFiredKey = key;

        speakAlert(
          "Attention. Your task completion time is approaching. " +
          "Please complete your task before the deadline at six PM. " +
          "Otherwise a notification email will be sent to the M D."
        );
      }
    };

    const id = setInterval(tick, 30 * 1000);   // check every 30 sec

    return () => clearInterval(id);

  }, [autoVoice]);

  const handleScan = async (e) => {

    e?.preventDefault?.();

    if (!fingerprintId.trim()) {

      setError("Enter a fingerprint ID to simulate the scan.");

      return;
    }

    setScanning(true);

    setError("");

    setResult(null);

    try {

      const res = await API.post("/biometric/scan", {
        DEVICE_ID: deviceId,
        FINGERPRINT_ID: fingerprintId.trim(),
        VERIFY_MODE: "FP",
        TIMESTAMP: new Date().toISOString(),
        VENDOR_ID: 1
      });

      setResult(res.data);

      setFingerprintId("");

      fetchRecent();

      fetchBoard();

      // Auto-announce + auto-print for successful check-in / task assigned.
      // This is the MD's "fingerprint scan -> printer auto-print" requirement.
      const action = res.data?.action;

      const triggers = new Set([
        "CHECKED_IN",
        "TASK_COMPLETED_NEXT_ASSIGNED"
      ]);

      if (triggers.has(action)) {

        const emp = res.data?.employee || {};

        const project = res.data?.allocation?.project;

        const task = res.data?.allocation?.task;

        if (autoVoice) {

          const text = `Welcome ${emp.NAME}. ${
            project
              ? `Today you are assigned to ${project.PROJECT_NAME}. Your task is ${task?.TASK_NAME || ""}. Please complete it before 6 PM.`
              : "No task allocated yet. Please contact your supervisor."
          }`;

          // small delay so the UI renders before speech kicks in
          setTimeout(() => speakAlert(text), 400);
        }

        if (autoPrint) {

          // 1.2-second delay so the user sees the result card first
          setTimeout(() => printTaskSheet(res.data), 1200);
        }
      }

    } catch (err) {

      setError(
        err?.response?.data?.detail
          || err?.message
          || "Scan failed"
      );
    } finally {

      setScanning(false);

      setTimeout(() => fpInputRef.current?.focus(), 100);
    }
  };

  return (

    <div className={styles.page}>

      {/* TOP — scan column (centered) */}
      {/* Keyframe animations are defined in BiometricCheckIn.module.css */}
      <div className={styles.scanColumn}>

        <div className={styles.clockBox}>
          <LiveClock />
        </div>

        <div className={styles.brandTagline}>
          BVC24 · Bharath Vending Corporation
        </div>

        <div className={styles.scanHeading}>
          Gate Biometric Scan
        </div>

        <div className={styles.scanSubtitle}>
          One finger does it all — check-in, mark task complete,
          get next task, check-out at end of shift.
        </div>

        <div className={styles.fpCircle}>
          <FingerprintIcon scanning={scanning} />
        </div>

        <form
          onSubmit={handleScan}
          className={styles.scanForm}
        >

          <input
            ref={fpInputRef}
            type="text"
            placeholder="Fingerprint ID (device USER_ID)"
            value={fingerprintId}
            onChange={(e) => setFingerprintId(e.target.value)}
            disabled={scanning}
            className={styles.fpInput}
          />

          <button
            type="submit"
            disabled={scanning}
            className={`${styles.btnScan} ${scanning ? styles.btnScanScanning : styles.btnScanReady}`}
          >
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </form>

        <div className={styles.deviceLabel}>
          Device · {deviceId}
        </div>

        {/* Auto-print / auto-voice toggles */}
        <div className={styles.toggleRow}>

          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className={styles.toggleCheckbox}
            />
            Auto-print task sheet
          </label>

          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoVoice}
              onChange={(e) => setAutoVoice(e.target.checked)}
              className={styles.toggleCheckbox}
            />
            Voice announcements + 5 PM alert
          </label>

          <button
            onClick={() =>
              speakAlert(
                "Attention. Your task completion time is approaching. " +
                "Please complete your task before the deadline at six PM. " +
                "Otherwise a notification email will be sent to the M D."
              )
            }
            className={styles.btnTestAlert}
          >
            🔊 Test 5 PM alert
          </button>
        </div>

        {error && (

          <div className={styles.errorBanner}>
            {error}
          </div>
        )}

        <ResultCard result={result} />
      </div>

      {/* BOTTOM — Today's Attendance Board */}
      <AttendanceBoardSection board={board} tick={tick} />
    </div>
  );
}


// ===================================================================
// Attendance board — per-employee cards with CHECK_IN + CHECK_OUT
// shown separately. Matches a real biometric attendance system.
// ===================================================================

function liveWorkedHoursStr(checkInIso, checkOutIso) {

  if (!checkInIso) return null;

  const hasTzIn = /[+-]\d{2}:?\d{2}$|Z$/.test(checkInIso);

  const start = new Date(hasTzIn ? checkInIso : checkInIso + "Z").getTime();

  let end;

  if (checkOutIso) {

    const hasTzOut = /[+-]\d{2}:?\d{2}$|Z$/.test(checkOutIso);

    end = new Date(hasTzOut ? checkOutIso : checkOutIso + "Z").getTime();

  } else {

    end = Date.now();
  }

  const ms = end - start;

  if (ms < 0 || isNaN(ms)) return "0:00:00";

  const totalSec = Math.floor(ms / 1000);

  const h = Math.floor(totalSec / 3600);

  const m = Math.floor((totalSec % 3600) / 60);

  const s = totalSec % 60;

  return (
    String(h).padStart(2, "0") + ":"
    + String(m).padStart(2, "0") + ":"
    + String(s).padStart(2, "0")
  );
}


function BoardSummaryTile({ label, value, sub, color }) {

  return (

    <div className={styles.boardSummaryTile}>

      <div className={styles.boardTileLabel}>
        {label}
      </div>

      <div className={styles.boardTileValue} style={{ color }}>
        {value}
      </div>

      {sub && (

        <div className={styles.boardTileSub}>
          {sub}
        </div>
      )}
    </div>
  );
}


function EmployeeAttendanceCard({ emp, tick, index }) {

  // re-render every second to update the live worked-hours counter
  void tick;

  const isIn = !!emp.CHECK_IN;

  const isOut = !!emp.CHECK_OUT;

  // State-derived colours are runtime-computed — kept inline.
  let stateLabel = "Not in";

  let stateBg = "#f1f5f9";

  let stateFg = "#475569";

  let accent = "#cbd5e1";

  if (isOut) {

    stateLabel = "Checked out";

    stateBg = "#f1f5f9";

    stateFg = "#475569";

    accent = "#94a3b8";

  } else if (isIn) {

    if (emp.STATUS === "LATE") {

      stateLabel = "In · LATE";

      stateBg = "#fef3c7";

      stateFg = "#854d0e";

      accent = "#f59e0b";

    } else {

      stateLabel = "Working";

      stateBg = "#dcfce7";

      stateFg = "#166534";

      accent = "#10b981";
    }
  }

  const liveHours = liveWorkedHoursStr(emp.CHECK_IN, emp.CHECK_OUT);

  return (

    <div
      className={styles.empCard}
      style={{
        borderTop: `4px solid ${accent}`,
        animationDelay: `${index * 50}ms`
      }}
    >

      {/* Header row */}
      <div className={styles.empCardHeader}>

        <div
          className={`${styles.empAvatar} ${isOut ? styles.empAvatarOut : styles.empAvatarActive}`}
        >
          {(emp.NAME || "?").charAt(0).toUpperCase()}

          {!isOut && isIn && (
            <span className={styles.empActiveDot} />
          )}
        </div>

        <div className={styles.empInfo}>

          <div className={styles.empName}>
            {emp.NAME}
          </div>

          <div className={styles.empCode}>
            {emp.EMPLOYEE_CODE}
            {emp.DEPARTMENT_CODE && (
              <span> · {emp.DEPARTMENT_CODE}</span>
            )}
          </div>
        </div>

        <span
          className={styles.empStateBadge}
          style={{ background: stateBg, color: stateFg }}
        >
          {stateLabel}
        </span>
      </div>

      {/* Check-in / Check-out clock pair */}
      <div className={styles.timePair}>

        <div
          className={`${styles.timeCell} ${emp.CHECK_IN ? styles.timeCellIn : styles.timeCellInEmpty}`}
        >
          <div className={`${styles.timeCellLabel} ${styles.timeCellLabelIn}`}>
            ↓ Check-In
          </div>
          <div
            className={`${styles.timeCellValue} ${emp.CHECK_IN ? styles.timeCellValuePresent : styles.timeCellValueEmpty}`}
          >
            {emp.CHECK_IN ? formatISTTime(emp.CHECK_IN) : "—:—"}
          </div>
        </div>

        <div
          className={`${styles.timeCell} ${emp.CHECK_OUT ? styles.timeCellOut : styles.timeCellOutEmpty}`}
        >
          <div className={`${styles.timeCellLabel} ${styles.timeCellLabelOut}`}>
            ↑ Check-Out
          </div>
          <div
            className={`${styles.timeCellValue} ${emp.CHECK_OUT ? styles.timeCellValueOut : styles.timeCellValueEmpty}`}
          >
            {emp.CHECK_OUT ? formatISTTime(emp.CHECK_OUT) : "—:—"}
          </div>
        </div>
      </div>

      {/* Live worked-hours counter */}
      {isIn && (

        <div
          className={`${styles.liveCounter} ${isOut ? styles.liveCounterDone : styles.liveCounterActive}`}
        >

          <div className={styles.liveCounterLabel}>
            {isOut ? "Worked Total" : "Live ⏱"}
          </div>

          <div
            className={`${styles.liveCounterValue} ${isOut ? styles.liveCounterValueDone : styles.liveCounterValueActive}`}
          >
            {liveHours}
          </div>
        </div>
      )}

      {/* Current task */}
      {emp.CURRENT_TASK_NAME ? (

        <div className={styles.currentTaskBox}>

          <div className={styles.currentTaskLabel}>
            🔧 Working On
          </div>

          <div className={styles.currentTaskName}>
            {emp.CURRENT_TASK_NAME}
          </div>

          {emp.CURRENT_PROJECT && (

            <div className={styles.currentTaskProject}>
              {emp.CURRENT_PROJECT}
            </div>
          )}
        </div>
      ) : isIn && !isOut ? (

        <div className={styles.noTaskBox}>
          No active task
        </div>
      ) : null}

      {/* Tasks done today */}
      {emp.TASKS_COMPLETED_TODAY > 0 && (

        <div className={styles.tasksDoneRow}>

          <span>Tasks done today</span>

          <span className={styles.tasksDoneBadge}>
            ✓ {emp.TASKS_COMPLETED_TODAY}
          </span>
        </div>
      )}
    </div>
  );
}


function AttendanceBoardSection({ board, tick }) {

  const employees = board?.employees || [];

  const summary = board?.summary || {};

  return (

    <div className={styles.boardSection}>

      {/* Header */}
      <div className={styles.boardHeader}>

        <div>

          <div className={styles.boardHeadingLabel}>
            Today's Attendance Board
          </div>

          <div className={styles.boardHeading}>
            Live Check-In / Check-Out
          </div>
        </div>

        <div className={styles.liveIndicator}>
          <span className={styles.liveDot} />
          Auto-refreshing every 10s
        </div>
      </div>

      {/* Summary tiles */}
      <div className={styles.boardTilesGrid}>

        <BoardSummaryTile
          label="Total Active"
          value={summary.total_active ?? 0}
          color="#fff"
        />

        <BoardSummaryTile
          label="In Office Now"
          value={summary.in_office ?? 0}
          sub="checked in"
          color="#86efac"
        />

        <BoardSummaryTile
          label="Checked Out"
          value={summary.checked_out ?? 0}
          sub="done for day"
          color="#fcd34d"
        />

        <BoardSummaryTile
          label="Not Checked In"
          value={summary.not_checked_in ?? 0}
          sub="absent / pending"
          color="#fca5a5"
        />
      </div>

      {/* Employee cards grid */}
      <div className={styles.empCardsGrid}>

        {employees.length === 0 && (

          <div className={styles.emptyBoard}>
            No active employees. Run /demo/seed-bvc24 to populate.
          </div>
        )}

        {employees.map((emp, idx) => (

          <EmployeeAttendanceCard
            key={emp.EMPLOYEE_ID}
            emp={emp}
            tick={tick}
            index={idx}
          />
        ))}
      </div>
    </div>
  );
}


export default BiometricCheckIn;
