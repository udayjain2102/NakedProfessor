import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://hzpjltcsbczluyhleyla.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_9QpoSFjKGyLtzCP1_KVpQg_Y1l2n3_o";

function normalizeRedirectUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function getAuthRedirectUrl() {
  const configuredUrl = normalizeRedirectUrl(
    import.meta.env.VITE_AUTH_REDIRECT_URL || import.meta.env.VITE_SITE_URL
  );
  if (configuredUrl) return configuredUrl;

  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeRedirectUrl(window.location.origin) || window.location.origin;
  }

  return undefined;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});
