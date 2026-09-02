const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = typeof handler === "function" ? handler : null;
}

function toUserMessage(status, data) {
  const raw =
    data && typeof data === "object" && typeof data.error === "string"
      ? data.error
      : null;

  if (status >= 500 || raw === "Internal server error") {
    return "Something went wrong. Please try again.";
  }

  if (status === 401) {
    if (raw && raw !== "Unauthorized" && raw !== "Internal server error") {
      return raw;
    }

    return "Your session has expired. Please log in again.";
  }

  if (status === 404) {
    return "URL not found";
  }

  if (raw) {
    return raw;
  }

  if (status === 400) {
    return "Please check the URL and try again.";
  }

  return "Something went wrong. Please try again.";
}

async function request(path, options = {}) {
  const { body, method = "GET", headers, ...rest } = options;

  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...rest,
    });
  } catch {
    const error = new Error("Unable to reach the server. Please try again.");
    error.status = 0;
    throw error;
  }

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const isCredentialRequest =
      path === "/api/auth/login" || path === "/api/auth/signup";

    if (response.status === 401 && !isCredentialRequest) {
      onUnauthorized?.();
    }

    const error = new Error(toUserMessage(response.status, data));
    error.status = response.status;
    throw error;
  }

  return data;
}

export function signup({ email, password }) {
  return request("/api/auth/signup", {
    method: "POST",
    body: { email, password },
  });
}

export function login({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

export function getCurrentUser() {
  return request("/api/auth/me");
}

export function createUrl({ originalUrl }) {
  return request("/api/urls", {
    method: "POST",
    body: { originalUrl },
  });
}

export async function getUrls() {
  const data = await request("/api/urls");
  return Array.isArray(data) ? data : [];
}

export function getUrlStats(id) {
  return request(`/api/urls/${id}/stats`);
}

export function deleteUrl(id) {
  return request(`/api/urls/${id}`, { method: "DELETE" });
}
