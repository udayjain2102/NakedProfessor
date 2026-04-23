import { useMemo, useState } from "react";
import { alignmentPercent } from "../lib/survivalIntel";

function safeScrollIntoView(node, options) {
  if (node && typeof node.scrollIntoView === "function") {
    node.scrollIntoView(options);
  }
}

function buildTimeline(syllabusText) {
  const lines = (syllabusText || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const hits = [];
  for (const line of lines) {
    const m = line.match(/(midterm|final|exam|quiz|assignment|due|project)/i);
    if (m) hits.push(line);
  }
  if (hits.length === 0) {
    return [
      { id: 1, label: "Weeks 1–2", detail: "Syllabus + expectations lock-in", risk: "low" },
      { id: 2, label: "Weeks 3–5", detail: "First heavy problem sets / quiz window", risk: "medium" },
      { id: 3, label: "Midterm corridor", detail: "High risk zone — full-length practice", risk: "high" },
      { id: 4, label: "Weeks 8–12", detail: "Compound topics — fix recurring errors", risk: "medium" },
      { id: 5, label: "Final sprint", detail: "Sleep-protected review; mock exams", risk: "high" },
    ];
  }
  return hits.slice(0, 6).map((h, i) => ({
    id: i + 1,
    label: `From syllabus`,
    detail: h,
    risk: /final|midterm|exam/i.test(h) ? "high" : "medium",
  }));
}

export default function ExecutionHubScreen({
  professor,
  profile,
  syllabus,
  studyHours,
  onStudyHoursChange,
  planReady,
  onOpenGamePlan,
  highlightPrimaryCta,
}) {
  const [notes, setNotes] = useState([
    { id: 1, topic: "Error log", body: "Track missed steps — same failure twice = priority topic." },
  ]);
  const [draftTopic, setDraftTopic] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const alignment = useMemo(
    () => (profile ? alignmentPercent(studyHours, profile) : 0),
    [studyHours, profile]
  );

  const timeline = useMemo(() => buildTimeline(syllabus), [syllabus]);

  const alerts = useMemo(() => {
    const a = [];
    if (/midterm/i.test(syllabus || "")) {
      a.push({
        type: "warn",
        text: "Midterm mentioned in syllabus — treat the prior week as a high risk zone.",
      });
    }
    a.push({
      type: "warn",
      text: "If you stay below 70% alignment for two weeks, rerun Game Plan with updated dates.",
    });
    if (profile?.workload === "high") {
      a.push({
        type: "danger",
        text: "Heavy workload signal — block time before new topics stack.",
      });
    }
    return a;
  }, [syllabus, profile]);

  function addNote(e) {
    e.preventDefault();
    if (!draftBody.trim()) return;
    setNotes((prev) => [
      ...prev,
      {
        id: Date.now(),
        topic: draftTopic.trim() || "Topic",
        body: draftBody.trim(),
      },
    ]);
    setDraftBody("");
    setDraftTopic("");
  }

  if (!professor) {
    return (
      <div className="np-empty">
        <h2 className="np-title">Execution Hub</h2>
        <p>Select a professor to activate tracking.</p>
      </div>
    );
  }

  return (
    <div className="np-screen">
      <header className="np-block-head">
        <div className="np-eyebrow">03 / Execution Hub</div>
        <h2 className="np-title">Execution Hub</h2>
        <p className="np-lead">
          Track how closely your week matches the plan and where you need to adjust.
        </p>
        <div className="np-intake-ruler" aria-label="Execution workflow">
          <span>01 alignment</span>
          <span>02 alert zones</span>
          <span>03 linked notes</span>
        </div>
        <div className={`np-detect ${planReady ? "" : "np-detect-muted"}`}>
          <strong>Status</strong>
          <span>
            {planReady
              ? "Plan is generated. Use this screen as the live tracking workspace for the class."
              : "You can track effort here now, but the recommendations improve after Game Plan is generated."}
          </span>
        </div>
        {!planReady ? (
          <section className="np-state-card np-state-card-inline">
            <div className="np-state-copy">
              <h3 className="np-state-title">Generate your plan first</h3>
              <p>Execution Hub becomes useful after Game Plan creates the weekly strategy.</p>
            </div>
            <button type="button" className="np-btn np-btn-primary" onClick={onOpenGamePlan}>
              Generate Strategy
            </button>
          </section>
        ) : (
          <button
            type="button"
            id="np-start-tracking"
            className={`np-btn np-btn-primary ${highlightPrimaryCta ? "np-btn-highlight" : ""}`}
            onClick={() => {
              const notesPanel = document.getElementById("np-notes-panel");
              safeScrollIntoView(notesPanel, {
                behavior: "smooth",
                block: "start",
              });
            }}
          >
            Start Tracking
          </button>
        )}
      </header>

      <section className="np-panel np-progress-panel">
        <div className="np-progress-top">
          <div>
            <span className="np-eyebrow">Plan alignment</span>
            <div className="np-align-value">{alignment}%</div>
            <p className="np-fineprint">
              {planReady
                ? "Compared to recommended weekly hours for this professor’s workload signal."
                : "Generate a plan in Game Plan to tighten this score."}
            </p>
          </div>
          <div className="np-align-slider">
            <label htmlFor="exec-hours">Your study hours / week</label>
            <input
              id="exec-hours"
              type="range"
              min={3}
              max={15}
              value={studyHours}
              onChange={(e) => onStudyHoursChange(Number(e.target.value))}
              className="np-range"
            />
          </div>
        </div>
        <div className="np-align-bar">
          <i style={{ width: `${alignment}%` }} />
        </div>
      </section>

      <div className="np-dual-grid">
        <section className="np-panel">
          <h3 className="np-section-title">Alerts</h3>
          <ul className="np-alert-list">
            {alerts.map((x, i) => (
              <li key={i} className={`np-alert np-alert-${x.type}`}>
                {x.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="np-panel">
          <h3 className="np-section-title">Weekly timeline</h3>
          <p className="np-section-sub">
            Assignments + exams inferred from syllabus text (demo heuristics).
          </p>
          <div className="np-timeline">
            {timeline.map((t) => (
              <div key={t.id} className={`np-tl-item np-tl-${t.risk}`}>
                <div className="np-tl-dot" />
                <div>
                  <div className="np-tl-label">{t.label}</div>
                  <div className="np-tl-detail">{t.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="np-panel np-notes" id="np-notes-panel">
        <h3 className="np-section-title">Tracking notes</h3>
        <form className="np-note-form" onSubmit={addNote}>
          <input
            className="np-input"
            placeholder="Topic tag (e.g. Acid-base)"
            value={draftTopic}
            onChange={(e) => setDraftTopic(e.target.value)}
          />
          <textarea
            className="np-textarea"
            placeholder="Capture misconception, exam trap, or rubric detail…"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={3}
          />
          <button type="submit" className="np-btn np-btn-secondary">
            Link note to topic
          </button>
        </form>
        <ul className="np-note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="np-note-topic">{n.topic}</span>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
