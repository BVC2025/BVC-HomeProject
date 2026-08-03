// =====================================================================
// BiometricImport — admin page at /biometric-import
//
// Fallback path when the ESSL/ZKTeco device can't reach the ERP over
// the network. Admin exports attendance from the device onto a USB
// pen drive, then uploads that file here. Backend parses the ATTLOG
// format, dedups, maps PIN → Employee, writes Attendance rows.
//
// How to export on the device (ESSL X2008):
//   1. Insert USB pen drive
//   2. Menu → USB Manager → Download → Attendance Data
//   3. Wait for "Download successful"
//   4. Remove USB, plug into PC
//   5. Upload the file (usually 1_attlog.dat or attlog.txt) here
// =====================================================================

import { useState } from "react";

import API from "../services/api";


const DEFAULT_SN = "JNP2255102739";   // ESSL X2008 currently on-site


export default function BiometricImport() {

  const [file, setFile] = useState(null);

  const [deviceSn, setDeviceSn] = useState(DEFAULT_SN);

  const [busy, setBusy] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");


  const upload = async (e) => {

    e.preventDefault();

    if (!file) {

      setError("Choose a file first.");

      return;
    }

    setBusy(true);

    setError("");

    setResult(null);

    try {

      const fd = new FormData();

      fd.append("file", file);

      fd.append("device_sn", (deviceSn || "MANUAL_USB").trim());

      const res = await API.post("/iclock/import-attlog", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      setResult(res.data);

    } catch (err) {

      const detail = err?.response?.data?.detail || err?.message || "Upload failed";

      setError(String(detail));

    } finally {

      setBusy(false);
    }
  };


  return (

    <div style={styles.page}>

      <div style={styles.card}>

        <div style={styles.eyebrow}>ATTENDANCE · ADMIN</div>

        <h1 style={styles.title}>Biometric Data Import (USB)</h1>

        <p style={styles.lede}>
          Upload the attendance log exported from the ESSL device via
          USB pen drive. Punches will be matched to employees via the
          PIN column and written into today's Attendance table.
        </p>

        <form onSubmit={upload} style={styles.form}>

          <label style={styles.label}>Device Serial Number</label>

          <input
            type="text"
            value={deviceSn}
            onChange={(e) => setDeviceSn(e.target.value)}
            placeholder="JNP2255102739"
            style={styles.input}
          />

          <div style={styles.hint}>
            Auto-filled with the ESSL X2008 on-site. Change if you're
            uploading data from a different device.
          </div>

          <label style={{ ...styles.label, marginTop: 18 }}>
            Attendance File
          </label>

          <input
            type="file"
            accept=".dat,.txt,.csv,.log,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={styles.file}
          />

          <div style={styles.hint}>
            Common filenames: <code>1_attlog.dat</code>,
            {" "}<code>attlog.txt</code>, or any text export from the
            device's USB Manager → Download menu.
          </div>

          <button type="submit" disabled={busy || !file} style={styles.btn}>
            {busy ? "Uploading…" : "Upload & Import"}
          </button>

        </form>

        {error && (
          <div style={styles.error}>
            <b>Error:</b> {error}
          </div>
        )}

        {result && (
          <div style={styles.success}>
            <div style={styles.successTitle}>
              ✓ Imported {result.rows_inserted} new punches
            </div>
            <table style={styles.table}>
              <tbody>
                <tr>
                  <td>File</td>
                  <td>{result.filename}</td>
                </tr>
                <tr>
                  <td>Device SN</td>
                  <td>{result.device_sn}</td>
                </tr>
                <tr>
                  <td>Records seen in file</td>
                  <td>{result.records_seen}</td>
                </tr>
                <tr>
                  <td>New rows inserted</td>
                  <td>{result.rows_inserted}</td>
                </tr>
                <tr>
                  <td>Skipped (already imported)</td>
                  <td>{result.rows_skipped_as_duplicate}</td>
                </tr>
              </tbody>
            </table>
            <div style={styles.next}>
              Head to <a href="/attendance" style={styles.link}>Attendance → Today</a>
              {" "}to verify the check-in / check-out times landed on each employee.
            </div>
          </div>
        )}

        <div style={styles.help}>
          <div style={styles.helpTitle}>Export from device — step-by-step</div>
          <ol style={styles.helpList}>
            <li>Insert a USB pen drive into the ESSL X2008.</li>
            <li>On the device: <b>Menu → USB Manager → Download → Attendance Data</b>.</li>
            <li>Wait for the "Download successful" beep.</li>
            <li>Remove the USB drive, plug it into this PC.</li>
            <li>Choose the file above (usually <code>1_attlog.dat</code>).</li>
            <li>Click <b>Upload &amp; Import</b>.</li>
          </ol>
        </div>

      </div>
    </div>
  );
}


const styles = {
  page: {
    minHeight: "100vh",
    padding: 24,
    background: "var(--layout-bg, #f4f6fa)",
    boxSizing: "border-box",
  },
  card: {
    maxWidth: 720,
    margin: "0 auto",
    background: "var(--card-bg, #fff)",
    borderRadius: 14,
    padding: 28,
    boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: "#dc2626",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: "6px 0 8px 0",
    color: "var(--text-primary, #0f172a)",
    letterSpacing: -0.3,
  },
  lede: {
    fontSize: 14,
    color: "var(--text-secondary, #475569)",
    lineHeight: 1.55,
    margin: "0 0 22px 0",
  },
  form: {
    display: "flex",
    flexDirection: "column",
  },
  label: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-secondary, #475569)",
    marginBottom: 6,
  },
  input: {
    padding: "10px 12px",
    border: "1px solid var(--border-strong, #cbd5e1)",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
  },
  file: {
    padding: 6,
    border: "1px dashed #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "#f8fafc",
  },
  hint: {
    fontSize: 12,
    color: "var(--text-muted, #64748b)",
    marginTop: 4,
    lineHeight: 1.5,
  },
  btn: {
    marginTop: 22,
    padding: "12px 20px",
    border: "none",
    borderRadius: 10,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: 0.4,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: {
    marginTop: 18,
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 8,
    fontSize: 13,
  },
  success: {
    marginTop: 18,
    padding: 16,
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 10,
  },
  successTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#065f46",
    marginBottom: 10,
  },
  table: {
    width: "100%",
    fontSize: 13,
    borderCollapse: "collapse",
  },
  next: {
    marginTop: 12,
    fontSize: 13,
    color: "#065f46",
  },
  link: {
    color: "#dc2626",
    fontWeight: 700,
    textDecoration: "underline",
  },
  help: {
    marginTop: 28,
    padding: 16,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid var(--border, #e2e8f0)",
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: "var(--text-primary, #0f172a)",
    marginBottom: 8,
  },
  helpList: {
    margin: 0,
    paddingLeft: 20,
    fontSize: 13,
    lineHeight: 1.7,
    color: "var(--text-secondary, #475569)",
  },
};
