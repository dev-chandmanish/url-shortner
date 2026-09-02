import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export function LoadingScreen({ label = "Loading…" }) {
  return (
    <div className="page">
      <p className="muted">{label}</p>
    </div>
  );
}

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export function GuestRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
