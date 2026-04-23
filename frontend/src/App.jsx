import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import RealityCheckScreen from "./components/RealityCheckScreen";
import GamePlanScreen from "./components/GamePlanScreen";
import ExecutionHubScreen from "./components/ExecutionHubScreen";
import AdSlot from "./components/AdSlot";
import AsciiPortrait from "./components/AsciiPortrait";
import { deriveProfile } from "./lib/profileDeriver";
import { getFullIntel } from "./lib/survivalIntel";
import { getAuthRedirectUrl, supabase } from "./lib/supabaseClient";
import { loadProfessorArtifact } from "./lib/professorArtifactLoader";
import { generateStudyPlan } from "./lib/studyPlanClient";
import {
  canUseCloudPlanStore,
  derivePlanStoreAccountName,
  loadPlanWorkspace,
  savePlanWorkspace,
} from "./lib/planStore";
import brandLogo from "./assets/nakedprofessor-logo.png";

const SEARCH_RESULT_LIMIT = 6;
const MOBILE_SETUP_QUERY = "(max-width: 960px)";
const SCHOOL_STOP_WORDS = new Set(["of", "the", "and", "at", "main", "campus"]);
const SCHOOL_GENERIC_WORDS = new Set(["university", "college", "institute", "school", "campus"]);

function normalizeSearchValue(value) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInitialism(words) {
  return words.map((word) => word[0]).join("");
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, "");
}

function uniqueSearchValues(values) {
  return Array.from(
    new Set(values.map((value) => normalizeSearchValue(value)).filter(Boolean))
  );
}

function scoreSubsequence(query, candidate) {
  if (!query || query.length < 3 || !candidate) return 0;

  let queryIndex = 0;
  let lastMatchIndex = -1;
  let gapPenalty = 0;

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    if (candidate[candidateIndex] !== query[queryIndex]) continue;
    if (lastMatchIndex !== -1) {
      gapPenalty += candidateIndex - lastMatchIndex - 1;
    }
    lastMatchIndex = candidateIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      return Math.max(1, 120 - gapPenalty - (candidate.length - query.length));
    }
  }

  return 0;
}

function scoreTokenPrefix(query, candidate) {
  const queryTokens = query.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let tokenCursor = 0;
  let score = 0;

  for (const queryToken of queryTokens) {
    const tokenIndex = candidateTokens.findIndex(
      (candidateToken, index) => index >= tokenCursor && candidateToken.startsWith(queryToken)
    );
    if (tokenIndex === -1) return 0;
    const candidateToken = candidateTokens[tokenIndex];
    score += 50 - Math.min(16, candidateToken.length - queryToken.length);
    tokenCursor = tokenIndex + 1;
  }

  return score;
}

function scoreSearchAlias(query, candidate) {
  if (!query || !candidate) return 0;

  const compactQuery = query.replace(/\s+/g, "");
  const compactCandidate = candidate.replace(/\s+/g, "");

  if (candidate === query) return 1400;
  if (compactCandidate === compactQuery) return 1320;
  if (candidate.startsWith(query)) {
    return 1180 - Math.min(160, candidate.length - query.length);
  }

  const tokenPrefixScore = scoreTokenPrefix(query, candidate);
  if (tokenPrefixScore > 0) {
    return 940 + tokenPrefixScore;
  }

  const tokenBoundaryIndex = candidate.indexOf(` ${query}`);
  if (tokenBoundaryIndex !== -1) {
    return 820 - Math.min(140, tokenBoundaryIndex * 6);
  }

  if (query.length >= 3) {
    const substringIndex = candidate.indexOf(query);
    if (substringIndex !== -1) {
      return 760 - Math.min(180, substringIndex * 8);
    }
  }

  const subsequenceScore = scoreSubsequence(compactQuery, compactCandidate);
  if (subsequenceScore > 0) {
    return 520 + subsequenceScore;
  }

  return 0;
}

function minimumSearchScore(queryVariants) {
  const longestQueryLength = queryVariants.reduce(
    (maxLength, query) => Math.max(maxLength, query.replace(/\s+/g, "").length),
    0
  );

  if (longestQueryLength <= 1) return 1180;
  if (longestQueryLength === 2) return 900;
  return 520;
}

function rankSearchResults(items, queryVariants, getAliases, compareItems, limit = SEARCH_RESULT_LIMIT) {
  if (!queryVariants.length) return items.slice(0, limit);

  const acceptedScore = minimumSearchScore(queryVariants);

  return items
    .map((item) => {
      const aliases = getAliases(item);
      const score = queryVariants.reduce((bestScore, query) => {
        const aliasScore = aliases.reduce((bestAliasScore, alias) => {
          return Math.max(bestAliasScore, scoreSearchAlias(query, alias));
        }, 0);
        return Math.max(bestScore, aliasScore);
      }, 0);

      return { item, score };
    })
    .filter((entry) => entry.score >= acceptedScore)
    .sort((left, right) => right.score - left.score || compareItems(left.item, right.item))
    .slice(0, limit)
    .map((entry) => entry.item);
}

function schoolKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bmain campus\b/g, " ")
    .replace(/\buniversity park\b/g, " ")
    .replace(/\bmit\b/g, "massachusetts institute of technology")
    .replace(/\bcaltech\b/g, "california institute of technology")
    .replace(/\bucla\b/g, "university of california los angeles")
    .replace(/\bucb\b/g, "university of california berkeley")
    .replace(/\bucsd\b/g, "university of california san diego")
    .replace(/\bucsb\b/g, "university of california santa barbara")
    .replace(/\bnyu\b/g, "new york university")
    .replace(/\bpenn state\b/g, "pennsylvania state university")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSchoolAliases(name, state) {
  const normalizedName = normalizeSearchValue(name);
  const normalizedKey = normalizeSearchValue(schoolKey(name));
  const compactName = compactSearchValue(name);
  const compactKey = compactSearchValue(schoolKey(name));
  const words = normalizedKey.split(" ").filter(Boolean);
  const searchWords = words.filter((word) => !SCHOOL_STOP_WORDS.has(word));
  const coreWords = searchWords.filter((word) => !SCHOOL_GENERIC_WORDS.has(word));
  const aliases = [name, normalizedName, normalizedKey, compactName, compactKey];

  if (searchWords.length > 1) {
    aliases.push(searchWords.join(" "));
    aliases.push(compactSearchValue(searchWords.join(" ")));
    aliases.push(buildInitialism(searchWords));
  }
  if (coreWords.length > 0) {
    aliases.push(coreWords.join(" "));
    aliases.push(compactSearchValue(coreWords.join(" ")));
  }
  if (coreWords.length > 1) {
    aliases.push(buildInitialism(coreWords));
  }
  if (state) aliases.push(state);

  return uniqueSearchValues(aliases);
}

function buildProfessorAliases(professor) {
  const first = professor.professor_first || "";
  const last = professor.professor_last || "";
  const department = professor.department || "";
  const firstInitial = first[0] || "";
  const lastInitial = last[0] || "";
  const fullName = `${first} ${last}`.trim();
  const reversedName = `${last} ${first}`.trim();

  return uniqueSearchValues([
    fullName,
    reversedName,
    `${firstInitial} ${last}`,
    `${last} ${firstInitial}`,
    `${first} ${lastInitial}`,
    `${firstInitial}${last}`,
    `${first}${last}`,
    `${last}${first}`,
    `${firstInitial}${lastInitial}`,
    `${lastInitial}${firstInitial}`,
    department,
    compactSearchValue(department),
    `${fullName} ${department}`,
    `${reversedName} ${department}`,
  ]);
}

