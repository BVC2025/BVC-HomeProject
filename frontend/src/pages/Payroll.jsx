// =====================================================================
// Payroll — admin landing page.
// ---------------------------------------------------------------------
// Single-purpose entry to the payroll flow. The old batch-table view
// has been retired; this page now hosts one card that describes the
// automated payroll and a single primary CTA that routes to the
// payslip-generator form (which handles the actual per-employee run).
//
// All previous batch endpoints (POST /payroll/generate,
// GET /payroll/runs, etc.) remain wired in the backend and are still
// reachable from PayslipGenerator + the row-level actions on any
// module that lists slips.
// =====================================================================

import { useNavigate } from "react-router-dom";
import styles from "./Payroll.module.css";


// Little chevron icon for the CTA.
function IconArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );

}


// SVG payslip icon used in the empty-state illustration.
function IconPayslip() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );

}


// -----------------------------------------------------------------
// MAIN PAGE
// -----------------------------------------------------------------
export default function Payroll() {
  const navigate = useNavigate();

  return (
    <div className={styles.landingPage}>
      <div className={styles.landingInner}>

        <div className={styles.landingCard}>
          <div className={styles.landingIcon}>
            <IconPayslip />
          </div>

          <h1 className={styles.landingTitle}>Generate Payroll</h1>

          <p className={styles.landingDesc}>
            Automatically generate accurate employee payroll by
            retrieving employee information and calculating salary
            based on attendance, working days, and deductions.
          </p>

          <button
            type="button"
            className={styles.landingCta}
            onClick={() => navigate("/payslip-generator")}
          >
            Generate Payroll
            <IconArrow />
          </button>

          <div className={styles.landingBullets}>
            <div className={styles.landingBullet}>
              <span className={styles.landingBulletDot} />
              Employee details auto-loaded from the Employee Master.
            </div>
            <div className={styles.landingBullet}>
              <span className={styles.landingBulletDot} />
              Working days computed from the selected month's calendar.
            </div>
            <div className={styles.landingBullet}>
              <span className={styles.landingBulletDot} />
              Casual Leave and absence deduction calculated on the fly.
            </div>
            <div className={styles.landingBullet}>
              <span className={styles.landingBulletDot} />
              Net salary finalised automatically before you save.
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
