"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import LimeButton from "@/components/LimeButton";
import { supabase } from "@/utils/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initializeRecoverySession = async () => {
      if (typeof window === "undefined") return;

      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!isMounted) return;
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!isMounted) return;
          if (error) throw error;
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (error) {
          throw error;
        }

        if (!session) {
          setError("This password reset link could not be completed. Please request a new password reset email.");
        }
      } catch (err) {
        if (!isMounted) return;
        console.error("Password reset init failed", err);
        setError("This password reset link could not be completed. Please request a new password reset email.");
      }
    };

    initializeRecoverySession();

    return () => {
      isMounted = false;
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session) {
        throw new Error("Your reset session is no longer available. Please request a new password reset email.");
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setMessage("Password updated successfully. You can now sign in.");
      redirectTimerRef.current = window.setTimeout(() => {
        router.push("/");
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="font-heading text-2xl font-extrabold uppercase tracking-wide">Set New Password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground">
              New Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="font-heading"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-primary">{message}</p>}

          <LimeButton type="submit" full disabled={loading}>
            {loading ? "..." : "UPDATE PASSWORD"}
          </LimeButton>
        </form>
      </div>
    </main>
  );
}
