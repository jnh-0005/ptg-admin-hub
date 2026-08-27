import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = Boolean(url && anonKey);

if (!SUPABASE_CONFIGURED) {
  // Loud on purpose: a missing key here means every query silently 401s.
  // A placeholder URL below keeps createClient from throwing synchronously
  // and blanking the whole app before AuthGate gets a chance to explain why.
  // eslint-disable-next-line no-console
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill in your Supabase project's values.",
  );
}

export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
