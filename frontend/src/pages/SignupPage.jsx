import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout, { AuthFooterLink } from "../components/AuthLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signup({ email, password });
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Unable to create an account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Sign up to start shortening URLs."
      footer={
        <AuthFooterLink
          prompt="Already have an account?"
          to="/login"
          label="Log in"
        />
      }
    >
      <form className="form" onSubmit={handleSubmit}>
        {error ? <p className="alert">{error}</p> : null}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Sign up"}
        </button>
      </form>
    </AuthLayout>
  );
}
