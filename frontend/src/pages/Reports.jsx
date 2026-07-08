import { useState } from "react";

import API from "../services/api";
import styles from "./Reports.module.css";

const MODULES = [
  {
    key: "employees",
    label: "Employees",
    description: "All employees with role and status",
    icon: "👥",
    category: "HR",
    accent: "#2563eb"
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer contacts and addresses",
    icon: "🤝",
    category: "Sales",
    accent: "#7c3aed"
  },
  {
    key: "projects",
    label: "Projects",
    description: "Project list with customer mapping",
    icon: "📁",
    category: "Operations",
    accent: "#0891b2"
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "Tasks with status and priority",
    icon: "✅",
    category: "Operations",
    accent: "#16a34a"
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Materials, stock and total value",
    icon: "📦",
    category: "Warehouse",
    accent: "#d97706"
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Daily attendance and worked hours",
    icon: "🕒",
    category: "HR",
    accent: "#db2777"
  },
  {
    key: "machines",
    label: "Machines",
    description: "Machine status and last update",
    icon: "🛠",
    category: "Production",
    accent: "#dc2626"
  }
];

function Reports() {

  const [downloading, setDownloading] = useState("");

  const [lastDownloads, setLastDownloads] = useState(() => {

    try {

      const stored = localStorage.getItem("reports_last");

      return stored ? JSON.parse(stored) : {};

    } catch {

      return {};
    }
  });

  const recordDownload = (key, format) => {

    const next = {
      ...lastDownloads,
      [`${key}-${format}`]: new Date().toISOString()
    };

    setLastDownloads(next);

    try {

      localStorage.setItem(
        "reports_last",
        JSON.stringify(next)
      );

    } catch {
      /* ignore */
    }
  };

  const formatLastTime = (key) => {

    const pdf = lastDownloads[`${key}-pdf`];

    const xlsx = lastDownloads[`${key}-xlsx`];

    const latest = [pdf, xlsx]
      .filter(Boolean)
      .sort()
      .pop();

    if (!latest) return null;

    const diff = Date.now() - new Date(latest).getTime();

    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return "just now";

    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);

    return `${days}d ago`;
  };

  const totalDownloads = Object.keys(lastDownloads).length;

  const download = async (key, format) => {

    const id = `${key}-${format}`;

    setDownloading(id);

    try {

      const response = await API.get(
        `/report/${key}.${format}`,
        { responseType: "blob" }
      );

      const blob = new Blob([response.data], {
        type: response.headers["content-type"]
      });

      const url = window.URL.createObjectURL(blob);

      const link = document.createElement("a");

      link.href = url;

      const today = new Date()
        .toISOString()
        .slice(0, 10);

      link.download = `${key}_report_${today}.${format}`;

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.URL.revokeObjectURL(url);

      recordDownload(key, format);

    } catch (error) {

      console.log(error);

      alert(
        `Failed to download ${key}.${format} report`
      );

    } finally {

      setDownloading("");
    }
  };

  return (

    <div className={`reports-page ${styles.page}`}>

      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.eyebrow}>Analytics</div>
          <h1 className={styles.heroTitle}>Reports</h1>
        </div>

        <div className={styles.heroStats}>
          <HeroStat label="Modules"        value={MODULES.length} />
          <HeroStat label="Recent Exports" value={totalDownloads} />
          <HeroStat label="Formats"        value={2} />
        </div>
      </div>

      <div className="reports-grid">

        {
          MODULES.map((mod) => (

            <div
              key={mod.key}
              className="report-card"
              style={{ "--accent": mod.accent }}
            >

              <div className="report-card-top">

                <span className="report-category">
                  {mod.category}
                </span>

              </div>

              <h3>{mod.label}</h3>

              <p>{mod.description}</p>

              {
                formatLastTime(mod.key) && (
                  <div className="report-last">
                    Last exported {formatLastTime(mod.key)}
                  </div>
                )
              }

              <div className="report-actions">

                <button
                  className="report-btn report-pdf"
                  disabled={
                    downloading === `${mod.key}-pdf`
                  }
                  onClick={() =>
                    download(mod.key, "pdf")
                  }
                >
                  {
                    downloading === `${mod.key}-pdf`
                      ? "Generating…"
                      : "PDF"
                  }
                </button>

                <button
                  className="report-btn report-excel"
                  disabled={
                    downloading === `${mod.key}-xlsx`
                  }
                  onClick={() =>
                    download(mod.key, "xlsx")
                  }
                >
                  {
                    downloading === `${mod.key}-xlsx`
                      ? "Generating…"
                      : "Excel"
                  }
                </button>

              </div>

            </div>
          ))
        }

      </div>

      <p className="reports-footer">
        Every PDF & Excel file is branded with the
        Bharath Vending Corporation header and current
        timestamp.
      </p>

    </div>
  );
}


function HeroStat({ label, value }) {

  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}


export default Reports;
