const STORAGE_KEY = "np-student-workspace-v1";

function scopedKey(scope = "guest") {
  return `${STORAGE_KEY}:${scope}`;
}

export function loadWorkspace(scope) {
  if (typeof window === "undefined" || !window.localStorage) {
    return { accountName: "", subjects: [] };
  }

  try {
    const raw = window.localStorage.getItem(scopedKey(scope));
    if (!raw) return { accountName: "", subjects: [] };
    const parsed = JSON.parse(raw);
    return {
      accountName: parsed.accountName || "",
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
    };
  } catch {
    return { accountName: "", subjects: [] };
  }
}

export function saveWorkspace(workspace, scope) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(scopedKey(scope), JSON.stringify(workspace));
  } catch {
    /* local persistence is best-effort */
  }
}

export function clearWorkspace(scope) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(scopedKey(scope));
  } catch {
    /* ignore */
  }
}
