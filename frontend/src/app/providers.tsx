"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, createContext, useContext, useEffect, useCallback } from "react";
import { getValidToken, clearTokens } from "@/lib/spotify-auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface CurrentUser {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
}

interface AuthContextType {
  token: string | null;
  user: CurrentUser | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => void;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAdmin: false,
  isAuthenticated: false,
  isLoading: true,
  logout: () => {},
  refreshAuth: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 60 * 1000, retry: 1 },
        },
      })
  );

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(async (accessToken: string): Promise<CurrentUser | null> => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const t = await getValidToken();
      setToken(t);
      if (t) {
        const currentUser = await fetchUser(t);
        setUser(currentUser);
      } else {
        setUser(null);
      }
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchUser]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const logout = () => {
    clearTokens();
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          token,
          user,
          isAdmin: !!user?.is_admin,
          isAuthenticated: !!token,
          isLoading,
          logout,
          refreshAuth,
        }}
      >
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
