import { useEffect, useMemo, useRef, useState } from "react";
import RealityCheckScreen from "./components/RealityCheckScreen";
import GamePlanScreen from "./components/GamePlanScreen";
import ExecutionHubScreen from "./components/ExecutionHubScreen";
import AdSlot from "./components/AdSlot";
import { deriveProfile } from "./lib/profileDeriver";
import { getFullIntel } from "./lib/survivalIntel";
import { loadWorkspace, saveWorkspace } from "./lib/workspaceStore";
import { getAuthRedirectUrl, supabase } from "./lib/supabaseClient";
import brandLogo from "./assets/nakedprofessor-logo.png";

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] ? values[index].trim() : "";
      return obj;
    }, {});
  });
}

function filterProfessors(professors, query) {
  const q = query.toLowerCase().trim();
  if (!q) return professors.slice(0, 14);
  return professors
    .filter((p) =>
      `${p.professor_first} ${p.professor_last} ${p.department}`
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 14);
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

/** Merge CSV schools with national rankings list for search. */
function buildSchoolOptions(professors, topColleges) {
  const map = new Map();
  for (const p of professors) {
    const n = (p.school_name || "").trim();
    if (!n) continue;
    const key = schoolKey(n);
    if (!map.has(key)) {
      map.set(key, { key, name: n, inDataset: true, professorCount: 0 });
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
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function filterSchoolOptions(options, query, limit = 18) {
  const s = query.toLowerCase().trim();
  if (!s) return options.slice(0, limit);
  return options
    .filter(
      (o) =>
        o.name.toLowerCase().includes(s) ||
        (o.state && String(o.state).toLowerCase().includes(s))
    )
    .slice(0, limit);
}

const LOADING_LINES = [
  "Analyzing professor patterns…",
  "Cross-checking workload signals…",
  "Calibrating grade scenarios…",
];

const MODES = [
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

export default function App() {
  const [professors, setProfessors] = useState([]);
  const [topColleges, setTopColleges] = useState([]);
  const [collegeSearch, setCollegeSearch] = useState("");
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [materialsNote, setMaterialsNote] = useState("");
  const [planText, setPlanText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("reality");
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
  const hasProfessor = Boolean(selectedId);
  const hasSyllabus = Boolean(syllabus.trim());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let csvRes = await fetch("/data/top200_plus_behrend_professors.csv");
        if (!csvRes.ok) {
          csvRes = await fetch("/data/behrend_professors.csv");
        }
        const text = await csvRes.text();
        if (cancelled) return;
        const parsed = parseCSV(text);
        setProfessors(parsed);

        try {
          const colRes = await fetch("/data/top_colleges.json");
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
  }, []);

  useEffect(() => {
    if (!authUser) {
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
      setPlanText("");
      setPlanReady(false);
      setMode("reality");
      return;
    }

    const nextAccountName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split("@")[0] ||
      "Student";
    const workspace = loadWorkspace(authUser.id);
    setAccountName(nextAccountName);
    setSavedSubjects(Array.isArray(workspace.subjects) ? workspace.subjects : []);
    setActiveSubjectId(null);
    setSubjectName("");
    setAuthNotice("");
    setWorkspaceLoaded(true);
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !workspaceLoaded) return;
    saveWorkspace(
      {
        accountName,
        subjects: savedSubjects,
      },
      authUser.id
    );
  }, [accountName, authUser, savedSubjects, workspaceLoaded]);

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
  const currentModeIndex = useMemo(() => {
    const idx = MODES.findIndex((item) => item.id === mode);
    return idx === -1 ? 0 : idx;
  }, [mode]);
  const activeMode = MODES[currentModeIndex] || MODES[0];
  const unlockedModes = useMemo(
    () => ({
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
        if (item.id === "reality") {
          status = hasProfessor
            ? `Risk readout live for ${selectedProfessor.professor_first} ${selectedProfessor.professor_last}.`
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
          item.id === "reality"
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
    [hasProfessor, hasSyllabus, mode, planReady, selectedProfessor, unlockedModes]
  );
  const nextAction = useMemo(() => {
    if (!selectedSchool) return "Next: choose a university to begin";
    if (!hasProfessor) return "Next: choose a professor from your university";
    if (mode === "reality") return "Next: add your syllabus to generate a plan";
    if (!hasSyllabus) return "Next: add your syllabus to generate a plan";
    if (!planReady) return "Next: generate your weekly strategy";
    return "Next: start tracking execution";
  }, [hasProfessor, hasSyllabus, mode, planReady, selectedSchool]);
  const heroState = useMemo(() => {
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
  }, [hasProfessor, professorPool.length, selectedSchool]);
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

  function handleSelectSchool(option) {
    setSelectedSchool(option);
    setCollegeSearch("");
    setSelectedId(null);
    setSearch("");
  }

  function handleClearSchool() {
    setSelectedSchool(null);
    setCollegeSearch("");
    setSelectedId(null);
    setSearch("");
  }

  function focusSchoolSearch() {
    scrollToSetup(true);
    requestAnimationFrame(() => {
      document.getElementById("np-college-search")?.focus();
    });
  }

  function focusProfessorSearch() {
    if (!selectedSchool) {
      focusSchoolSearch();
      return;
    }
    scrollToSetup(true);
    requestAnimationFrame(() => {
      document.getElementById("np-search")?.focus();
    });
  }

  async function handleEduSignIn() {
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
    setPlanText("");
    setPlanReady(false);
    setMode("reality");
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
    setPlanText(subject.planText || "");
    setPlanReady(Boolean(subject.planReady));
    setStudyHours(subject.studyHours || 9);
    setCollegeSearch("");
    setSearch("");
    setSelectedSchool(nextSchool);
    setSelectedId(professorId || subject.activeProfessorId || null);
    setMode(subject.planReady ? "execution" : subject.syllabus?.trim() ? "gameplan" : "reality");
    setIsSetupOpen(false);
    setError("");
  }

  function handleSaveProfessorToSubject() {
    if (!authUser) {
      setError("Sign in before saving subjects.");
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
            planText,
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
          planText,
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
    setLoading(true);

    await new Promise((r) => setTimeout(r, 1100));

    const profName = selectedProfessor.professor_first;
    const dept = selectedProfessor.department;
    const g = intel?.profile?.workload || "medium";

    const body = `## Survival plan — ${profName} (${dept})

### Verdict
Treat this as a **${g} workload** class. Your strategy is tuned to clarity/workload signals — not generic study tips.

### Weekly
- **Mon–Tue**: Active recall on lecture artifacts (not passive re-reads).
- **Wed**: Problem sets + error log (same mistake twice = stop and fix root cause).
- **Thu–Sun**: Timed segment + review mistakes under test conditions.

### Before each exam
Two full-length mocks, sleep-protected. If past exams exist, match format exactly.

### What to ignore
Low-yield extras unless syllabus weights them. Protect deep-work blocks weekly — no negotiation.

---
Generated locally (demo). Connect API for richer synthesis.`;

    setPlanText(body);
    setPlanReady(true);
    setLoading(false);
    setMode("execution");
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
    if (!authUser || !activeSubjectId) return;

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
          planText,
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
    courseTitle,
    materialsNote,
    planReady,
    planText,
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
              <span className="np-eyebrow">Sign In</span>
            </div>
            {!authUser ? (
              <>
                <p className="np-fineprint">
                  Use your `.edu` email. Saved subjects and professors will be tied to your signed-in account on this device.
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
            ) : (
              <div className="np-workspace-actions">
                <button type="button" className="np-btn np-btn-ghost" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
            <div className={`np-selection-card ${accountName ? "np-selection-card-active" : ""}`}>
              <div>
                <strong>{accountName || "No account yet"}</strong>
                <p className="np-fineprint">
                  {accountName
                    ? `${savedSubjects.length} ${
                        savedSubjects.length === 1 ? "subject" : "subjects"
                      } saved on this device.`
                    : "Sign in to save subjects and compare professors."}
                </p>
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
              disabled={!authUser}
            />
            <div className="np-workspace-actions">
              <button
                type="button"
                className={`np-btn np-btn-secondary ${highlightedAction === "workspace" ? "np-btn-highlight" : ""}`}
                onClick={handleSaveProfessorToSubject}
                disabled={!authUser || !selectedSchool || !selectedProfessor}
              >
                Save professor to subject
              </button>
            </div>
            <div className="np-subject-list">
              {savedSubjects.length === 0 ? (
                <div className="np-inline-empty-state">
                  <p>Saved subjects will appear here after you sign in and save a professor.</p>
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
            <input
              id="np-college-search"
              className="np-input"
              placeholder="Search school or state…"
              value={collegeSearch}
              onChange={(e) => setCollegeSearch(e.target.value)}
              autoComplete="off"
            />
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
                  onClick={selectedSchool ? handleClearSchool : focusSchoolSearch}
                  aria-label={selectedSchool ? "Clear college" : undefined}
                >
                  {selectedSchool ? "×" : "Search school"}
                </button>
              </div>
            </div>
            <div className="np-college-list">
              {filteredCollegeOptions.map((opt) => {
                const isSelected = selectedSchool?.key === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`np-college-row ${isSelected ? "np-college-row-selected" : ""}`}
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
            <label className="np-label" htmlFor="np-search">
              Search professor
            </label>
            <input
              id="np-search"
              className="np-input"
              placeholder={
                selectedSchool ? "Search name or department…" : "Choose a university first…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!selectedSchool}
            />
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
                    onClick={selectedSchool ? focusProfessorSearch : focusSchoolSearch}
                  >
                    {selectedSchool ? "Search professor" : "Choose school"}
                  </button>
                )}
              </div>
            </div>
            {!selectedSchool ? (
              <section className="np-inline-empty-state">
                <p>Choose a school to load its professor roster.</p>
                <button type="button" className="np-btn np-btn-secondary" onClick={focusSchoolSearch}>
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
              <div className="np-prof-list">
                {filteredProfessors.map((p) => (
                  <button
                    key={p.professor_id}
                    type="button"
                    className={`np-prof ${p.professor_id === selectedId ? "np-prof-active" : ""}`}
                    onClick={() => {
                      setSelectedId(p.professor_id);
                      setIsSetupOpen(false);
                    }}
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
          {mode === "reality" && !hasProfessor && heroState && (
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
              planText={planText}
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
