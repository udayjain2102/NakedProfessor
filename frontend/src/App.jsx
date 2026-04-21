import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import RealityCheckScreen from "./components/RealityCheckScreen";
import GamePlanScreen from "./components/GamePlanScreen";
import ExecutionHubScreen from "./components/ExecutionHubScreen";
import AdSlot from "./components/AdSlot";
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
        inDataset: true,
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
  if (index < 0) return 0;
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

const MODES = [
  {
    id: "select",
    label: "Choose Context",
    step: "00",
    description:
      "Pick your school and professor context first so risk scoring and planning are grounded in the right class setup.",
  },
  {
    id: "reality",
    label: "Reality Check",
    step: "01",
    description:
      "Read the professor first: difficulty, clarity, grading risk, and the ways students usually lose points.",
  },
  {
    id: "gameplan",
    label: "Game Plan",
    step: "02",
    description:
      "Turn the syllabus into a concrete weekly strategy instead of generic study advice.",
  },
  {
    id: "execution",
    label: "Execution Hub",
    step: "03",
    description:
      "Track alignment once the semester starts so the plan stays usable under real workload pressure.",
  },
];

function StateCard({ title, copy, ctaLabel, onCta, tone = "default" }) {
  return (
    <section className={`np-state-card np-state-card-${tone}`}>
      <div className="np-state-copy">
        <h2 className="np-state-title">{title}</h2>
        <p>{copy}</p>
      </div>
      <button type="button" className="np-btn np-btn-primary" onClick={onCta}>
        {ctaLabel}
      </button>
    </section>
  );
}

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
  const canSaveSubjects = !supportsAccountSync || Boolean(authUser);

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
    const handleChange = (event) => setIsMobileSetup(event.matches);

    setIsMobileSetup(mediaQuery.matches);
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
      if (!supportsAccountSync) {
        try {
          const workspace = await loadPlanWorkspace();
          if (cancelled) return;
          setAccountName(derivePlanStoreAccountName(null, workspace));
          setSavedSubjects(Array.isArray(workspace.subjects) ? workspace.subjects : []);
          setAuthNotice("Guest mode active. Subjects and plans are saved on this device.");
          setWorkspaceLoaded(true);
        } catch {
          if (cancelled) return;
          setAccountName("Guest mode");
          setSavedSubjects([]);
          setAuthNotice("Guest mode active. Subjects and plans are saved on this device.");
          setError("Unable to load saved subjects.");
          setWorkspaceLoaded(true);
        }
        return;
      }

      if (!authUser) {
        if (cancelled) return;
        setWorkspaceLoaded(false);
        setAccountName("");
        setSavedSubjects([]);
        setActiveSubjectId(null);
        setSubjectName("");
        setSelectedSchool(null);
        setSelectedId(null);
        setCourseTitle("");
        setSyllabus("");
        setMaterialsNote("");
        setPlan(null);
        setPlanReady(false);
        setMode("select");
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
    const inferredSchool = {
      key: schoolKey(selectedProfessor.school_name),
      name: selectedProfessor.school_name,
      professorCount: professors.filter(
        (professor) => schoolKey(professor.school_name) === schoolKey(selectedProfessor.school_name)
      ).length,
    };
    setSelectedSchool((current) => (current?.key === inferredSchool.key ? current : inferredSchool));
  }, [professors, selectedProfessor]);

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
  const currentModeIndex = useMemo(() => {
    const idx = MODES.findIndex((item) => item.id === mode);
    return idx === -1 ? 0 : idx;
  }, [mode]);
  const activeMode = MODES[currentModeIndex] || MODES[0];
  const unlockedModes = useMemo(
    () => ({
      select: true,
      reality: hasProfessor,
      gameplan: hasSyllabus,
      execution: planReady,
    }),
    [hasProfessor, hasSyllabus, planReady]
  );
  const stepperSteps = useMemo(
    () =>
      MODES.map((item) => {
        let status = "";
        if (item.id === "select") {
          status = hasProfessor
            ? "Context selected. Move to Reality Check to inspect risks."
            : "Choose a school and professor to unlock the rest of the flow.";
        } else if (item.id === "reality") {
          status = hasProfessor
            ? selectedProfessor
              ? `Risk readout live for ${selectedProfessor.professor_first} ${selectedProfessor.professor_last}.`
              : "Risk readout will load as soon as professor data resolves."
            : selectedSchool
              ? `Choose a professor from ${selectedSchool.name} to generate the risk readout.`
              : "Choose a university first, then select a professor.";
        } else if (item.id === "gameplan") {
          status = planReady
            ? "Strategy generated and ready to revise."
            : hasSyllabus
              ? "Syllabus is loaded. Generate the strategy to continue."
              : "Paste grading and dates to build the strategy.";
        } else {
          status = planReady
            ? "Weekly alignment board is active."
            : "Unlocks after the Game Plan is generated.";
        }

        const isCurrent = mode === item.id;
        const isCompleted =
          item.id === "select"
            ? hasProfessor
            : item.id === "reality"
            ? hasProfessor && mode !== "reality"
            : item.id === "gameplan"
              ? planReady && mode === "execution"
              : false;
        const isUnlocked = unlockedModes[item.id];

        return {
          ...item,
          status,
          state: isCompleted ? "completed" : isCurrent && isUnlocked ? "current" : "locked",
          unlocked: isUnlocked,
        };
      }),
    [hasProfessor, hasSyllabus, mode, planReady, selectedProfessor, selectedSchool, unlockedModes]
  );
  const nextAction = useMemo(() => {
    if (!selectedSchool) return "Next: choose a university to begin";
    if (!hasProfessor) return "Next: choose a professor from your university";
    if (mode === "select") return "Next: review professor risk signals";
    if (mode === "reality") return "Next: add your syllabus to generate a plan";
    if (!hasSyllabus) return "Next: add your syllabus to generate a plan";
    if (!planReady) return "Next: generate your weekly strategy";
    return "Next: start tracking execution";
  }, [hasProfessor, hasSyllabus, mode, planReady, selectedSchool]);
  const activeSchoolOption = filteredCollegeOptions[schoolHighlightIndex] || null;
  const activeProfessorOption = filteredProfessors[professorHighlightIndex] || null;
  const paletteResults = activePalette === "school" ? filteredCollegeOptions : filteredProfessors;
  const paletteQuery = activePalette === "school" ? collegeSearch : search;
  const heroState = (() => {
    if (hasProfessor) return null;
    if (selectedSchool && professorPool.length === 0) {
      return {
        title: "No professor roster is available for this school",
        copy: "Choose a different school to keep moving through Reality Check, Game Plan, and Execution Hub.",
        ctaLabel: "Choose Another School",
        action: handleClearSchool,
      };
    }
    if (selectedSchool) {
      return {
        title: "Now choose a professor",
        copy: `Choose a professor from ${selectedSchool.name} to activate Reality Check.`,
        ctaLabel: "Choose A Professor",
        action: () => scrollToSetup(true),
      };
    }
    return {
      title: "Start by choosing a university",
      copy: "Pick a school first. Professor search unlocks after the university is selected.",
      ctaLabel: "Choose A University",
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
    if (!selectedSchool) {
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
      setError("Choose a university and professor before saving.");
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
        ? [courseTitle.trim() || subjectName.trim() || "Course title not set", selectedProfessor.school_name]
            .filter(Boolean)
            .join(" · ")
        : "Choose school and professor context.",
    },
    {
      label: "Risk",
      tone: "risk",
      value: intel?.risk?.level ? `${intel.risk.level} risk` : "Risk pending",
      meta:
        selectedProfessor && profile
          ? `${profile.workload} workload · ${intel?.risk?.explanation || "Professor signal read is live."}`
          : "Professor selection unlocks workload and grading risk.",
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
          ? `A-band estimate · ${intel.survival.confidenceNote}`
          : "Estimated grade range appears after professor selection.",
    },
    {
      label: "State",
      tone: "state",
      value: planReady ? "Plan ready" : "Plan not ready",
      meta:
        planReady
          ? "Execution Hub is unlocked."
          : hasSyllabus
            ? "Generate your weekly strategy to unlock execution."
            : "Add syllabus details to move into planning.",
    },
  ];
  const workspaceTitle = supportsAccountSync ? "Account Sync" : "Saved Plans";
  const workspaceOwnerName = accountName || (supportsAccountSync ? "No account yet" : "Guest mode");
  const workspaceSummary = supportsAccountSync
    ? accountName
      ? `${savedSubjects.length} ${
          savedSubjects.length === 1 ? "subject" : "subjects"
        } saved to your account.`
      : "Sign in to save subjects and resume on any device tied to your account."
    : `${savedSubjects.length} ${
        savedSubjects.length === 1 ? "subject" : "subjects"
      } saved on this device.`;
  const workspaceEmptyState = supportsAccountSync
    ? "Saved subjects will appear here after you sign in and save a professor."
    : "Saved subjects will appear here after you save a professor on this device.";

  return (
    <div className="np-app">
      <aside className={`np-sidebar ${isSetupOpen ? "np-sidebar-open" : ""}`}>
        <button
          type="button"
          className="np-mobile-setup-toggle"
          onClick={() => setIsSetupOpen((open) => !open)}
          aria-expanded={isSetupOpen}
        >
          {isSetupOpen ? "Hide Setup" : "Open Setup"}
        </button>
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

          <div className="np-sidebar-block np-workspace-panel">
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

          <div className="np-sidebar-block np-setup-panel" ref={setupPanelRef} id="np-setup-panel">
            <div className="np-setup-head">
              <span className="np-eyebrow">Setup</span>
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
                <span className="np-search-launcher-kicker">Command palette</span>
                <strong>{selectedSchool?.name || collegeSearch.trim() || "Find a school"}</strong>
                <small>Search by school name, state, or alias like PSU, NYU, or UCLA.</small>
              </button>
            ) : (
              <input
                id="np-college-search"
                ref={schoolInputRef}
                className="np-input"
                placeholder="Search school, state, or alias…"
                value={collegeSearch}
                onChange={(event) => {
                  setCollegeSearch(event.target.value);
                  setSchoolHighlightIndex(0);
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
                      ? "Roster available."
                      : "Choose a school to narrow the professor list."}
                  </p>
                </div>
                <button
                  type="button"
                  className={selectedSchool ? "np-school-clear" : "np-selection-action"}
                  onClick={(event) =>
                    selectedSchool
                      ? handleClearSchool()
                      : focusSchoolSearch(event.currentTarget)
                  }
                  aria-label={selectedSchool ? "Clear college" : undefined}
                >
                  {selectedSchool ? "×" : "Search school"}
                </button>
              </div>
            </div>
            {!isMobileSetup && filteredCollegeOptions.length === 0 && (
              <section className="np-inline-empty-state">
                <p>No schools match this search yet.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={() => {
                    setCollegeSearch("");
                    setSchoolHighlightIndex(0);
                  }}
                >
                  Clear school search
                </button>
              </section>
            )}
            {!isMobileSetup && filteredCollegeOptions.length > 0 && (
              <div className="np-college-list" role="listbox" id="np-school-results">
                {filteredCollegeOptions.map((opt, index) => {
                  const isSelected = selectedSchool?.key === opt.key;
                  const isHighlighted = schoolHighlightIndex === index;
                  return (
                    <button
                      key={opt.key}
                      id={`np-school-option-${opt.key}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      className={`np-college-row ${
                        isSelected ? "np-college-row-selected" : ""
                      } ${isHighlighted ? "np-option-highlighted" : ""}`}
                      onMouseEnter={() => setSchoolHighlightIndex(index)}
                      onClick={() => handleSelectSchool(opt)}
                    >
                      <span className="np-college-row-top">
                        <span className="np-college-name">{opt.name}</span>
                        {isSelected && <span className="np-selected-marker">Selected</span>}
                      </span>
                      <span className="np-meta-chip-row">
                        {opt.state && <span className="np-meta-chip">{opt.state}</span>}
                        {opt.rank != null && <span className="np-meta-chip">QS US #{opt.rank}</span>}
                        <span className="np-meta-chip">{`${opt.professorCount} profs`}</span>
                      </span>
                    </button>
                  );
                })}
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
                <span className="np-search-launcher-kicker">Command palette</span>
                <strong>
                  {selectedProfessor
                    ? `${selectedProfessor.professor_first} ${selectedProfessor.professor_last}`
                    : search.trim() || "Find a professor"}
                </strong>
                <small>
                  {selectedSchool
                    ? "Search by professor name, initials, or department."
                    : "Pick a school first to search its roster."}
                </small>
              </button>
            ) : (
              <input
                id="np-search"
                ref={professorInputRef}
                className="np-input"
                placeholder={
                  selectedSchool ? "Search name, initials, or department…" : "Choose a university first…"
                }
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setProfessorHighlightIndex(0);
                }}
                onKeyDown={handleProfessorInputKeyDown}
                disabled={!selectedSchool}
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
                      : selectedSchool
                        ? "Choose a professor to unlock Reality Check."
                        : "Select a school first to load professor options."}
                  </p>
                </div>
                {!selectedProfessor && (
                  <button
                    type="button"
                    className="np-selection-action"
                    onClick={(event) =>
                      selectedSchool
                        ? focusProfessorSearch(event.currentTarget)
                        : focusSchoolSearch(event.currentTarget)
                    }
                  >
                    {selectedSchool ? "Search professor" : "Choose school"}
                  </button>
                )}
              </div>
            </div>
            {!selectedSchool ? (
              <section className="np-inline-empty-state">
                <p>Choose a school to load its professor roster.</p>
                <button
                  type="button"
                  className="np-btn np-btn-secondary"
                  onClick={(event) => focusSchoolSearch(event.currentTarget)}
                >
                  Search school
                </button>
              </section>
            ) : filteredProfessors.length === 0 ? (
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
              <div
                className={`np-prof-list ${isMobileSetup ? "np-prof-list-hidden" : ""}`}
                role="listbox"
                id="np-professor-results"
              >
                {filteredProfessors.map((p, index) => (
                  <button
                    key={p.professor_id}
                    type="button"
                    id={`np-professor-option-${p.professor_id}`}
                    role="option"
                    aria-selected={professorHighlightIndex === index}
                    className={`np-prof ${p.professor_id === selectedId ? "np-prof-active" : ""} ${
                      professorHighlightIndex === index ? "np-option-highlighted" : ""
                    }`}
                    onMouseEnter={() => setProfessorHighlightIndex(index)}
                    onClick={() => handleSelectProfessor(p)}
                  >
                    <span>
                      {p.professor_first} {p.professor_last}
                      <small>{p.department}</small>
                    </span>
                    {p.avg_rating && <span className="np-prof-rating">{p.avg_rating}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="np-error">{error}</p>}
        </div>
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
                  ? "Search school, state, or alias…"
                  : "Search professor, initials, or department…"
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
                  {filteredCollegeOptions.map((opt, index) => {
                    const isSelected = selectedSchool?.key === opt.key;
                    const isHighlighted = schoolHighlightIndex === index;
                    return (
                      <button
                        key={opt.key}
                        id={`np-school-palette-option-${opt.key}`}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        className={`np-college-row ${
                          isSelected ? "np-college-row-selected" : ""
                        } ${isHighlighted ? "np-option-highlighted" : ""}`}
                        onMouseEnter={() => setSchoolHighlightIndex(index)}
                        onClick={() => handleSelectSchool(opt)}
                      >
                        <span className="np-college-row-top">
                          <span className="np-college-name">{opt.name}</span>
                          {isSelected && <span className="np-selected-marker">Selected</span>}
                        </span>
                        <span className="np-meta-chip-row">
                          {opt.state && <span className="np-meta-chip">{opt.state}</span>}
                          {opt.rank != null && <span className="np-meta-chip">QS US #{opt.rank}</span>}
                          <span className="np-meta-chip">{`${opt.professorCount} profs`}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            ) : !selectedSchool ? (
              <section className="np-inline-empty-state">
                <p>Choose a school first to load professor results.</p>
              </section>
            ) : paletteResults.length === 0 ? (
              <section className="np-inline-empty-state">
                <p>No professors match this search yet.</p>
              </section>
            ) : (
              <div className="np-search-palette-results" role="listbox" id="np-professor-palette-results">
                {filteredProfessors.map((professor, index) => (
                  <button
                    key={professor.professor_id}
                    id={`np-professor-palette-option-${professor.professor_id}`}
                    type="button"
                    role="option"
                    aria-selected={professorHighlightIndex === index}
                    className={`np-prof ${
                      professor.professor_id === selectedId ? "np-prof-active" : ""
                    } ${professorHighlightIndex === index ? "np-option-highlighted" : ""}`}
                    onMouseEnter={() => setProfessorHighlightIndex(index)}
                    onClick={() => handleSelectProfessor(professor)}
                  >
                    <span>
                      {professor.professor_first} {professor.professor_last}
                      <small>{professor.department}</small>
                    </span>
                    {professor.avg_rating && (
                      <span className="np-prof-rating">{professor.avg_rating}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="np-error">{error}</p>}
        </div>
      )}

      <div className="np-main" ref={mainTopRef}>
        <header className="np-topbar">
          <div className="np-stage-intro">
            <div className="np-stage-kicker">Stage {activeMode.step}</div>
            <h1 className="np-stage-title">{activeMode.label}</h1>
            <p className="np-stage-copy">{activeMode.description}</p>
          </div>
          {headerContext && (
            <div className="np-header-context">
              <div className="np-header-context-main">
                <span className="np-label">Selected context</span>
                <h2 className="np-header-professor">{headerContext.name}</h2>
                <p className="np-header-context-copy">
                  {headerContext.department} · {headerContext.school} · {headerContext.course}
                </p>
              </div>
              <div className="np-header-context-stats">
                {headerContext.rating && (
                  <span className="np-header-stat">Rating {headerContext.rating}</span>
                )}
                {headerContext.difficulty && (
                  <span className="np-header-stat">Difficulty {headerContext.difficulty}</span>
                )}
              </div>
            </div>
          )}
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
                        {step.state === "completed" ? "✓ completed" : step.state}
                      </span>
                    </div>
                    <strong className="np-step-title">{step.label}</strong>
                    <span className="np-step-status">{step.status}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <p className="np-next-action">{nextAction}</p>
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
              <StateCard
                title={heroState.title}
                copy={heroState.copy}
                ctaLabel={heroState.ctaLabel}
                onCta={heroState.action}
                tone="hero"
              />
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
