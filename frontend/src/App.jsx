import { Routes, Route, Navigate } from "react-router-dom";

import "./App.css";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import BiometricCheckIn from "./pages/BiometricCheckIn";
import ApplyLeave from "./pages/ApplyLeave";
import QuotationPrint from "./pages/QuotationPrint";
import PublicQuotation from "./pages/PublicQuotation";
import PublicEnquiry from "./pages/PublicEnquiry";
import PurchaseOrderPrint from "./pages/PurchaseOrderPrint";
import GRNPrint from "./pages/GRNPrint";
import SalesOrderPrint from "./pages/SalesOrderPrint";
import OnboardingPortal from "./pages/OnboardingPortal";
import OnboardingChat from "./pages/OnboardingChat";
import EmployeeOnboardingChat from "./pages/EmployeeOnboardingChat";
import SupplierRegistrationPortal from "./pages/SupplierRegistrationPortal";

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

      <Route
        path="/quotation-print/:id"
        element={
          <ProtectedRoute>
            <QuotationPrint />
          </ProtectedRoute>
        }
      />

      {/* Public share link — no auth required so customers can open it */}
      <Route
        path="/q/:token"
        element={<PublicQuotation />}
      />

      {/* Public customer enquiry chatbot — no auth */}
      <Route
        path="/enquiry"
        element={<PublicEnquiry />}
      />

      {/* Customer self-onboarding portal — public, token-gated */}
      <Route
        path="/portal/onboarding/:token"
        element={<OnboardingPortal />}
      />
      <Route
        path="/portal/onboarding/:token/chat"
        element={<OnboardingChat />}
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

      <Route
        path="/po-print/:id"
        element={
          <ProtectedRoute>
            <PurchaseOrderPrint />
          </ProtectedRoute>
        }
      />

      <Route
        path="/grn-print/:id"
        element={
          <ProtectedRoute>
            <GRNPrint />
          </ProtectedRoute>
        }
      />

      <Route
        path="/so-print/:id"
        element={
          <ProtectedRoute>
            <SalesOrderPrint />
          </ProtectedRoute>
        }
      />

      <Route
        path="/login"
        element={<LoginGate />}
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
