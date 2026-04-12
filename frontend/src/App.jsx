import { useEffect, useMemo, useState } from "react";
import RealityCheckScreen from "./components/RealityCheckScreen";
import GamePlanScreen from "./components/GamePlanScreen";
import ExecutionHubScreen from "./components/ExecutionHubScreen";
import { deriveProfile } from "./lib/profileDeriver";
import { getFullIntel } from "./lib/survivalIntel";

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

/** Merge CSV schools with national rankings list for search. */
function buildSchoolOptions(professors, topColleges) {
  const map = new Map();
  for (const p of professors) {
    const n = (p.school_name || "").trim();
    if (!n) continue;
    if (!map.has(n)) {
      map.set(n, { name: n, inDataset: true, professorCount: 0 });
    }
    map.get(n).professorCount += 1;
  }
  if (Array.isArray(topColleges)) {
    for (const c of topColleges) {
      const n = c.name;
      if (!n) continue;
      if (map.has(n)) {
        const e = map.get(n);
        e.state = c.state;
        e.rank = c.rank;
      } else {
        map.set(n, {
          name: n,
          state: c.state,
          rank: c.rank,
          inDataset: false,
          professorCount: 0,
        });
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
  { id: "reality", label: "Reality Check", step: "01" },
  { id: "gameplan", label: "Game Plan", step: "02" },
  { id: "execution", label: "Execution Hub", step: "03" },
];

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
  const [planReady, setPlanReady] = useState(false);
  const [insightVisible, setInsightVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const csvRes = await fetch("/data/behrend_professors.csv");
        const text = await csvRes.text();
        if (cancelled) return;
        const parsed = parseCSV(text);
        setProfessors(parsed);
        if (parsed.length > 0) setSelectedId(parsed[0].professor_id);

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
    if (!selectedSchool) return professors;
    if (selectedSchool.inDataset === false) return [];
    return professors.filter((p) => p.school_name === selectedSchool.name);
  }, [professors, selectedSchool]);

  const filteredProfessors = useMemo(
    () => filterProfessors(professorPool, search),
    [professorPool, search]
  );

  function handleSelectSchool(option) {
    setSelectedSchool(option);
    setCollegeSearch("");
    const pool =
      option.inDataset === false
        ? []
        : professors.filter((p) => p.school_name === option.name);
    if (pool.length) setSelectedId(pool[0].professor_id);
    else setSelectedId(null);
  }

  function handleClearSchool() {
    setSelectedSchool(null);
    setCollegeSearch("");
    if (professors.length) setSelectedId(professors[0].professor_id);
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
Treat this as a **${g} workload** class. Your playbook is tuned to clarity/workload signals — not generic study tips.

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

  function goMode(next) {
    setInsightVisible(false);
    setMode(next);
    requestAnimationFrame(() => {
      setInsightVisible(true);
    });
  }

  return (
    <div className="np-app">
      <aside className="np-sidebar">
        <div className="np-brand">
          <div className="np-brand-mark">NP</div>
          <div>
            <div className="np-brand-name">NakedProfessor</div>
            <div className="np-brand-tag">Class survival system</div>
          </div>
        </div>

        <label className="np-label" htmlFor="np-college-search">
          College
        </label>
        <input
          id="np-college-search"
          className="np-input"
          placeholder="Search college or state…"
          value={collegeSearch}
          onChange={(e) => setCollegeSearch(e.target.value)}
          autoComplete="off"
        />
        {selectedSchool && (
          <div className="np-school-picked">
            <span className="np-school-picked-name">{selectedSchool.name}</span>
            {!selectedSchool.inDataset && (
              <span className="np-school-badge">No roster in dataset</span>
            )}
            <button
              type="button"
              className="np-school-clear"
              onClick={handleClearSchool}
              aria-label="Clear college"
            >
              ×
            </button>
          </div>
        )}
        <div className="np-college-list">
          {!selectedSchool &&
            filteredCollegeOptions.map((opt) => (
              <button
                key={opt.name}
                type="button"
                className="np-college-row"
                onClick={() => handleSelectSchool(opt)}
              >
                <span className="np-college-name">{opt.name}</span>
                <span className="np-college-meta">
                  {opt.state ? `${opt.state}` : ""}
                  {opt.rank != null ? ` · #${opt.rank}` : ""}
                  {opt.inDataset && opt.professorCount > 0
                    ? ` · ${opt.professorCount} profs`
                    : ""}
                </span>
              </button>
            ))}
        </div>

        <label className="np-label" htmlFor="np-search">
          Professor
        </label>
        <input
          id="np-search"
          className="np-input"
          placeholder="Search name or department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {selectedSchool?.inDataset === false && (
          <p className="np-school-hint">
            This college isn’t in the loaded professor roster — pick a school with professors or clear to browse all.
          </p>
        )}

        <div className="np-prof-list">
          {filteredProfessors.map((p) => (
            <button
              key={p.professor_id}
              type="button"
              className={`np-prof ${p.professor_id === selectedId ? "np-prof-active" : ""}`}
              onClick={() => setSelectedId(p.professor_id)}
            >
              <span>
                {p.professor_first} {p.professor_last}
                <small>{p.department}</small>
              </span>
              {p.avg_rating && <span className="np-prof-rating">{p.avg_rating}</span>}
            </button>
          ))}
        </div>

        {selectedProfessor && (
          <div className="np-side-card">
            <div className="np-eyebrow">Locked context</div>
            <strong>
              {selectedProfessor.professor_first} {selectedProfessor.professor_last}
            </strong>
            <p className="np-fineprint">
              {selectedProfessor.school_name && (
                <>
                  {selectedProfessor.school_name}
                  <br />
                </>
              )}
              {selectedProfessor.department}
              {selectedProfessor.avg_rating &&
                ` · ${selectedProfessor.avg_rating} avg · diff ${selectedProfessor.avg_difficulty}`}
            </p>
          </div>
        )}

        {error && <p className="np-error">{error}</p>}
      </aside>

      <div className="np-main">
        <header className="np-topbar">
          <div className="np-mode-rail" role="tablist" aria-label="Modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`np-mode-btn ${mode === m.id ? "np-mode-active" : ""}`}
                onClick={() => goMode(m.id)}
              >
                <span className="np-mode-step">{m.step}</span>
                {m.label}
              </button>
            ))}
          </div>
          <div className="np-topbar-actions">
            <button
              type="button"
              className="np-btn np-btn-ghost"
              onClick={() => goMode("reality")}
            >
              Analyze professor risk
            </button>
            <button
              type="button"
              className="np-btn np-btn-secondary"
              onClick={() => goMode("gameplan")}
            >
              Build game plan
            </button>
          </div>
        </header>

        {loading && (
          <div className="np-loading" role="status">
            <div className="np-loading-pulse" />
            <p>{LOADING_LINES[loadingIdx]}</p>
          </div>
        )}

        <div className={`np-content ${insightVisible ? "np-content-in" : ""}`}>
          {mode === "reality" && (
            <RealityCheckScreen
              professor={selectedProfessor}
              courseTitle={courseTitle}
              intel={intel}
              onGeneratePlan={() => goMode("gameplan")}
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
              loading={loading}
              planText={planText}
              intel={intel}
              studyHours={studyHours}
              onStudyHoursChange={setStudyHours}
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
