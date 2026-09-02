import { Link } from "react-router-dom";

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="page">
      <main className="card">
        <p className="brand">URL Shortener</p>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {children}
        {footer ? <p className="footer-text">{footer}</p> : null}
      </main>
    </div>
  );
}

export function AuthFooterLink({ prompt, to, label }) {
  return (
    <>
      {prompt} <Link to={to}>{label}</Link>
    </>
  );
}
