"use client";
import React, { createContext, useContext, useState, useCallback } from "react";
interface User { id: string; email: string; firstName: string; lastName: string; }
interface AuthCtx { user: User | null; isLoaded: boolean; isSignedIn: boolean; signIn: (e: string, p: string) => Promise<void>; signUp: (e: string, p: string, f: string) => Promise<void>; signOut: () => Promise<void>; }
const mockUser: User = { id: "user_1", email: "john@example.com", firstName: "John", lastName: "Rood" };
const AuthContext = createContext<AuthCtx>({ user: null, isLoaded: false, isSignedIn: false, signIn: async () => {}, signUp: async () => {}, signOut: async () => {} });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(mockUser);
  const signIn = useCallback(async () => { setUser(mockUser); }, []);
  const signUp = useCallback(async (e: string) => { setUser({ ...mockUser, email: e }); }, []);
  const signOut = useCallback(async () => { setUser(null); }, []);
  return <AuthContext.Provider value={{ user, isLoaded: true, isSignedIn: !!user, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
export function useUser() { const { user } = useContext(AuthContext); return { user, isLoaded: true }; }
