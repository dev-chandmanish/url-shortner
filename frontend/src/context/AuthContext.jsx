import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as api from "../api/api.js";

const AuthContext = createContext(null);

function toUser(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    id: data.id,
    email: data.email,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUser(null);
    });

    return () => {
      api.setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const currentUser = await api.getCurrentUser();
        if (!cancelled) {
          setUser(toUser(currentUser));
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const currentUser = toUser(await api.login({ email, password }));
    setUser(currentUser);
    return currentUser;
  }, []);

  const signup = useCallback(async ({ email, password }) => {
    const currentUser = toUser(await api.signup({ email, password }));
    setUser(currentUser);
    return currentUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      signup,
      logout,
    }),
    [user, loading, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
