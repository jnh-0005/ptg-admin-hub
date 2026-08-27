import { useEffect, useState } from "react";

import { SUPABASE_CONFIGURED, supabase } from "../lib/supabaseAuth";
import { Field, Input, Skeleton } from "./ui";
import { Logo } from "./Nav";

/**
 * Nothing behind this ever mounts without a live Supabase session — the
 * database API has no other access control, so this is the whole boundary.
 * Decided above StoreProvider on purpose, same reasoning as the public
 * catalog split in App.jsx: no session means no ledger query is ever issued.
 */
export function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!SUPABASE_CONFIGURED) return <NotConfigured />;
  if (session === undefined) return <AuthChecking />;
  if (!session) return <Login />;
  return children;
}

function NotConfigured() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-[17px] font-semibold">Supabase isn't configured yet</p>
      <p className="mt-1.5 text-eta leading-relaxed text-ink-2">
        Copy <code className="rounded bg-surface px-1 py-0.5">.env.example</code> to{" "}
        <code className="rounded bg-surface px-1 py-0.5">.env.local</code> and fill in your
        Supabase project's URL and anon key, then restart the dev server.
      </p>
    </div>
  );
}

function AuthChecking() {
  return (
    <div className="mx-auto w-full max-w-sm px-4 pt-24">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-3 h-11 w-full" />
      <Skeleton className="mt-2 h-11 w-full" />
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError(signInError.message || "Sign-in failed.");
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-paper px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <div className="mb-5 flex items-center gap-2">
          <Logo />
          <div>
            <p className="text-[15px] font-semibold leading-tight">PTG Admin</p>
            <p className="text-eta text-ink-2 leading-tight">Sign in to continue</p>
          </div>
        </div>

        <Field label="Email" className="mb-3">
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password" error={error} className="mb-4">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
