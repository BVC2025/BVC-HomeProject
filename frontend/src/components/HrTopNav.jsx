import { NavLink } from "react-router-dom";

const HR_TABS = [
  { to: "/employees",         label: "Employee" },
  { to: "/attendance",        label: "Attendance" },
  { to: "/memos",             label: "Memos" },
  { to: "/leave-management",  label: "Leave Management" },
  { to: "/allowances",        label: "Allowance" },
  { to: "/star-performance",  label: "Star Performance" },
  { to: "/payroll",           label: "Payroll" },
  { to: "/payslip-generator", label: "Generate Payslip" },
];

export default function HrTopNav() {
  return (
    <div
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        padding: "0 24px",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {HR_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            style={({ isActive }) => ({
              padding: "12px 16px",
              fontSize: 14,
              color: isActive ? "#C8102E" : "#475569",
              borderBottom: isActive
                ? "2px solid #C8102E"
                : "2px solid transparent",
              textDecoration: "none",
              transition: "color 120ms, border-color 120ms",
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
