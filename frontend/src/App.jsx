import { Routes, Route, Navigate } from "react-router-dom";

import "./App.css";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import BiometricCheckIn from "./pages/BiometricCheckIn";
import ApplyLeave from "./pages/ApplyLeave";
import PublicEnquiry from "./pages/PublicEnquiry";
import EmployeeOnboardingChat from "./pages/EmployeeOnboardingChat";
import SupplierRegistrationPortal from "./pages/SupplierRegistrationPortal";
import PublicPOUpload from "./pages/PublicPOUpload";

function isAuthenticated() {

  return localStorage.getItem("auth") === "true";
}

function getRole() {

  return localStorage.getItem("role") || "admin";
}

function ProtectedRoute({ children }) {

  if (!isAuthenticated()) {

    return <Navigate to="/login" replace />;
  }

  return children;
}

// Re-reads the role on every render so a fresh login picks up the
// new value without a page refresh. Putting this inside App's scope
// captured a stale closure: navigate("/") reused the Route element
// from App's last render, which had role = "admin" from before login.
function RoleBasedLanding() {

  const role = getRole();

  return role === "employee" ? <EmployeeDashboard /> : <Dashboard />;
}

// Same story for /login: needs to re-evaluate auth state at render
// time so it doesn't bounce a freshly logged-in user back to /login.
//
// Exception: when a candidate is in the middle of an onboarding flow
// (sessionStorage.pending_onboarding_token is set), the /login page
// must render even for an authenticated admin — otherwise opening an
// invite link in an admin's browser would silently dump them on the
// dashboard instead of letting them sign in as the candidate.
function LoginGate() {

  const hasPendingOnboarding =
    typeof window !== "undefined" &&
    !!window.sessionStorage?.getItem("pending_onboarding_token");

  if (isAuthenticated() && !hasPendingOnboarding) {

    return <Navigate to="/" replace />;
  }

  return <Login />;
}

function App() {

  return (
    <Routes>

      <Route
        path="/biometric"
        element={<BiometricCheckIn />}
      />

      <Route
        path="/apply-leave"
        element={<ApplyLeave />}
      />

      {/* Public customer enquiry chatbot — no auth */}
      <Route
        path="/enquiry"
        element={<PublicEnquiry />}
      />


      {/* Employee self-onboarding chat — public, token-gated.
          NOTE: the admin-side review page at /employee-onboarding
          (no :token) is mounted inside the authenticated Dashboard
          shell — see pages/Dashboard.jsx. Because that route has
          no :token segment, it never matches this public route
          and instead falls through to the /* ProtectedRoute
          below. */}
      <Route
        path="/employee-onboarding/:token"
        element={<EmployeeOnboardingChat />}
      />

      {/* Supplier self-registration portal — public, token-gated */}
      <Route
        path="/supplier-register/:token"
        element={<SupplierRegistrationPortal />}
      />

      {/* Public Purchase Order upload — reached from the "Upload Purchase
          Order" button in the PO Request email, token-gated */}
      <Route
        path="/po-upload/:token"
        element={<PublicPOUpload />}
      />

      <Route
        path="/login"
        element={<LoginGate />}
      />

      {/* Legacy tile-board welcome — retired. Redirect any old bookmark
          to the new sidebar-driven ESS dashboard. */}
      <Route
        path="/welcome"
        element={<Navigate to="/" replace />}
      />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <RoleBasedLanding />
          </ProtectedRoute>
        }
      />

    </Routes>
  );
}

export default App;
