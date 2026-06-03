import { useEffect, useState } from "react";

import API from "../services/api";

import {
  isVoiceSupported,
  isVoiceEnabled,
  setVoiceEnabled,
  speak,
  stopSpeaking,
  buildAlertSpeech
} from "../services/voiceAlerts";

function Settings() {

  const [settings, setSettings] = useState(null);

  const [loading, setLoading] = useState(true);

  const [savingToggle, setSavingToggle] = useState(false);

  const [sendingTest, setSendingTest] = useState(false);

  const [testRecipient, setTestRecipient] = useState("");

  const [testResult, setTestResult] = useState(null);

  const [voiceOn, setVoiceOn] = useState(
    isVoiceEnabled()
  );

  const [testMachineName, setTestMachineName] =
    useState("Lathe 01");

  const voiceSupported = isVoiceSupported();

  const [currentDay, setCurrentDay] = useState(1);

  const [seedResult, setSeedResult] = useState(null);

  const [seeding, setSeeding] = useState(false);

  const [savingDay, setSavingDay] = useState(false);

  const fetchCurrentDay = async () => {

    try {

      const res = await API.get("/current-day");

      setCurrentDay(res.data.day);

    } catch (e) {

      console.log(e);
    }
  };

  const seedDemoData = async () => {

    setSeeding(true);

    setSeedResult(null);

    try {

      const res = await API.post("/seed-employees");

      setSeedResult({
        ok: true,
        message:
          res.data.message +
          ` (${res.data.employees_created} employees,` +
          ` ${res.data.tasks_created} tasks)`
      });

      fetchCurrentDay();

    } catch (e) {

      console.log(e);

      setSeedResult({
        ok: false,
        message:
          e?.response?.data?.detail ||
          "Failed to seed demo data"
      });

    } finally {

      setSeeding(false);
    }
  };

  const resetSeed = async () => {

    if (
      !window.confirm(
        "This will delete the DEMO employees (EMP001-EMP010) " +
          "along with their tasks and attendance only. " +
          "Other employees (including ADMIN) and their " +
          "attendance history will be preserved. Continue?"
      )
    ) {

      return;
    }

    setSeeding(true);

    setSeedResult(null);

    try {

      await API.delete("/seed-employees");

      setSeedResult({
        ok: true,
        message:
          "All employee + task data cleared. Click " +
          "Seed Demo Data to repopulate."
      });

    } catch (e) {

      console.log(e);

      setSeedResult({
        ok: false,
        message: "Failed to reset"
      });

    } finally {

      setSeeding(false);
    }
  };

  const updateDay = async (newDay) => {

    setSavingDay(true);

    try {

      const res = await API.put("/current-day", {
        day: newDay
      });

      setCurrentDay(res.data.day);

    } catch (e) {

      console.log(e);

    } finally {

      setSavingDay(false);
    }
  };

  const fetchSettings = async () => {

    try {

      const res = await API.get("/settings");

      setSettings(res.data);

    } catch (e) {

      console.log(e);
    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchSettings();

    fetchCurrentDay();

  }, []);

  const toggleAlerts = async () => {

    if (!settings) return;

    setSavingToggle(true);

    try {

      await API.put("/settings/email-alerts", {
        enabled: !settings.email_alerts_enabled
      });

      await fetchSettings();

    } catch (e) {

      console.log(e);

      alert("Failed to update setting");

    } finally {

      setSavingToggle(false);
    }
  };

  const sendTest = async () => {

    setSendingTest(true);

    setTestResult(null);

    try {

      const res = await API.post(
        "/settings/test-email",
        {
          recipient: testRecipient || null
        }
      );

      setTestResult({
        ok: true,
        message: res.data.message || "Email sent"
      });

    } catch (error) {

      const detail =
        error?.response?.data?.detail ||
        "Failed to send test email";

      setTestResult({
        ok: false,
        message: detail
      });

    } finally {

      setSendingTest(false);
    }
  };

  const handleVoiceToggle = () => {

    const next = !voiceOn;

    setVoiceEnabled(next);

    setVoiceOn(next);

    if (next) {

      speak(
        "Voice alerts enabled. You will be notified "
          + "when a critical event occurs."
      );

    } else {

      stopSpeaking();
    }
  };

  const testVoice = () => {

    const name = testMachineName.trim() || "Lathe 01";

    speak(
      buildAlertSpeech(
        "Machine Down",
        `${name} is down. Please check immediately.`
      )
    );
  };

  if (loading) {

    return (
      <div>
        <h1>Settings</h1>
        <p style={{ color: "#94a3b8" }}>Loading…</p>
      </div>
    );
  }

  return (

    <div>

      <h1>Settings</h1>

      <p
        style={{
          color: "#64748b",
          marginBottom: "20px"
        }}
      >
        Configure how Bharath ERP delivers critical
        alerts via email.
      </p>

      <div className="settings-card">

        <div className="settings-row">

          <div>

            <h3>Email Alerts</h3>

            <p className="settings-desc">
              When ON, ERROR and WARNING notifications
              are also emailed to the admin address.
            </p>

          </div>

          <label className="toggle-switch">

            <input
              type="checkbox"
              checked={settings.email_alerts_enabled}
              onChange={toggleAlerts}
              disabled={savingToggle}
            />

            <span className="toggle-slider" />

          </label>

        </div>

        <div className="settings-divider" />

        <h3>SMTP Configuration</h3>

        <p className="settings-desc">
          Read-only — these come from the backend{" "}
          <code>.env</code> file. Edit the file and
          restart the server to change them.
        </p>

        <div className="settings-grid">

          <div className="settings-field">

            <span className="settings-label">
              SMTP Configured
            </span>

            <span
              className={
                "status-badge " +
                (settings.smtp_configured
                  ? "badge-present"
                  : "badge-absent")
              }
            >
              {
                settings.smtp_configured
                  ? "YES"
                  : "NO"
              }
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">Host</span>

            <span className="settings-value">
              {settings.smtp_host || "—"}
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">
              SMTP User
            </span>

            <span className="settings-value">
              {settings.smtp_user || "—"}
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">
              From Address
            </span>

            <span className="settings-value">
              {settings.from_addr || "—"}
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">
              From Name
            </span>

            <span className="settings-value">
              {settings.from_name}
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">
              Admin Recipient
            </span>

            <span className="settings-value">
              {settings.admin_email || "—"}
            </span>

          </div>

          <div className="settings-field">

            <span className="settings-label">
              TLS Enabled
            </span>

            <span className="settings-value">
              {settings.use_tls ? "Yes" : "No"}
            </span>

          </div>

        </div>

      </div>

      <div className="settings-card">

        <h3>Send Test Email</h3>

        <p className="settings-desc">
          Verify your SMTP setup. Leave the field empty
          to send to the admin address from .env.
        </p>

        <div className="employee-form">

          <input
            type="email"
            placeholder={
              settings.admin_email ||
              "Recipient email (optional)"
            }
            value={testRecipient}
            onChange={(e) =>
              setTestRecipient(e.target.value)
            }
          />

          <button
            onClick={sendTest}
            disabled={sendingTest}
          >
            {
              sendingTest
                ? "Sending…"
                : "Send Test Email"
            }
          </button>

        </div>

        {
          testResult && (
            <div
              className={
                testResult.ok
                  ? "test-result test-ok"
                  : "test-result test-fail"
              }
            >
              {testResult.message}
            </div>
          )
        }

      </div>

      <div className="settings-card">

        <div className="settings-row">

          <div>

            <h3>🔊 Voice Alerts</h3>

            <p className="settings-desc">
              When ON, your browser will speak any new
              ERROR or WARNING notification out loud
              the moment it arrives. Perfect for
              shop-floor monitoring without checking
              the screen.
            </p>

          </div>

          <label className="toggle-switch">

            <input
              type="checkbox"
              checked={voiceOn}
              onChange={handleVoiceToggle}
              disabled={!voiceSupported}
            />

            <span className="toggle-slider" />

          </label>

        </div>

        {
          !voiceSupported && (
            <div className="test-result test-fail">
              Your browser does not support
              SpeechSynthesis. Try Chrome, Edge, or
              Firefox.
            </div>
          )
        }

        <div className="settings-divider" />

        <h3>Test Voice Alert</h3>

        <p className="settings-desc">
          Hear how an actual machine-down alert sounds.
          Enter a machine name and click Test.
        </p>

        <div className="employee-form">

          <input
            type="text"
            placeholder="Machine name (e.g. Lathe 01)"
            value={testMachineName}
            onChange={(e) =>
              setTestMachineName(e.target.value)
            }
          />

          <button
            onClick={testVoice}
            disabled={!voiceSupported}
            className="start-btn"
          >
            🔊 Test Voice
          </button>

          <button
            onClick={stopSpeaking}
            className="hold-btn"
          >
            ⏹ Stop
          </button>

        </div>

        <p
          className="settings-desc"
          style={{
            marginTop: "12px",
            marginBottom: 0,
            fontStyle: "italic"
          }}
        >
          Note: Most browsers block voice playback
          until you interact with the page once
          (click anywhere). Voice runs locally — no
          server, no internet, no cost.
        </p>

      </div>

      <div className="settings-card">

        <h3>📋 Daily Task Management</h3>

        <p className="settings-desc">
          Seed 10 manufacturing employees and their
          30-day task plan, then set which day of the
          plan is "today" so employees see the right
          task when they log in.
        </p>

        <div className="employee-form">

          <button
            onClick={seedDemoData}
            disabled={seeding}
            className="start-btn"
          >
            {
              seeding
                ? "Seeding…"
                : "Seed Demo Data (10 employees · 300 tasks)"
            }
          </button>

          <button
            onClick={resetSeed}
            disabled={seeding}
            className="delete-btn"
          >
            Reset Demo Data
          </button>

        </div>

        {
          seedResult && (
            <div
              className={
                seedResult.ok
                  ? "test-result test-ok"
                  : "test-result test-fail"
              }
            >
              {seedResult.message}
            </div>
          )
        }

        <div className="settings-divider" />

        <h3>Current Project Day</h3>

        <p className="settings-desc">
          Employees see the task assigned for this day
          number. Drag the slider or pick a day below.
        </p>

        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "center",
            marginBottom: "10px"
          }}
        >

          <input
            type="range"
            min="1"
            max="30"
            value={currentDay}
            onChange={(e) =>
              updateDay(parseInt(e.target.value, 10))
            }
            disabled={savingDay}
            style={{ flex: 1 }}
          />

          <input
            type="number"
            min="1"
            max="30"
            value={currentDay}
            onChange={(e) =>
              updateDay(
                Math.max(
                  1,
                  Math.min(
                    30,
                    parseInt(e.target.value, 10) || 1
                  )
                )
              )
            }
            disabled={savingDay}
            style={{
              width: "70px",
              padding: "8px",
              borderRadius: "8px",
              border: "1px solid #ccc"
            }}
          />

          <span
            style={{
              color: "#64748b",
              fontSize: "13px"
            }}
          >
            of 30
          </span>

        </div>

      </div>

      <div className="settings-card settings-info">

        <h3>How alerts are triggered</h3>

        <ul className="settings-list">

          <li>
            <b>Machine DOWN</b> → ERROR email sent
            immediately when status changes
          </li>

          <li>
            <b>Low Stock</b> (≤ 10 units) → WARNING
            email every 30s scan if a new low-stock
            event is found
          </li>

          <li>
            <b>Machine Maintenance</b> → WARNING email
            when a machine enters maintenance mode
          </li>

          <li>
            INFO notifications stay in-app only — they
            don't email
          </li>

          <li>
            <b>Voice alerts</b> speak any new ERROR or
            WARNING the moment it appears — useful for
            shop-floor staff without screens
          </li>

        </ul>

      </div>

    </div>
  );
}

export default Settings;
