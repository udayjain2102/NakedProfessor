import { useMemo } from "react";
import { parseSyllabus } from "../lib/syllabusParser";
import { effortToGradeBand } from "../lib/survivalIntel";

const PROMPTS = [
  "Paste grading breakdown (e.g. Midterm 30%, Final 40%, HW 30%)…",
  "Add exam dates and assignment rhythm if listed…",
  "Mention late policy / participation — strictness affects strategy…",
];

function buildWeeklyPlan(profile, grading) {
  const w = profile.workload === "high" ? "9–11" : profile.workload === "low" ? "5–7" : "7–9";
  const examHeavy = (grading.examTotal || 0) >= 50;
  const verdict = examHeavy
    ? "Do NOT read the full textbook — prioritize lecture artifacts + timed practice."
    : "Do NOT skip weekly assignments — they compound; add exam reps before each test.";

  const ignore = examHeavy
    ? ["Optional readings not tied to HW", "Forum discussions unless graded", "Extra credit unless you’re borderline"]
    : ["Long textbook chapters if HW pulls from elsewhere", "Non-required seminars", "Perfectionism on low-weight tasks"];
  const priority = examHeavy
    ? ["Past exams / exam-style problems", "In-class examples and slide derivations", "Homework error log (same mistakes repeat)"]
    : ["Weekly assignment mastery", "Recurring quiz formats", "Instructor-emphasized topics in lecture"];
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    week: n,
    focus:
      n <= 2
        ? "Map grading + build error log; meet expectations early."
        : n <= 5
          ? "Problem volume + timed sets; fix recurring mistakes."
          : "Exam windows — full-length mocks, sleep-protected schedule.",
    hours: w,
  }));

  return { verdict, ignore, priority, weeks, examHeavy };
}

export default function GamePlanScreen({
  professor,
  profile,
  syllabus,
  courseTitle,
  onSyllabusChange,
  onCourseTitleChange,
  materialsNote,
  onMaterialsNoteChange,
  onGenerate,
  onOpenExecution,
  loading,
  planText,
  intel,
  studyHours,
  onStudyHoursChange,
}) {
  const parsed = useMemo(() => parseSyllabus(syllabus || ""), [syllabus]);
  const strategy = useMemo(
    () =>
      professor && profile
        ? buildWeeklyPlan(profile, parsed.grading)
        : null,
    [professor, profile, parsed.grading]
  );

  const predicted = useMemo(() => {
    if (!professor || !profile) return "—";
    return effortToGradeBand(studyHours, profile, professor);
  }, [studyHours, professor, profile]);
  const keywordSlice = parsed.keywords.slice(0, 8);

  if (!professor || !intel) {
    return (
      <div className="np-empty">
        <h2 className="np-title">Game Plan</h2>
        <p>Pick a professor first — strategy is calibrated to their signal profile.</p>
      </div>
    );
  }

  return (
    <div className="np-screen">
      <header className="np-block-head">
        <div className="np-eyebrow">02 / Build the playbook</div>
        <h2 className="np-title">Game Plan</h2>
        <p className="np-lead">
          Paste the syllabus. We’ll detect grading structure and generate an opinionated playbook — not generic advice.
        </p>
      </header>

      <section className="np-setup-grid">
        <article className="np-panel np-panel-ink">
          <span className="np-eyebrow">Course frame</span>
          <label className="np-label" htmlFor="course-title">
            Course name
          </label>
          <input
            id="course-title"
            className="np-input"
            value={courseTitle}
            onChange={(e) => onCourseTitleChange(e.target.value)}
            placeholder="e.g. CHEM 201 — Organic I"
          />

          <label className="np-label" htmlFor="materials">
            Past exams / assignments
          </label>
          <textarea
            id="materials"
            className="np-textarea np-textarea-sm"
            value={materialsNote}
            onChange={(e) => onMaterialsNoteChange(e.target.value)}
            placeholder="e.g. Upload: 2019 midterm + rubric (future file support)"
            rows={4}
          />

          <div className="np-chip-row">
            {keywordSlice.length > 0 ? (
              keywordSlice.map((keyword) => (
                <span key={keyword} className="np-chip">
                  {keyword}
                </span>
              ))
            ) : (
              <span className="np-fineprint">
                Syllabus keywords will appear here once text is pasted.
              </span>
            )}
          </div>
        </article>

        <article className="np-panel">
          <span className="np-eyebrow">Syllabus intake</span>
          <p className="np-prompt-cycle">
            {PROMPTS[syllabus.length % PROMPTS.length]}
          </p>
          <textarea
            className="np-textarea"
            value={syllabus}
            onChange={(e) => onSyllabusChange(e.target.value)}
            placeholder={`Grading:\n- Midterm 30%\n- Final 40%\n- Homework 30%\n\nSchedule:\n- Midterm Oct 14\n- Final Dec 10`}
            rows={12}
          />
          <div
            className={`np-detect ${parsed.grading.confidence === "none" ? "np-detect-muted" : ""}`}
          >
            <strong>Detected</strong>
            <span>{parsed.grading.summary}</span>
          </div>
          <div className="np-action-row">
            <button
              type="button"
              className="np-btn np-btn-primary"
              disabled={loading || !syllabus.trim()}
              onClick={onGenerate}
            >
              {loading ? "Analyzing professor patterns…" : "Optimize my grade strategy"}
            </button>
            {planText && (
              <button
                type="button"
                className="np-btn np-btn-secondary"
                onClick={onOpenExecution}
              >
                Open Execution Hub
              </button>
            )}
          </div>
        </article>
      </section>

      <section className="np-panel np-simulator">
        <h3 className="np-section-title">Effort vs grade simulator</h3>
        <p className="np-lead">
          Modeled band if you hold <strong>{studyHours} hrs/week</strong> outside class.
        </p>
        <input
          type="range"
          min={3}
          max={15}
          value={studyHours}
          onChange={(e) => onStudyHoursChange(Number(e.target.value))}
          className="np-range"
        />
        <div className="np-sim-out">
          <span>Predicted outcome band</span>
          <strong>{predicted}</strong>
        </div>
        <p className="np-fineprint">
          Estimates combine effort hours with this professor’s difficulty/clarity profile — not a promise.
        </p>
      </section>

      {strategy && (
        <section className="np-panel np-strategy">
          <h3 className="np-section-title">Strategy generator</h3>
          <p className="np-verdict">{strategy.verdict}</p>
          <div className={`np-detect ${strategy.examHeavy ? "" : "np-detect-muted"}`}>
            <strong>Workload posture</strong>
            <span>
              {strategy.examHeavy
                ? "Exam-heavy course: build timed reps early and treat lecture artifacts as the source of truth."
                : "Assignment-heavy course: consistency beats last-minute compression."}
            </span>
          </div>
          <div className="np-two-col">
            <div>
              <span className="np-eyebrow">Priority topics</span>
              <ul>
                {strategy.priority.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <span className="np-eyebrow">What to ignore</span>
              <ul>
                {strategy.ignore.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <span className="np-eyebrow">Weekly cadence</span>
          <div className="np-week-grid">
            {strategy.weeks.map((w) => (
              <div key={w.week} className="np-week-card">
                <div>Week {w.week}</div>
                <div className="np-week-hours">{w.hours} hrs / wk target</div>
                <p>{w.focus}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {planText && (
        <section className="np-panel">
          <span className="np-eyebrow">Generated plan output</span>
          <pre className="np-pre">{planText}</pre>
        </section>
      )}
    </div>
  );
}