/** Merge artifact schools with national rankings list for search. */
function buildSchoolOptions(professors, topColleges) {
  const map = new Map();
  for (const p of professors) {
    const n = (p.school_name || "").trim();
    if (!n) continue;
    const key = schoolKey(n);
    if (!map.has(key)) {
        map.set(key, {
          key,
          name: n,
          rosterAvailable: true,
          professorCount: 0,
          aliases: buildSchoolAliases(n, p.school_state),
        });
    }
    map.get(key).professorCount += 1;
  }
  if (Array.isArray(topColleges)) {
    for (const c of topColleges) {
      const n = c.name;
      if (!n) continue;
      const key = schoolKey(n);
      if (map.has(key)) {
        const e = map.get(key);
        e.state = c.state;
        e.rank = c.rank;
        e.aliases = buildSchoolAliases(e.name, c.state);
      } else {
        map.set(key, {
          key,
          name: n,
          state: c.state,
          rank: c.rank,
          rosterAvailable: false,
          professorCount: 0,
          aliases: buildSchoolAliases(n, c.state),
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function filterSchoolOptions(options, query, limit = SEARCH_RESULT_LIMIT) {
  const queryVariants = uniqueSearchValues([query, schoolKey(query)]);
  return rankSearchResults(
    options,
    queryVariants,
    (option) => option.aliases || buildSchoolAliases(option.name, option.state),
    (left, right) => left.name.localeCompare(right.name),
    limit
  );
}

function filterProfessors(professors, query, limit = SEARCH_RESULT_LIMIT) {
  const queryVariants = uniqueSearchValues([query]);
  return rankSearchResults(
    professors,
    queryVariants,
    buildProfessorAliases,
    (left, right) =>
      left.professor_last.localeCompare(right.professor_last) ||
      left.professor_first.localeCompare(right.professor_first),
    limit
  );
}

function clampHighlightIndex(index, length) {
  if (!length) return -1;
  if (index < 0) return -1;
  if (index >= length) return length - 1;
  return index;
}

function cycleHighlightIndex(index, length, direction) {
  if (!length) return -1;
  if (index < 0) return direction > 0 ? 0 : length - 1;
  return (index + direction + length) % length;
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

const LOADING_LINES = [
  "Analyzing professor patterns…",
  "Cross-checking workload signals…",
  "Calibrating grade scenarios…",
];

const STAGES = [
  {
    id: "reality",
    title: "Reality Check",
    step: "01",
    description:
      "Review professor difficulty, clarity, grading pressure, and the common ways students lose points.",
  },
  {
    id: "gameplan",
    title: "Game Plan",
    step: "02",
    description:
      "Add the syllabus and turn it into a concrete weekly strategy for this specific class.",
  },
  {
    id: "execution",
    title: "Execution Hub",
    step: "03",
    description:
      "Track effort, deadlines, and adjustments once the plan is ready and the semester is moving.",
  },
];

function safeScrollIntoView(node, options) {
  if (node && typeof node.scrollIntoView === "function") {
    node.scrollIntoView(options);
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const AUTH_SEARCH_KEYS = ["code", "error", "error_code", "error_description", "type"];
const AUTH_HASH_KEYS = [
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "provider_token",
  "provider_refresh_token",
  "token_type",
  "type",
  "error",
  "error_code",
  "error_description",
];

function stripAuthCallbackFromUrl() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const nextHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  let changed = false;

  AUTH_SEARCH_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  AUTH_HASH_KEYS.forEach((key) => {
    if (nextHashParams.has(key)) {
      nextHashParams.delete(key);
      changed = true;
    }
  });

  if (!changed) return;

  const nextSearch = url.searchParams.toString();
  const nextHash = nextHashParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl || "/");
}

async function resolveAuthRedirect() {
  if (typeof window === "undefined") return "";

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const authError =
    url.searchParams.get("error_description") || hashParams.get("error_description");

  if (authError) {
    stripAuthCallbackFromUrl();
    return authError.replace(/\+/g, " ");
  }

  const authCode = url.searchParams.get("code");
  if (!authCode || typeof supabase.auth.exchangeCodeForSession !== "function") {
    return "";
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
  stripAuthCallbackFromUrl();
  return exchangeError?.message || "";
}

const TOP_BANNER_AD_SLOT = import.meta.env.VITE_ADSENSE_SLOT_TOP_BANNER || "";
const TOP_COLLEGES_PATH = import.meta.env.VITE_TOP_COLLEGES_PATH || "/data/top_colleges.json";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectMatch = useMatch("/app/select");
  const professorMatch = useMatch("/app/professor/:id");
  const planMatch = useMatch("/app/plan/:id");
  const isSavedRoute = location.pathname === "/saved";
  const [professors, setProfessors] = useState([]);
  const [topColleges, setTopColleges] = useState([]);
  const [collegeSearch, setCollegeSearch] = useState("");
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [materialsNote, setMaterialsNote] = useState("");
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("select");
  const [studyHours, setStudyHours] = useState(9);
  const [authUser, setAuthUser] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [planReady, setPlanReady] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [savedSubjects, setSavedSubjects] = useState([]);
  const [activeSubjectId, setActiveSubjectId] = useState(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [insightVisible, setInsightVisible] = useState(true);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isMobileSetup, setIsMobileSetup] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activePalette, setActivePalette] = useState(null);
  const [schoolHighlightIndex, setSchoolHighlightIndex] = useState(-1);
  const [professorHighlightIndex, setProfessorHighlightIndex] = useState(-1);
  const [stepTransition, setStepTransition] = useState("");
  const [highlightedAction, setHighlightedAction] = useState("");
  const rafIdRef = useRef(null);
  const actionTimerRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const prevFlagsRef = useRef({
    hasProfessor: false,
    hasSyllabus: false,
    planReady: false,
  });
  const setupPanelRef = useRef(null);
  const mainTopRef = useRef(null);
  const schoolInputRef = useRef(null);
  const professorInputRef = useRef(null);
  const schoolSearchTriggerRef = useRef(null);
  const professorSearchTriggerRef = useRef(null);
  const paletteInputRef = useRef(null);
  const paletteDialogRef = useRef(null);
  const focusRestoreRef = useRef(null);
  const hasProfessor = Boolean(selectedId);
  const hasSyllabus = Boolean(syllabus.trim());
  const supportsAccountSync = canUseCloudPlanStore();
  const canSaveSubjects = true;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await loadProfessorArtifact();
        if (cancelled) return;
        setProfessors(loaded.professors);
        setTopColleges(loaded.schools);

        try {
          const colRes = await fetch(TOP_COLLEGES_PATH);
          if (!colRes.ok) return;
          const json = await colRes.json();
          if (!cancelled && Array.isArray(json)) setTopColleges(json);
        } catch {
          /* rankings optional */
        }
      } catch {
        if (!cancelled) setError("Unable to load professor data.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(MOBILE_SETUP_QUERY);
    const handleChange = (event) => {
      setIsMobileSetup(event.matches);
      if (event.matches) setIsSidebarCollapsed(false);
    };

    setIsMobileSetup(mediaQuery.matches);
    if (mediaQuery.matches) setIsSidebarCollapsed(false);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (selectMatch) {
      setMode("select");
      return;
    }
    if (professorMatch?.params?.id) {
      setSelectedId(professorMatch.params.id);
      setMode("reality");
      return;
    }
    if (planMatch?.params?.id) {
      setSelectedId(planMatch.params.id);
      setMode("gameplan");
      return;
    }
    if (isSavedRoute) {
      setMode("select");
      setIsSetupOpen(true);
    }
  }, [isSavedRoute, planMatch, professorMatch, selectMatch]);

  useEffect(() => {
    if (!supportsAccountSync) {
      setAuthUser(null);
      return undefined;
    }

    let mounted = true;

    async function hydrateAuth() {
      const redirectError = await resolveAuthRedirect();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session?.user) stripAuthCallbackFromUrl();
      if (redirectError) setError(redirectError);
      setAuthUser(session?.user ?? null);
    }

    hydrateAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        stripAuthCallbackFromUrl();
        setError("");
      }
      setAuthUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supportsAccountSync]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkspace() {
      if (!supportsAccountSync || !authUser) {
        try {
          const workspace = await loadPlanWorkspace();
          if (cancelled) return;
          setAccountName(derivePlanStoreAccountName(null, workspace));
          setSavedSubjects(Array.isArray(workspace.subjects) ? workspace.subjects : []);
          setAuthNotice(
            supportsAccountSync
              ? "Guest mode active. Sign in to sync subjects across devices."
              : "Guest mode active. Subjects and plans are saved on this device."
          );
          setWorkspaceLoaded(true);
        } catch {
          if (cancelled) return;
          setAccountName("Guest mode");
          setSavedSubjects([]);
          setAuthNotice(
            supportsAccountSync
              ? "Guest mode active. Sign in to sync subjects across devices."
              : "Guest mode active. Subjects and plans are saved on this device."
          );
          setError("Unable to load saved subjects.");
          setWorkspaceLoaded(true);
        }
        return;
      }

      try {
        const workspace = await loadPlanWorkspace({ user: authUser });
        if (cancelled) return;
        setAccountName(derivePlanStoreAccountName(authUser, workspace));
        setSavedSubjects(Array.isArray(workspace.subjects) ? workspace.subjects : []);
        setActiveSubjectId(null);
        setSubjectName("");
        setAuthNotice("");
        setWorkspaceLoaded(true);
      } catch {
        if (cancelled) return;
        setError("Unable to load saved subjects.");
        setWorkspaceLoaded(true);
      }
    }

    hydrateWorkspace();

    return () => {
      cancelled = true;
    };
  }, [authUser, supportsAccountSync]);

  useEffect(() => {
    if (!workspaceLoaded || !canSaveSubjects) return;

    let cancelled = false;

    async function persistWorkspace() {
      try {
        await savePlanWorkspace(
          {
            accountName,
            subjects: savedSubjects,
          },
          {
            user: authUser,
          }
        );
      } catch {
        if (!cancelled) {
          setError("Unable to save subjects.");
        }
      }
    }

    persistWorkspace();

    return () => {
      cancelled = true;
    };
  }, [accountName, authUser, canSaveSubjects, savedSubjects, workspaceLoaded]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      rafIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMobileSetup && activePalette) {
      setActivePalette(null);
    }
  }, [activePalette, isMobileSetup]);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => {
      setLoadingIdx((i) => (i + 1) % LOADING_LINES.length);
    }, 900);
    return () => clearInterval(t);
  }, [loading]);

  const selectedProfessor = useMemo(
    () => professors.find((p) => p.professor_id === selectedId),
    [professors, selectedId]
  );

  useEffect(() => {
    if (!selectedProfessor) return;
    const inferredKey = schoolKey(selectedProfessor.school_name);
    const rankedSchool = topColleges.find((school) => schoolKey(school.name) === inferredKey);
    const inferredSchool = {
      key: inferredKey,
      name: selectedProfessor.school_name,
      professorCount: professors.filter(
        (professor) => schoolKey(professor.school_name) === inferredKey
      ).length,
      rosterAvailable: true,
      state: rankedSchool?.state,
      rank: rankedSchool?.rank,
    };
    setSelectedSchool((current) => (current?.key === inferredSchool.key ? current : inferredSchool));
  }, [professors, selectedProfessor, topColleges]);

  const profile = useMemo(
    () => (selectedProfessor ? deriveProfile(selectedProfessor) : null),
    [selectedProfessor]
  );

  const intel = useMemo(
    () => (selectedProfessor ? getFullIntel(selectedProfessor) : null),
    [selectedProfessor]
  );

  const schoolOptions = useMemo(
    () => buildSchoolOptions(professors, topColleges),
    [professors, topColleges]
  );

  const filteredCollegeOptions = useMemo(
    () => filterSchoolOptions(schoolOptions, collegeSearch),
    [schoolOptions, collegeSearch]
  );

  const professorPool = useMemo(() => {
    if (!selectedSchool) return [];
    return professors.filter((p) => schoolKey(p.school_name) === selectedSchool.key);
  }, [professors, selectedSchool]);

  const filteredProfessors = useMemo(
    () => filterProfessors(professorPool, search),
    [professorPool, search]
  );

  useEffect(() => {
    setSchoolHighlightIndex((current) =>
      clampHighlightIndex(current < 0 ? 0 : current, filteredCollegeOptions.length)
    );
  }, [filteredCollegeOptions]);

  useEffect(() => {
    setProfessorHighlightIndex((current) =>
      clampHighlightIndex(current < 0 ? 0 : current, filteredProfessors.length)
    );
  }, [filteredProfessors]);

  useEffect(() => {
    if (!activePalette) return;

    const focusTimer = setTimeout(() => {
      paletteInputRef.current?.focus();
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [activePalette]);
  const selectedSchoolHasRoster = Boolean(selectedSchool?.professorCount);
  const activeStage = useMemo(
    () => STAGES.find((item) => item.id === mode) || STAGES[0],
    [mode]
  );
  const unlockedModes = useMemo(
    () => ({
      reality: hasProfessor,
      gameplan: hasProfessor && hasSyllabus,
      execution: planReady,
    }),
    [hasProfessor, hasSyllabus, planReady]
  );
  const stepperSteps = useMemo(
    () =>
      STAGES.map((item) => {
        let status = "";
        if (item.id === "reality") {
          status = hasProfessor
            ? "Professor selected. Risk review is ready."
            : selectedSchool && !selectedSchoolHasRoster
              ? "Choose another school to unlock this stage."
              : selectedSchool
                ? "Select a professor in Setup."
                : "Select a school and professor in Setup.";
        } else if (item.id === "gameplan") {
          status = hasSyllabus
            ? planReady
              ? "Syllabus loaded. Strategy generated."
              : "Syllabus loaded. Generate your strategy."
            : hasProfessor
              ? "Add your syllabus to unlock this stage."
              : "Complete Reality Check first.";
        } else {
          status = planReady
            ? "Plan ready. Tracking is live."
            : "Generate a plan to unlock it.";
        }

        const isCurrent = mode !== "select" && mode === item.id;
        const isCompleted =
          item.id === "reality"
            ? hasProfessor && (mode === "gameplan" || mode === "execution")
            : item.id === "gameplan"
              ? planReady && mode === "execution"
              : false;
        const isUnlocked = isCurrent || isCompleted || unlockedModes[item.id];

        return {
          ...item,
          status,
          state: isCompleted ? "completed" : isCurrent ? "current" : "locked",
          unlocked: isUnlocked,
        };
      }),
    [
      hasProfessor,
      hasSyllabus,
      mode,
      planReady,
      selectedSchool,
      selectedSchoolHasRoster,
      unlockedModes,
    ]
  );
  const nextAction = useMemo(() => {
    if (!selectedSchool) return "Next: choose a school to begin";
    if (!selectedSchoolHasRoster) return "Next: choose a school with a roster";
    if (!hasProfessor) return "Next: choose a professor to begin";
    if (mode === "reality") return "Next: add your syllabus to generate a plan";
    if (!hasSyllabus) return "Next: add your syllabus to generate a plan";
    if (!planReady) return "Next: generate your weekly strategy";
    return "Next: start tracking execution";
  }, [hasProfessor, hasSyllabus, mode, planReady, selectedSchool, selectedSchoolHasRoster]);
  const shellHeader = useMemo(() => {
    if (mode === "select") {
      if (!selectedSchool) {
        return {
          kicker: "Setup",
          title: "Choose your class context",
          copy:
            "Use the Setup panel to pick a school and then a professor. The planning flow unlocks after that context is set.",
        };
      }
      if (!selectedSchoolHasRoster) {
        return {
          kicker: "Setup",
          title: "Choose a school with a roster",
          copy:
            "This school is ranked, but professor data is not available here yet. Pick another school to continue.",
        };
      }
      return {
        kicker: "Setup",
        title: "Select a professor",
        copy: `Pick a professor from ${selectedSchool.name} to unlock Reality Check.`,
      };
    }

    return {
      kicker: `Stage ${activeStage.step}`,
      title: activeStage.title,
      copy: activeStage.description,
    };
  }, [activeStage.description, activeStage.step, activeStage.title, mode, selectedSchool, selectedSchoolHasRoster]);
  const activeSchoolOption = filteredCollegeOptions[schoolHighlightIndex] || null;
  const activeProfessorOption = filteredProfessors[professorHighlightIndex] || null;
  const paletteResults = activePalette === "school" ? filteredCollegeOptions : filteredProfessors;
  const paletteQuery = activePalette === "school" ? collegeSearch : search;
  const renderSchoolOption = (opt, index, idPrefix = "np-school-option") => {
    const isSelected = selectedSchool?.key === opt.key;
    const isHighlighted = schoolHighlightIndex === index;

    return (
      <button
        key={`${idPrefix}-${opt.key}`}
        id={`${idPrefix}-${opt.key}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={`np-college-row ${
          isSelected ? "np-college-row-selected" : ""
        } ${isHighlighted ? "np-option-highlighted" : ""}`}
        onMouseEnter={() => setSchoolHighlightIndex(index)}
        onClick={() => handleSelectSchool(opt)}
      >
        <span className="np-college-row-main">
          <span className="np-college-name">{opt.name}</span>
          <span className="np-meta-chip-row">
            {opt.state && <span className="np-meta-chip">{opt.state}</span>}
            {opt.rank != null && <span className="np-meta-chip">Rank #{opt.rank}</span>}
            <span className="np-meta-chip">
              {opt.professorCount > 0 ? `${opt.professorCount} profs` : "No roster"}
            </span>
          </span>
        </span>
        {isSelected && <span className="np-selected-marker">Selected</span>}
      </button>
    );
  };
  const renderProfessorOption = (professor, index, idPrefix = "np-professor-option") => {
    const isSelected = professor.professor_id === selectedId;
    const isHighlighted = professorHighlightIndex === index;

    return (
      <button
        key={`${idPrefix}-${professor.professor_id}`}
        type="button"
        id={`${idPrefix}-${professor.professor_id}`}
        role="option"
        aria-selected={isSelected}
        className={`np-prof ${isSelected ? "np-prof-active" : ""} ${
          isHighlighted ? "np-option-highlighted" : ""
        }`}
        onMouseEnter={() => setProfessorHighlightIndex(index)}
        onClick={() => handleSelectProfessor(professor)}
      >
        <span className="np-prof-main">
          <span className="np-prof-name">
            {professor.professor_first} {professor.professor_last}
          </span>
          <span className="np-meta-chip-row">
            {professor.department && <span className="np-meta-chip">{professor.department}</span>}
            {professor.avg_rating && <span className="np-meta-chip">Rating {professor.avg_rating}</span>}
            {professor.avg_difficulty && (
              <span className="np-meta-chip">Difficulty {professor.avg_difficulty}</span>
            )}
            {professor.num_ratings && (
              <span className="np-meta-chip">{professor.num_ratings} reviews</span>
            )}
          </span>
        </span>
        {isSelected && <span className="np-selected-marker">Selected</span>}
      </button>
    );
  };
  const heroState = (() => {
    if (hasProfessor) return null;
    if (selectedSchool && !selectedSchoolHasRoster) {
      return {
        title: "This school does not have a professor roster yet",
        copy: "Choose another school in Setup to continue into Reality Check, Game Plan, and Execution Hub.",
        ctaLabel: "Choose Another School",
        action: handleClearSchool,
      };
    }
    if (selectedSchool) {
      return {
        title: "Start by picking a professor",
        copy: `Choose a professor from ${selectedSchool.name} in Setup to unlock Reality Check.`,
        ctaLabel: "Jump to Setup",
        action: () => scrollToSetup(true),
      };
    }
    return {
      title: "Start by picking a professor",
      copy: "Search for a school in Setup, then choose a professor to unlock the workflow.",
      ctaLabel: "Jump to Setup",
      action: () => scrollToSetup(true),
    };
  })();
  const headerContext = useMemo(() => {
    if (!selectedProfessor) return null;
    return {
      name: `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`,
      department: selectedProfessor.department || "Department pending",
      school: selectedProfessor.school_name || selectedSchool?.name || "School pending",
      course: courseTitle.trim() || subjectName.trim() || "Course title not set",
      rating: selectedProfessor.avg_rating || null,
      difficulty: selectedProfessor.avg_difficulty || null,
      reviews: selectedProfessor.num_ratings || null,
    };
  }, [courseTitle, selectedProfessor, selectedSchool, subjectName]);

  function closeSearchPalette(options = {}) {
    const { restoreFocus = true } = options;
    const focusTarget = focusRestoreRef.current;
    setActivePalette(null);
    if (!restoreFocus) return;
    focusTarget?.focus?.();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        focusTarget?.focus?.();
      });
      return;
    }
    focusTarget?.focus?.();
  }

  function openSearchPalette(palette, triggerNode) {
    focusRestoreRef.current = triggerNode || document.activeElement;
    setActivePalette(palette);
  }

  function handleSelectSchool(option) {
    setSelectedSchool(option);
    setCollegeSearch("");
    setSelectedId(null);
    setSearch("");
    setPlan(null);
    setPlanReady(false);
    setSchoolHighlightIndex(-1);
    setProfessorHighlightIndex(-1);
    closeSearchPalette({ restoreFocus: false });
    navigate("/app/select");
  }

  function handleSelectProfessor(professor) {
    setSelectedId(professor.professor_id);
    setPlan(null);
    setPlanReady(false);
    setProfessorHighlightIndex(-1);
    closeSearchPalette({ restoreFocus: false });
    setMode("reality");
    navigate(`/app/professor/${professor.professor_id}`);
    setIsSetupOpen(false);
  }

  function handleClearSchool() {
    setSelectedSchool(null);
    setCollegeSearch("");
    setSelectedId(null);
    setSearch("");
    setPlan(null);
    setPlanReady(false);
    setSchoolHighlightIndex(-1);
    setProfessorHighlightIndex(-1);
    navigate("/app/select");
  }

  function focusSchoolSearch(triggerNode) {
    scrollToSetup(true);
    requestAnimationFrame(() => {
      if (isMobileSetup) {
        openSearchPalette("school", triggerNode || schoolSearchTriggerRef.current);
        return;
      }
      schoolInputRef.current?.focus();
    });
  }

  function focusProfessorSearch(triggerNode) {
    if (!selectedSchool || !selectedSchoolHasRoster) {
      focusSchoolSearch(triggerNode);
      return;
    }
    scrollToSetup(true);
    requestAnimationFrame(() => {
      if (isMobileSetup) {
        openSearchPalette("professor", triggerNode || professorSearchTriggerRef.current);
        return;
      }
      professorInputRef.current?.focus();
    });
  }

  function handleSearchNavigation(event, items, activeIndex, setActiveIndex, onSelect, onClose) {
    if (!items.length) {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => cycleHighlightIndex(current, items.length, 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => cycleHighlightIndex(current, items.length, -1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const nextIndex = clampHighlightIndex(activeIndex < 0 ? 0 : activeIndex, items.length);
      const nextItem = items[nextIndex] || items[0];
      if (nextItem) onSelect(nextItem);
      return;
    }

    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      onClose();
    }
  }

  function handleSchoolInputKeyDown(event) {
    handleSearchNavigation(
      event,
      filteredCollegeOptions,
      schoolHighlightIndex,
      setSchoolHighlightIndex,
      handleSelectSchool,
      () => {
        if (activePalette === "school") {
          closeSearchPalette();
          return;
        }
        if (collegeSearch) {
          setCollegeSearch("");
          setSchoolHighlightIndex(-1);
        }
      }
    );
  }

  function handleProfessorInputKeyDown(event) {
    handleSearchNavigation(
      event,
      filteredProfessors,
      professorHighlightIndex,
      setProfessorHighlightIndex,
      handleSelectProfessor,
      () => {
        if (activePalette === "professor") {
          closeSearchPalette();
          return;
        }
        if (search) {
          setSearch("");
          setProfessorHighlightIndex(-1);
        }
      }
    );
  }

  function handlePaletteDialogKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPalette();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(paletteDialogRef.current);
    if (!focusable.length) return;

    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  async function handleEduSignIn() {
    if (!supportsAccountSync) {
      setAuthNotice("Guest mode active. Subjects and plans are saved on this device.");
      return;
    }

    const email = authEmail.trim().toLowerCase();
    if (!/\.edu$/i.test(email)) {
      setError("Use a valid .edu email address.");
      return;
    }

    setError("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });

    if (authError) {
      setError(authError.message);
      return;
    }

    setAuthNotice(`Magic link sent to ${email}.`);
  }

  async function handleSignOut() {
    const { error: authError } = await supabase.auth.signOut();
    if (authError) {
      setError(authError.message);
      return;
    }
    setAuthNotice("");
    setAuthEmail("");
    setSelectedSchool(null);
    setSelectedId(null);
    setCourseTitle("");
    setSyllabus("");
    setMaterialsNote("");
    setPlan(null);
    setPlanReady(false);
    setMode("select");
    navigate("/app/select");
  }

  function loadSavedSubject(subjectId, professorId) {
    const subject = savedSubjects.find((item) => item.id === subjectId);
    if (!subject) return;

    const nextSchool =
      schoolOptions.find((option) => option.key === subject.schoolKey) ||
      (subject.schoolName
        ? {
            key: subject.schoolKey || schoolKey(subject.schoolName),
            name: subject.schoolName,
            professorCount: subject.savedProfessors?.length || 0,
          }
        : null);

    setActiveSubjectId(subject.id);
    setSubjectName(subject.name || "");
    setCourseTitle(subject.courseTitle || "");
    setSyllabus(subject.syllabus || "");
    setMaterialsNote(subject.materialsNote || "");
    setPlan(subject.plan || null);
    setPlanReady(Boolean(subject.planReady || subject.plan));
    setStudyHours(subject.studyHours || 9);
    setCollegeSearch("");
    setSearch("");
    setSelectedSchool(nextSchool);
    setSelectedId(professorId || subject.activeProfessorId || null);
    setSchoolHighlightIndex(-1);
    setProfessorHighlightIndex(-1);
    setActivePalette(null);
    setMode(subject.planReady ? "execution" : subject.syllabus?.trim() ? "gameplan" : "reality");
    setIsSetupOpen(false);
    setError("");
  }

  function handleSaveProfessorToSubject() {
    if (!canSaveSubjects) {
      setError("Sign in before saving subjects to your account.");
      return;
    }
    if (!selectedSchool || !selectedProfessor) {
      setError("Choose a school and professor before saving.");
      return;
    }
    const nextSubjectName = subjectName.trim() || courseTitle.trim();
    if (!nextSubjectName) {
      setError("Name the subject before saving professors to it.");
      return;
    }

    const savedProfessor = {
      professorId: selectedProfessor.professor_id,
      professorName: `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`,
      department: selectedProfessor.department || "Department pending",
      schoolKey: selectedSchool.key,
      schoolName: selectedSchool.name,
      rating: selectedProfessor.avg_rating || null,
      difficulty: selectedProfessor.avg_difficulty || null,
    };

    let nextActiveId = activeSubjectId;
    let didCreate = false;

    setSavedSubjects((prev) => {
      const existing = prev.find(
        (subject) =>
          subject.id === activeSubjectId ||
          subject.name.toLowerCase() === nextSubjectName.toLowerCase()
      );

      if (!existing) {
        nextActiveId = makeId("subject");
        didCreate = true;
        return [
          {
            id: nextActiveId,
            name: nextSubjectName,
            courseTitle: courseTitle.trim() || nextSubjectName,
            syllabus,
            materialsNote,
            plan,
            planReady,
            studyHours,
            schoolKey: selectedSchool.key,
            schoolName: selectedSchool.name,
            activeProfessorId: selectedProfessor.professor_id,
            savedProfessors: [savedProfessor],
          },
          ...prev,
        ];
      }

      nextActiveId = existing.id;
      return prev.map((subject) => {
        if (subject.id !== existing.id) return subject;
        const savedProfessors = Array.isArray(subject.savedProfessors)
          ? subject.savedProfessors.slice()
          : [];
        if (!savedProfessors.some((item) => item.professorId === savedProfessor.professorId)) {
          savedProfessors.push(savedProfessor);
        }
        return {
          ...subject,
          name: nextSubjectName,
          courseTitle: courseTitle.trim() || nextSubjectName,
          syllabus,
          materialsNote,
          plan,
          planReady,
          studyHours,
          schoolKey: selectedSchool.key,
          schoolName: selectedSchool.name,
          activeProfessorId: selectedProfessor.professor_id,
          savedProfessors,
        };
      });
    });

    setActiveSubjectId(nextActiveId);
    setSubjectName(nextSubjectName);
    setError("");
    pulseAction("workspace");
    if (didCreate) {
      setMode("reality");
    }
  }

  async function handleGenerateStrategy() {
    if (!selectedProfessor) {
      setError("Select a professor first.");
      return;
    }
    if (!syllabus.trim()) {
      setError("Paste your syllabus (grading + dates) to generate a plan.");
      return;
    }
    setError("");
    setPlanReady(false);
    setLoading(true);

    try {
      const nextPlan = await generateStudyPlan({
        syllabus,
        professorSignals: {
          professorName: `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`,
          department: selectedProfessor.department || "",
          schoolName: selectedProfessor.school_name || selectedSchool?.name || "",
          avgRating: selectedProfessor.avg_rating || null,
          avgDifficulty: selectedProfessor.avg_difficulty || null,
          wouldTakeAgainPercent: selectedProfessor.would_take_again_percent || null,
          numRatings: selectedProfessor.num_ratings || null,
          workload: profile?.workload || null,
          riskLevel: intel?.risk?.level || null,
          riskExplanation: intel?.risk?.explanation || "",
          confidenceNote: intel?.survival?.confidenceNote || "",
          failurePatterns: (intel?.failureStack || []).map((item) => ({
            label: item.label,
            pct: item.pct,
          })),
          materialsNote: materialsNote.trim(),
          courseTitle: courseTitle.trim(),
        },
      });

      setPlan(nextPlan);
      setPlanReady(true);
      setMode("execution");
    } catch (generationError) {
      setError(generationError.message || "Unable to generate the study plan.");
      setPlan(null);
      setPlanReady(false);
    } finally {
      setLoading(false);
    }
  }

  function scrollToSetup(openDrawer = false) {
    if (!isMobileSetup) setIsSidebarCollapsed(false);
    if (openDrawer) setIsSetupOpen(true);
    safeScrollIntoView(setupPanelRef.current, { behavior: "smooth", block: "start" });
  }

  function pulseAction(action) {
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    setHighlightedAction(action);
    actionTimerRef.current = setTimeout(() => {
      setHighlightedAction("");
      actionTimerRef.current = null;
    }, 1400);
  }

  function animateStep(step) {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setStepTransition(step);
    transitionTimerRef.current = setTimeout(() => {
      setStepTransition("");
      transitionTimerRef.current = null;
    }, 900);
  }

  function handleNextAction() {
    if (!selectedSchool) {
      focusSchoolSearch();
      return;
    }
    if (!selectedSchoolHasRoster) {
      focusSchoolSearch();
      return;
    }
    if (!hasProfessor) {
      focusProfessorSearch();
      return;
    }
    if (mode === "select") {
      goMode("reality");
      return;
    }
    if (!hasSyllabus) {
      goMode("gameplan", { force: true });
      pulseAction("generate");
      requestAnimationFrame(() => {
        const syllabusField = document.getElementById("np-syllabus-input");
        syllabusField?.focus();
        safeScrollIntoView(syllabusField, { behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!planReady) {
      goMode("gameplan");
      pulseAction("generate");
      requestAnimationFrame(() => {
        const button = document.getElementById("np-generate-strategy");
        safeScrollIntoView(button, { behavior: "smooth", block: "center" });
      });
      return;
    }
    goMode("execution");
    pulseAction("track");
    requestAnimationFrame(() => {
      const button = document.getElementById("np-start-tracking");
      safeScrollIntoView(button, { behavior: "smooth", block: "center" });
    });
  }

  useEffect(() => {
    const previous = prevFlagsRef.current;
    if (!previous.hasProfessor && hasProfessor) {
      animateStep("reality");
      pulseAction("reality");
      requestAnimationFrame(() => {
        safeScrollIntoView(mainTopRef.current, { behavior: "smooth", block: "start" });
      });
    }
    if (!previous.hasSyllabus && hasSyllabus) {
      animateStep("gameplan");
      pulseAction("generate");
      requestAnimationFrame(() => {
        const button = document.getElementById("np-generate-strategy");
        safeScrollIntoView(button, { behavior: "smooth", block: "center" });
      });
    }
    if (!previous.planReady && planReady) {
      animateStep("execution");
      pulseAction("track");
      requestAnimationFrame(() => {
        safeScrollIntoView(mainTopRef.current, { behavior: "smooth", block: "start" });
      });
    }
    prevFlagsRef.current = { hasProfessor, hasSyllabus, planReady };
  }, [hasProfessor, hasSyllabus, planReady]);

  useEffect(() => {
    if (!activeSubjectId || !canSaveSubjects) return;

    setSavedSubjects((prev) =>
      prev.map((subject) => {
        if (subject.id !== activeSubjectId) return subject;

        let savedProfessors = Array.isArray(subject.savedProfessors)
          ? subject.savedProfessors.slice()
          : [];

        if (selectedProfessor && selectedSchool) {
          const currentProfessor = {
            professorId: selectedProfessor.professor_id,
            professorName: `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`,
            department: selectedProfessor.department || "Department pending",
            schoolKey: selectedSchool.key,
            schoolName: selectedSchool.name,
            rating: selectedProfessor.avg_rating || null,
            difficulty: selectedProfessor.avg_difficulty || null,
          };

          if (!savedProfessors.some((item) => item.professorId === currentProfessor.professorId)) {
            savedProfessors.push(currentProfessor);
          }
        }

        return {
          ...subject,
          name: subjectName.trim() || courseTitle.trim() || subject.name,
          courseTitle: courseTitle.trim() || subject.courseTitle,
          syllabus,
          materialsNote,
          plan,
          planReady,
          studyHours,
          schoolKey: selectedSchool?.key || subject.schoolKey,
          schoolName: selectedSchool?.name || subject.schoolName,
          activeProfessorId: selectedProfessor?.professor_id || subject.activeProfessorId,
          savedProfessors,
        };
      })
    );
  }, [
    authUser,
    activeSubjectId,
    canSaveSubjects,
    courseTitle,
    materialsNote,
    planReady,
    plan,
    selectedProfessor,
    selectedSchool,
    studyHours,
    subjectName,
    syllabus,
  ]);

  function goMode(next, options = {}) {
    const { force = false } = options;
    if (!force && next !== mode && !unlockedModes[next]) return;
    setInsightVisible(false);
    setMode(next);
    if (next === "select") {
      navigate("/app/select");
    } else if (next === "reality" && selectedId) {
      navigate(`/app/professor/${selectedId}`);
    } else if ((next === "gameplan" || next === "execution") && selectedId) {
      navigate(`/app/plan/${selectedId}`);
    }
    if (rafIdRef.current != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (typeof requestAnimationFrame === "undefined") {
      rafIdRef.current = null;
      setInsightVisible(true);
      return;
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setInsightVisible(true);
    });
  }

  const bannerCards = [
    {
      label: "Who",
      tone: "who",
      value: selectedProfessor
        ? `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`
        : "Professor pending",
      meta: selectedProfessor
        ? [
            courseTitle.trim() || subjectName.trim() || "Course not set",
            selectedProfessor.department || "Department pending",
            selectedProfessor.school_name,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Choose a school and professor to ground the class context.",
    },
    {
      label: "Risk",
      tone: "risk",
      value: intel?.risk?.level ? `${intel.risk.level} risk` : "Risk pending",
      meta:
        selectedProfessor && profile
          ? `${profile.workload} workload · ${intel?.risk?.explanation || "Professor signals are ready."}`
          : "Workload and grading danger appear after professor selection.",
    },
    {
      label: "Outcome",
      tone: "outcome",
      value:
        intel?.survival != null
          ? `${intel.survival.low}%–${intel.survival.high}%`
          : "Range pending",
      meta:
        intel?.survival != null
          ? `Estimated grade band · ${intel.survival.confidenceNote}`
          : "Confidence range appears after professor selection.",
    },
    {
      label: "State",
      tone: "state",
      value: planReady ? "Plan ready" : "Plan not ready",
      meta:
        planReady
          ? "Execution Hub is unlocked and ready for tracking."
          : hasSyllabus
            ? "Generate your weekly strategy to continue."
            : "Add your syllabus to move into Game Plan.",
    },
  ];
  const workspaceTitle = supportsAccountSync ? "Account Sync" : "Saved Plans";
  const workspaceOwnerName = accountName || (supportsAccountSync ? "No account yet" : "Guest mode");
  const workspaceSummary =
    supportsAccountSync && authUser
      ? `${savedSubjects.length} ${
          savedSubjects.length === 1 ? "subject" : "subjects"
        } saved to your account.`
      : `${savedSubjects.length} ${
          savedSubjects.length === 1 ? "subject" : "subjects"
        } saved on this device.`;
  const workspaceEmptyState =
    supportsAccountSync && authUser
      ? "Saved subjects will appear here after you save a professor to your account."
      : "Saved subjects will appear here after you save a professor on this device.";
  const showSchoolResults =
    !isMobileSetup &&
    filteredCollegeOptions.length > 0 &&
    (!selectedSchool || Boolean(collegeSearch.trim()));
  const showProfessorResults = !isMobileSetup && filteredProfessors.length > 0;
  const collapsedSidebarSummary = [
    selectedSchool?.name || "School pending",
    selectedProfessor
      ? `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`
      : "Professor pending",
    planReady ? "Plan ready" : "Plan pending",
  ];

  return (
    <div className={`np-app ${isSidebarCollapsed ? "np-app-sidebar-collapsed" : ""}`}>
      <aside
        className={`np-sidebar ${isSetupOpen ? "np-sidebar-open" : ""} ${
          isSidebarCollapsed ? "np-sidebar-collapsed" : ""
        }`}
      >
        <button
          type="button"
          className="np-sidebar-toggle"
          onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          aria-expanded={!isSidebarCollapsed}
        >
          {isSidebarCollapsed ? "Expand" : "Collapse"}
        </button>
        <button
          type="button"
          className="np-mobile-setup-toggle"
          onClick={() => setIsSetupOpen((open) => !open)}
          aria-expanded={isSetupOpen}
        >
          {isSetupOpen ? "Hide Setup" : "Open Setup"}
        </button>
        {isSidebarCollapsed && !isMobileSetup && (
          <div className="np-sidebar-collapsed-rail">
            <div className="np-brand np-brand-compact">
              <div className="np-brand-mark">
                <img src={brandLogo} alt="NakedProfessor logo" className="np-brand-logo" />
              </div>
            </div>
            <div className="np-sidebar-rail-stack">
              {collapsedSidebarSummary.map((item) => (
                <span key={item} className="np-sidebar-rail-pill">
                  {item}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="np-btn np-btn-ghost np-sidebar-rail-action"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              Open setup
            </button>
          </div>
        )}
        {(!isSidebarCollapsed || isMobileSetup) && (
          <>
        <div className={`np-sidebar-drawer ${isSetupOpen ? "np-sidebar-drawer-open" : ""}`}>
          <div className="np-brand">
            <div className="np-brand-mark">
              <img src={brandLogo} alt="NakedProfessor logo" className="np-brand-logo" />
            </div>
            <div>
              <div className="np-brand-name">NakedProfessor</div>
              <div className="np-brand-tag">Class planning system</div>
            </div>
          </div>

          <div className="np-sidebar-main">
          <div className="np-sidebar-block np-setup-panel" ref={setupPanelRef} id="np-setup-panel">
            <div className="np-setup-head">
              <span className="np-eyebrow">Setup</span>
              <p className="np-fineprint">Search school, select school, search professor, select professor.</p>
            </div>
            <label className="np-label" htmlFor="np-college-search">
              Search school
            </label>
            {isMobileSetup ? (
              <button
                id="np-college-search"
                ref={schoolSearchTriggerRef}
                type="button"
                className="np-search-launcher"
                onClick={(event) => focusSchoolSearch(event.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={activePalette === "school"}
              >
                <span className="np-search-launcher-kicker">Search school</span>
                <strong>{selectedSchool?.name || collegeSearch.trim() || "Find a school"}</strong>
                <small>Type a school name, state, or alias.</small>
              </button>
            ) : (
              <input
                id="np-college-search"
                ref={schoolInputRef}
                className="np-input"
                placeholder="Search school, state, or alias"
                value={collegeSearch}
                onChange={(event) => {
                  setCollegeSearch(event.target.value);
                  setSchoolHighlightIndex(event.target.value.trim() ? 0 : -1);
                }}
                onKeyDown={handleSchoolInputKeyDown}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={filteredCollegeOptions.length > 0}
                aria-controls="np-school-results"
                aria-activedescendant={activeSchoolOption ? `np-school-option-${activeSchoolOption.key}` : undefined}
              />
            )}
            <div className="np-select-state">
              <span className="np-label">Select school</span>
              <div className={`np-selection-card ${selectedSchool ? "np-selection-card-active" : ""}`}>
                <div>
                  <strong>{selectedSchool?.name || "No school selected"}</strong>
                  <p className="np-fineprint">
                    {selectedSchool
                      ? selectedSchoolHasRoster
                        ? "Roster available."
                        : "No roster available."
                      : "Search first, then select a school."}
                  </p>
                </div>
                <button
                  type="button"
                  className={selectedSchool ? "np-selection-action" : "np-selection-action"}
                  onClick={(event) => {
                    if (selectedSchool) {
                      setCollegeSearch(selectedSchool.name);
                      setSchoolHighlightIndex(0);
                    }
                    focusSchoolSearch(event.currentTarget);
                  }}
                >
                  {selectedSchool ? "Change school" : "Browse schools"}
                </button>
              </div>
            </div>
            {!isMobileSetup && filteredCollegeOptions.length === 0 && !selectedSchool && (
              <section className="np-inline-empty-state">
                <p>No schools match this search yet.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={() => {
                    setCollegeSearch("");
                    setSchoolHighlightIndex(-1);
                  }}
                >
                  Clear school search
                </button>
              </section>
            )}
            {selectedSchool && !collegeSearch.trim() && (
              <section className="np-inline-empty-state np-inline-compact-state">
                <p>School locked to {selectedSchool.name}. Search again if you want to switch universities.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={(event) => {
                    setCollegeSearch(selectedSchool.name);
                    setSchoolHighlightIndex(0);
                    focusSchoolSearch(event.currentTarget);
                  }}
                >
                  Change school
                </button>
              </section>
            )}
            {showSchoolResults && (
              <div className="np-college-list" role="listbox" id="np-school-results">
                {filteredCollegeOptions.map((opt, index) => renderSchoolOption(opt, index))}
              </div>
            )}
            <label className="np-label" htmlFor="np-search">
              Search professor
            </label>
            {isMobileSetup ? (
              <button
                id="np-search"
                ref={professorSearchTriggerRef}
                type="button"
                className="np-search-launcher"
                onClick={(event) => focusProfessorSearch(event.currentTarget)}
                disabled={!selectedSchool}
                aria-haspopup="dialog"
                aria-expanded={activePalette === "professor"}
              >
                <span className="np-search-launcher-kicker">Search professor</span>
                <strong>
                  {selectedProfessor
                    ? `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`
                    : search.trim() || "Find a professor"}
                </strong>
                <small>
                  {selectedSchool
                    ? "Type a name, initials, or department."
                    : "Select a school first."}
                </small>
              </button>
            ) : (
              <input
                id="np-search"
                ref={professorInputRef}
                className="np-input"
                placeholder={
                  selectedSchool ? "Search name, initials, or department" : "Select a school first"
                }
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setProfessorHighlightIndex(event.target.value.trim() ? 0 : -1);
                }}
                onKeyDown={handleProfessorInputKeyDown}
                disabled={!selectedSchool || !selectedSchoolHasRoster}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={filteredProfessors.length > 0}
                aria-controls="np-professor-results"
                aria-activedescendant={
                  activeProfessorOption
                    ? `np-professor-option-${activeProfessorOption.professor_id}`
                    : undefined
                }
              />
            )}
            <div className="np-select-state">
              <span className="np-label">Select professor</span>
              <div className={`np-selection-card ${selectedProfessor ? "np-selection-card-active" : ""}`}>
                <div>
                  <strong>
                    {selectedProfessor
                      ? `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`
                      : "No professor selected"}
                  </strong>
                  <p className="np-fineprint">
                    {selectedProfessor
                      ? selectedProfessor.department
                      : selectedSchool && !selectedSchoolHasRoster
                        ? "Choose another school to load a roster."
                        : selectedSchool
                        ? "Choose a professor to unlock Reality Check."
                        : "Select a school first to load professor options."}
                  </p>
                </div>
                {!selectedProfessor ? (
                  <button
                    type="button"
                    className="np-selection-action"
                    onClick={(event) =>
                      selectedSchool
                        ? focusProfessorSearch(event.currentTarget)
                        : focusSchoolSearch(event.currentTarget)
                    }
                  >
                    {selectedSchool && selectedSchoolHasRoster ? "Browse professors" : "Choose school"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="np-selection-action"
                    onClick={(event) => {
                      setSearch(
                        `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`.trim()
                      );
                      setProfessorHighlightIndex(0);
                      focusProfessorSearch(event.currentTarget);
                    }}
                  >
                    Change professor
                  </button>
                )}
              </div>
            </div>
            {!selectedSchool ? (
              <section className="np-inline-empty-state">
                <p>No school selected yet.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={(event) => focusSchoolSearch(event.currentTarget)}
                >
                  Search school
                </button>
              </section>
            ) : !selectedSchoolHasRoster ? (
              <section className="np-inline-empty-state">
                <p>This ranked school does not have a professor roster yet.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={handleClearSchool}
                >
                  Choose another school
                </button>
              </section>
            ) : filteredProfessors.length === 0 && !selectedProfessor ? (
              <section className="np-inline-empty-state">
                <p>No professors match this search yet.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={() => setSearch("")}
                >
                  Clear professor search
                </button>
              </section>
            ) : (
              showProfessorResults && (
                <div
                  className={`np-prof-list ${isMobileSetup ? "np-prof-list-hidden" : ""}`}
                  role="listbox"
                  id="np-professor-results"
                >
                  {filteredProfessors.map((professor, index) =>
                    renderProfessorOption(professor, index)
                  )}
                </div>
              )
            )}
          </div>

          <div className="np-sidebar-block np-account-panel">
            <div className="np-setup-head">
              <span className="np-eyebrow">{workspaceTitle}</span>
            </div>
            {supportsAccountSync && !authUser ? (
              <>
                <p className="np-fineprint">
                  Use your `.edu` email to save subjects to your account and resume them on signed-in devices.
                </p>
                <label className="np-label" htmlFor="np-auth-edu">
                  .edu email
                </label>
                <input
                  id="np-auth-edu"
                  className="np-input"
                  placeholder="name@school.edu"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
                <div className="np-workspace-actions">
                  <button type="button" className="np-btn np-btn-primary" onClick={handleEduSignIn}>
                    Send magic link
                  </button>
                </div>
              </>
            ) : supportsAccountSync ? (
              <div className="np-workspace-actions">
                <button type="button" className="np-btn np-btn-ghost" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <p className="np-fineprint">
                Guest mode is active. Subjects, professors, and plans are saved on this device.
              </p>
            )}
            <div className={`np-selection-card ${accountName ? "np-selection-card-active" : ""}`}>
              <div>
                <strong>{workspaceOwnerName}</strong>
                <p className="np-fineprint">{workspaceSummary}</p>
              </div>
            </div>
            {authUser && (
              <div className="np-fineprint np-auth-meta">
                Signed in as {authUser.email}
              </div>
            )}
            {authNotice && <div className="np-fineprint np-auth-meta">{authNotice}</div>}
          </div>

          {error && <p className="np-error">{error}</p>}
          </div>

          <div className="np-sidebar-bottom">
          <div className="np-sidebar-block np-course-panel">
            <div className="np-setup-head">
              <span className="np-eyebrow">Course Save</span>
              <p className="np-fineprint">Save the selected professor into a course slot at the bottom of the workspace.</p>
            </div>
            <label className="np-label" htmlFor="np-subject-name">
              Subject
            </label>
            <input
              id="np-subject-name"
              className="np-input"
              placeholder="e.g. Calculus II"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              disabled={!canSaveSubjects}
            />
            <div className="np-workspace-actions">
              <button
                type="button"
                className={`np-btn np-btn-secondary ${highlightedAction === "workspace" ? "np-btn-highlight" : ""}`}
                onClick={handleSaveProfessorToSubject}
                disabled={!canSaveSubjects || !selectedSchool || !selectedProfessor}
              >
                Save professor to subject
              </button>
            </div>
            <div className="np-subject-list">
              {savedSubjects.length === 0 ? (
                <div className="np-inline-empty-state">
                  <p>{workspaceEmptyState}</p>
                </div>
              ) : (
                savedSubjects.map((subject) => {
                  const isActive = subject.id === activeSubjectId;
                  return (
                    <article
                      key={subject.id}
                      className={`np-subject-card ${isActive ? "np-subject-card-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="np-subject-head"
                        onClick={() => loadSavedSubject(subject.id)}
                      >
                        <span>
                          <strong>{subject.name}</strong>
                          <small>{subject.schoolName || "School pending"}</small>
                        </span>
                        <span className="np-meta-chip">
                          {(subject.savedProfessors || []).length} teachers
                        </span>
                      </button>
                      <div className="np-saved-professor-list">
                        {(subject.savedProfessors || []).map((teacher) => (
                          <button
                            key={`${subject.id}-${teacher.professorId}`}
                            type="button"
                            className={`np-saved-professor-chip ${
                              selectedId === teacher.professorId && isActive
                                ? "np-saved-professor-chip-active"
                                : ""
                            }`}
                            onClick={() => loadSavedSubject(subject.id, teacher.professorId)}
                          >
                            {teacher.professorName}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
            </div>
          </div>
          </div>
          </>
        )}
      </aside>

      {activePalette && (
        <div
          className="np-search-palette-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearchPalette();
          }}
        >
          <div
            ref={paletteDialogRef}
            className="np-search-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="np-search-palette-title"
            onKeyDown={handlePaletteDialogKeyDown}
          >
            <div className="np-search-palette-head">
              <div>
                <span className="np-eyebrow">Search</span>
                <h2 id="np-search-palette-title" className="np-search-palette-title">
                  {activePalette === "school" ? "School discovery" : "Professor discovery"}
                </h2>
                <p className="np-fineprint">
                  {activePalette === "school"
                    ? "Use a school name, state, or alias. Arrow keys move, Enter selects, Escape closes."
                    : "Use a professor name, initials, or department. Arrow keys move, Enter selects, Escape closes."}
                </p>
              </div>
              <button
                type="button"
                className="np-search-palette-close"
                onClick={() => closeSearchPalette()}
                aria-label="Close search"
              >
                Close
              </button>
            </div>
            <input
              ref={paletteInputRef}
              className="np-input"
              placeholder={
                activePalette === "school"
                  ? "Search school, state, or alias"
                  : "Search professor, initials, or department"
              }
              value={paletteQuery}
              onChange={(event) => {
                if (activePalette === "school") {
                  setCollegeSearch(event.target.value);
                  setSchoolHighlightIndex(0);
                  return;
                }
                setSearch(event.target.value);
                setProfessorHighlightIndex(0);
              }}
              onKeyDown={
                activePalette === "school" ? handleSchoolInputKeyDown : handleProfessorInputKeyDown
              }
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={paletteResults.length > 0}
              aria-controls={
                activePalette === "school" ? "np-school-palette-results" : "np-professor-palette-results"
              }
              aria-activedescendant={
                activePalette === "school"
                  ? activeSchoolOption
                    ? `np-school-palette-option-${activeSchoolOption.key}`
                    : undefined
                  : activeProfessorOption
                    ? `np-professor-palette-option-${activeProfessorOption.professor_id}`
                    : undefined
              }
            />
            {activePalette === "school" ? (
              paletteResults.length === 0 ? (
                <section className="np-inline-empty-state">
                  <p>No schools match this search yet.</p>
                </section>
              ) : (
                <div className="np-search-palette-results" role="listbox" id="np-school-palette-results">
                  {filteredCollegeOptions.map((opt, index) =>
                    renderSchoolOption(opt, index, "np-school-palette-option")
                  )}
                </div>
              )
            ) : !selectedSchool ? (
              <section className="np-inline-empty-state">
                <p>Choose a school first to load professor results.</p>
              </section>
            ) : !selectedSchoolHasRoster ? (
              <section className="np-inline-empty-state">
                <p>This school does not have a professor roster yet.</p>
              </section>
            ) : paletteResults.length === 0 ? (
              <section className="np-inline-empty-state">
                <p>No professors match this search yet.</p>
              </section>
            ) : (
              <div className="np-search-palette-results" role="listbox" id="np-professor-palette-results">
                {filteredProfessors.map((professor, index) =>
                  renderProfessorOption(professor, index, "np-professor-palette-option")
                )}
              </div>
            )}
          </div>

          {error && <p className="np-error">{error}</p>}
        </div>
      )}

      <div className="np-main" ref={mainTopRef}>
        <header className="np-topbar">
          <div className="np-system-strip" aria-label="Workflow status">
            <div className="np-system-cell np-system-cell-label">
              <span className="np-system-label">Workflow</span>
              <strong className="np-system-value">Class planning system</strong>
            </div>
            <div className="np-system-cell">
              <span className="np-system-label">School</span>
              <strong className="np-system-value">{selectedSchool?.name || "Not selected"}</strong>
            </div>
            <div className="np-system-cell">
              <span className="np-system-label">Professor</span>
              <strong className="np-system-value">{selectedProfessor ? "Selected" : "Pending"}</strong>
            </div>
            <div className="np-system-cell">
              <span className="np-system-label">Plan</span>
              <strong className="np-system-value">{planReady ? "Ready" : "Not generated"}</strong>
            </div>
          </div>
          <nav className="np-progress-stepper" aria-label="Stage progress">
            <ol className="np-progress-list">
              {stepperSteps.map((step) => (
                <li key={step.id} className="np-progress-item">
                  <button
                    type="button"
                    className={`np-step-card np-step-${step.state} ${stepTransition === step.id ? "np-step-animate" : ""}`}
                    onClick={() => goMode(step.id)}
                    disabled={!step.unlocked}
                    aria-current={step.state === "current" ? "step" : undefined}
                  >
                    <div className="np-step-topline">
                      <span className="np-mode-step">{step.step}</span>
                      <span className={`np-step-state np-step-state-${step.state}`}>
                        {step.state === "completed"
                          ? "✓ completed"
                          : step.state === "current"
                            ? "Current"
                            : "Locked"}
                      </span>
                    </div>
                    <strong className="np-step-title">{step.title}</strong>
                    <span className="np-step-status">{step.status}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <p className="np-next-action">{nextAction}</p>
          <div className="np-stage-intro">
            <div className="np-stage-kicker">{shellHeader.kicker}</div>
            <h1 className="np-stage-title">{shellHeader.title}</h1>
            <p className="np-stage-copy">{shellHeader.copy}</p>
          </div>
          {headerContext && (
            <div className="np-header-context">
              <div className="np-header-context-main">
                <h2 className="np-header-professor">{headerContext.name}</h2>
                <p className="np-header-context-copy">
                  {headerContext.department} · {headerContext.school}
                </p>
              </div>
              <div className="np-header-context-stats">
                <span className="np-header-stat">{headerContext.course}</span>
                {headerContext.rating && (
                  <span className="np-header-stat">Rating {headerContext.rating}</span>
                )}
                {headerContext.difficulty && (
                  <span className="np-header-stat">Difficulty {headerContext.difficulty}</span>
                )}
                {headerContext.reviews && (
                  <span className="np-header-stat">{headerContext.reviews} reviews</span>
                )}
              </div>
            </div>
          )}
          <AdSlot slot={TOP_BANNER_AD_SLOT} className="np-topbar-ad" minHeight={140} />
        </header>

        {hasProfessor && (
          <section className="np-stage-banner">
            <div className="np-stage-banner-grid">
              {bannerCards.map((card) => (
                <article key={card.label} className={`np-banner-card np-banner-card-${card.tone}`}>
                  <span className="np-banner-label">{card.label}</span>
                  <strong className="np-banner-value">{card.value}</strong>
                  <p className="np-banner-meta">{card.meta}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {loading && (
          <div className="np-loading" role="status">
            <div className="np-loading-pulse" />
            <p>{LOADING_LINES[loadingIdx]}</p>
          </div>
        )}

        <div className={`np-content ${insightVisible ? "np-content-in" : ""}`}>
          {mode === "select" && heroState && (
            <div className="np-screen">
              <section className="np-state-card np-main-hero-state" aria-labelledby="np-select-workflow-title">
                <div className="np-select-hero-copy">
                  <span className="np-state-index">Setup required</span>
                  <h2 id="np-select-workflow-title" className="np-select-title">
                    {heroState.title}
                  </h2>
                  <p>{heroState.copy}</p>
                  <button type="button" className="np-btn np-btn-primary" onClick={heroState.action}>
                    {heroState.ctaLabel}
                  </button>
                </div>
              </section>
            </div>
          )}
          {mode === "reality" && hasProfessor && (
            <RealityCheckScreen
              professor={selectedProfessor}
              courseTitle={courseTitle}
              intel={intel}
              onGeneratePlan={() => goMode("gameplan", { force: true })}
              highlightPrimaryCta={highlightedAction === "reality"}
            />
          )}
          {mode === "gameplan" && (
            <GamePlanScreen
              professor={selectedProfessor}
              profile={profile}
              syllabus={syllabus}
              courseTitle={courseTitle}
              onSyllabusChange={setSyllabus}
              onCourseTitleChange={setCourseTitle}
              materialsNote={materialsNote}
              onMaterialsNoteChange={setMaterialsNote}
              onGenerate={handleGenerateStrategy}
              onOpenExecution={() => goMode("execution")}
              loading={loading}
              plan={plan}
              intel={intel}
              studyHours={studyHours}
              onStudyHoursChange={setStudyHours}
              highlightPrimaryCta={highlightedAction === "generate"}
              onFocusSyllabus={() => {
                const field = document.getElementById("np-syllabus-input");
                field?.focus();
                safeScrollIntoView(field, { behavior: "smooth", block: "center" });
              }}
            />
          )}
          {mode === "execution" && (
            <ExecutionHubScreen
              professor={selectedProfessor}
              profile={profile}
              syllabus={syllabus}
              studyHours={studyHours}
              onStudyHoursChange={setStudyHours}
              planReady={planReady}
              onOpenGamePlan={() => goMode("gameplan", { force: true })}
              highlightPrimaryCta={highlightedAction === "track"}
            />
          )}
        </div>
        <div className="np-mobile-nextbar">
          <button type="button" className="np-btn np-btn-primary" onClick={handleNextAction}>
            {nextAction.replace(/^Next:\s*/, "")}
          </button>
        </div>
      </div>
    </div>
  );
}
