import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

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

function createNoopSupabaseClient() {
  return {
    auth: {
      async getSession() {
        return { data: { session: null } };
      },
      onAuthStateChange() {
        return {
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        };
      },
      async exchangeCodeForSession() {
        return { data: {}, error: null };
      },
      async signInWithOtp() {
        return { data: {}, error: new Error("Supabase auth is not configured.") };
      },
      async signOut() {
        return { error: null };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null, status: 406 };
                },
              };
            },
          };
        },
        async upsert() {
          return { error: new Error("Supabase storage is not configured.") };
        },
        delete() {
          return {
            async eq() {
              return { error: null };
            },
          };
        },
      };
    },
  };
}

export const supabase = hasSupabaseConfig()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    })
  : createNoopSupabaseClient();
