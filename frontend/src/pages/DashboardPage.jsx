import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUrl, deleteUrl, getUrlStats, getUrls } from "../api/api.js";
import Modal from "../components/Modal.jsx";
import { useAuth } from "../context/AuthContext.jsx";

function formatCreatedAt(value) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}

function validateOriginalUrl(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Enter a URL to shorten.";
  }

  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid URL, including http:// or https://.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must use HTTP or HTTPS.";
  }

  return null;
}

function toListItem(url) {
  return {
    id: url.id,
    shortCode: url.shortCode,
    originalUrl: url.originalUrl,
    shortUrl: url.shortUrl,
    clickCount: typeof url.clickCount === "number" ? url.clickCount : 0,
    createdAt: url.createdAt || null,
  };
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers (and embedded webviews) deny clipboard permission.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(input);

  if (!copied) {
    throw new Error("Unable to copy");
  }
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [urls, setUrls] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [statsUrl, setStatsUrl] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  const redirectIfUnauthorized = useCallback(
    (error) => {
      if (error?.status === 401) {
        navigate("/login", { replace: true });
        return true;
      }

      return false;
    },
    [navigate]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUrls() {
      setListLoading(true);
      setListError("");

      try {
        const items = await getUrls();
        if (!cancelled) {
          setUrls(items.map(toListItem));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (redirectIfUnauthorized(error)) {
          return;
        }

        setListError(error.message || "Unable to load your URLs.");
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    }

    loadUrls();

    return () => {
      cancelled = true;
    };
  }, [redirectIfUnauthorized]);

  async function handleLogout() {
    setLogoutError("");
    setLoggingOut(true);

    try {
      await logout();
      navigate("/login");
    } catch (error) {
      if (redirectIfUnauthorized(error)) {
        return;
      }

      setLogoutError(error.message || "Unable to log out.");
      setLoggingOut(false);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError("");
    setCopyError("");
    setCopied(false);

    const validationError = validateOriginalUrl(originalUrl);

    if (validationError) {
      setCreateError(validationError);
      return;
    }

    setCreating(true);

    try {
      const created = await createUrl({ originalUrl: originalUrl.trim() });
      const item = toListItem(created);
      setCreatedUrl(item);
      setOriginalUrl("");
      setUrls((current) => [
        item,
        ...current.filter((url) => url.id !== item.id),
      ]);

      try {
        const items = await getUrls();
        setUrls(items.map(toListItem));
      } catch (error) {
        if (redirectIfUnauthorized(error)) {
          return;
        }
      }
    } catch (error) {
      if (redirectIfUnauthorized(error)) {
        return;
      }

      setCreateError(error.message || "Unable to shorten that URL.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!createdUrl?.shortUrl) {
      return;
    }

    setCopyError("");

    try {
      await copyToClipboard(createdUrl.shortUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Unable to copy the short URL. Copy it manually instead.");
    }
  }

  function closeStats() {
    setStatsUrl(null);
    setStats(null);
    setStatsLoading(false);
    setStatsError("");
  }

  function closeDelete() {
    if (deletingId) {
      return;
    }

    setDeleteTarget(null);
    setDeleteError("");
  }

  async function handleStats(url) {
    setStatsUrl(url);
    setStats(null);
    setStatsError("");
    setStatsLoading(true);

    try {
      const result = await getUrlStats(url.id);
      setStats(result);
      setUrls((current) =>
        current.map((item) =>
          item.id === url.id
            ? {
                ...item,
                clickCount:
                  typeof result.clickCount === "number"
                    ? result.clickCount
                    : item.clickCount,
                createdAt: result.createdAt || item.createdAt,
              }
            : item
        )
      );
    } catch (error) {
      if (redirectIfUnauthorized(error)) {
        return;
      }

      setStatsError(
        error.status === 404
          ? "URL not found"
          : "Something went wrong. Please try again."
      );
    } finally {
      setStatsLoading(false);
    }
  }

  function requestDelete(url) {
    setDeleteTarget(url);
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    const id = deleteTarget.id;
    setDeleteError("");
    setDeletingId(id);

    try {
      await deleteUrl(id);
      setUrls((current) => current.filter((url) => url.id !== id));
      setDeleteTarget(null);

      if (createdUrl?.id === id) {
        setCreatedUrl(null);
        setCopied(false);
        setCopyError("");
      }

      if (statsUrl?.id === id) {
        closeStats();
      }
    } catch (error) {
      if (redirectIfUnauthorized(error)) {
        return;
      }

      setDeleteError(
        error.status === 404
          ? "URL not found"
          : "Something went wrong. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-top">
        <div>
          <p className="brand">URL Shortener</p>
          <p className="dashboard-email">{user?.email}</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
      </header>

      {logoutError ? <p className="alert">{logoutError}</p> : null}

      <section className="panel">
        <h1>Shorten a URL</h1>
        <form className="create-form" onSubmit={handleCreate}>
          <label htmlFor="originalUrl">Original URL</label>
          <div className="create-row">
            <input
              id="originalUrl"
              name="originalUrl"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://example.com/long/url"
              value={originalUrl}
              onChange={(event) => {
                setOriginalUrl(event.target.value);
                setCreateError("");
              }}
              disabled={creating}
            />
            <button type="submit" disabled={creating}>
              {creating ? "Shortening…" : "Shorten"}
            </button>
          </div>
        </form>
        {createError ? <p className="alert">{createError}</p> : null}
        {copyError ? <p className="alert">{copyError}</p> : null}
        {createdUrl ? (
          <div className="created-banner">
            <div>
              <p className="created-label">Short URL</p>
              <a href={createdUrl.shortUrl} target="_blank" rel="noreferrer">
                {createdUrl.shortUrl}
              </a>
            </div>
            <button type="button" className="secondary" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Your URLs</h2>
        {listLoading ? <p className="muted">Loading your URLs…</p> : null}
        {!listLoading && listError ? <p className="alert">{listError}</p> : null}
        {!listLoading && !listError && urls.length === 0 ? (
          <p className="empty-state">
            You have not shortened any URLs yet. Paste a long URL above to get
            started.
          </p>
        ) : null}
        {!listLoading && urls.length > 0 ? (
          <ul className="url-list">
            {urls.map((url) => (
              <li key={url.id} className="url-item">
                <div className="url-item-main">
                  <p className="url-original" title={url.originalUrl}>
                    {url.originalUrl}
                  </p>
                  <a
                    className="url-short"
                    href={url.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {url.shortUrl}
                  </a>
                  <p className="url-meta">
                    {url.clickCount} {url.clickCount === 1 ? "click" : "clicks"}
                    {" · "}
                    {formatCreatedAt(url.createdAt)}
                  </p>
                </div>
                <div className="url-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleStats(url)}
                    disabled={statsLoading && statsUrl?.id === url.id}
                  >
                    {statsLoading && statsUrl?.id === url.id
                      ? "Loading…"
                      : "Stats"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => requestDelete(url)}
                    disabled={deletingId === url.id}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {statsUrl ? (
        <Modal title="URL statistics" onClose={closeStats}>
          {statsLoading ? <p className="muted">Loading statistics…</p> : null}
          {!statsLoading && statsError ? (
            <p className="alert">{statsError}</p>
          ) : null}
          {!statsLoading && !statsError && stats ? (
            <dl className="stats-details">
              <div>
                <dt>Clicks</dt>
                <dd>{stats.clickCount}</dd>
              </div>
              <div>
                <dt>Original URL</dt>
                <dd>
                  <a
                    href={stats.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {stats.originalUrl}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Short URL</dt>
                <dd>
                  <a href={stats.shortUrl} target="_blank" rel="noreferrer">
                    {stats.shortUrl}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatCreatedAt(stats.createdAt)}</dd>
              </div>
            </dl>
          ) : null}
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal title="Delete this URL?" onClose={closeDelete}>
          <p className="muted">
            This will permanently remove{" "}
            <strong>{deleteTarget.shortUrl}</strong>. This cannot be undone.
          </p>
          {deleteError ? <p className="alert">{deleteError}</p> : null}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              onClick={closeDelete}
              disabled={Boolean(deletingId)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={confirmDelete}
              disabled={Boolean(deletingId)}
            >
              {deletingId ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
