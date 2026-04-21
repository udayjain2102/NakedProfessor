import { supabase, hasSupabaseConfig } from "./supabaseClient";
import {
  clearWorkspace as clearLocalWorkspace,
  loadWorkspace as loadLocalWorkspace,
  saveWorkspace as saveLocalWorkspace,
} from "./workspaceStore";

const GUEST_SCOPE = "guest";
const WORKSPACE_TABLE = "plan_workspaces";

function normalizeWorkspace(workspace = {}) {
  return {
    accountName: workspace.accountName || "",
    subjects: Array.isArray(workspace.subjects) ? workspace.subjects : [],
  };
}

function getLocalScope(user) {
  return user?.id || GUEST_SCOPE;
}

function shouldUseSupabase(user) {
  return hasSupabaseConfig() && Boolean(user?.id);
}

export function getPlanStoreMode(user) {
  return shouldUseSupabase(user) ? "supabase" : "guest";
}

export function canUseCloudPlanStore() {
  return hasSupabaseConfig();
}

export function derivePlanStoreAccountName(user, workspace) {
  if (workspace?.accountName) return workspace.accountName;
  if (!user) return "Guest mode";
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Student"
  );
}

export async function loadPlanWorkspace({ user } = {}) {
  if (!shouldUseSupabase(user)) {
    return normalizeWorkspace(loadLocalWorkspace(getLocalScope(user)));
  }

  const { data, error, status } = await supabase
    .from(WORKSPACE_TABLE)
    .select("account_name, subjects")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error && status !== 406) {
    throw error;
  }

  return normalizeWorkspace({
    accountName: data?.account_name || "",
    subjects: data?.subjects,
  });
}

export async function savePlanWorkspace(workspace, { user } = {}) {
  const normalizedWorkspace = normalizeWorkspace(workspace);

  if (!shouldUseSupabase(user)) {
    saveLocalWorkspace(normalizedWorkspace, getLocalScope(user));
    return normalizedWorkspace;
  }

  const { error } = await supabase.from(WORKSPACE_TABLE).upsert(
    {
      user_id: user.id,
      account_name: normalizedWorkspace.accountName,
      subjects: normalizedWorkspace.subjects,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
    }
  );

  if (error) throw error;
  return normalizedWorkspace;
}

export async function clearPlanWorkspace({ user } = {}) {
  if (!shouldUseSupabase(user)) {
    clearLocalWorkspace(getLocalScope(user));
    return;
  }

  const { error } = await supabase.from(WORKSPACE_TABLE).delete().eq("user_id", user.id);
  if (error) throw error;
}
