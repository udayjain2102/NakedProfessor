import { useId } from "react";

function InsightModule({ metric, index }) {
  return (
    <article
      className="np-insight np-stagger-item"
      style={{ animationDelay: `${80 + index * 70}ms` }}
    >
      <div className="np-insight-head">
        <span className="np-eyebrow">{metric.label}</span>
        <span className="np-insight-rank">{metric.percentileLabel}</span>
      </div>
      <p className="np-insight-lead">{metric.interpretation}</p>
      <div className="np-bar-track" aria-hidden>
        <div
          className="np-bar-fill"
          style={{ width: `${metric.barPct}%` }}
        />
      </div>
      <p className="np-insight-meta">{metric.benchmark}</p>
      <div className="np-insight-body">
        <p>
          <strong>Implication.</strong> {metric.implication}
        </p>
        <p>
          <strong>Do this.</strong> {metric.action}
        </p>
      </div>
    </article>
  );
}

function SurvivalGauge({ survival }) {
  const gradId = useId();
  const mid = survival.mid;

  return (
    <div className="np-gauge-block np-stagger-item" style={{ animationDelay: "40ms" }}>
      <div className="np-gauge-label">Survival probability (aim: A)</div>
      <div className="np-gauge-row">
        <svg className="np-gauge-svg" viewBox="0 0 120 72" aria-hidden>
          <path
            d="M 12 60 A 48 48 0 0 1 108 60"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M 12 60 A 48 48 0 0 1 108 60"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(mid / 100) * 151} 151`}
          />
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7C5CFF" />
              <stop offset="100%" stopColor="#22C55E" />
            </linearGradient>
          </defs>
        </svg>
        <div className="np-gauge-value">
          <span className="np-gauge-pct">{mid}%</span>
          <span className="np-gauge-range">
            {survival.low}%–{survival.high}% band
          </span>
        </div>
      </div>
      <p className="np-gauge-note">{survival.confidenceNote}</p>
    </div>
  );
}

export default function RealityCheckScreen({
  professor,
  courseTitle,
  intel,
  onGeneratePlan,
}) {
  if (!intel || !professor) {
    return (
      <div className="np-empty">
        <h2 className="np-title">Reality Check</h2>
        <p>Select a professor in the sidebar to see survival intelligence.</p>
      </div>
    );
  }

  const { risk, tldr, survival, metrics, failureStack, scenarios, predictions } =
    intel;

  return (
    <div className="np-screen np-screen-reality">
      <header className="np-hero np-stagger-item" style={{ animationDelay: "0ms" }}>
        <div className="np-hero-kicker">Professor snapshot</div>
        <h1 className="np-hero-title">
          {professor.professor_first} {professor.professor_last}
        </h1>
        <p className="np-hero-course">
          {courseTitle?.trim() || "Course title (set in Game Plan)"}
        </p>
        <p className="np-hero-tldr">{tldr}</p>
        <div className="np-risk-row">
          <span
            className={`np-risk-badge np-risk-${risk.level.toLowerCase()}`}
          >
            {risk.level} risk
          </span>
          <p className="np-risk-copy">{risk.explanation}</p>
        </div>
      </header>

      <SurvivalGauge survival={survival} />

      <section className="np-section">
        <h2 className="np-section-title">Signal intelligence</h2>
        <p className="np-section-sub">
          Benchmarked signals — not vibes. Each row is a decision, not a label.
        </p>
        <div className="np-insight-list">
          {metrics.map((m, i) => (
            <InsightModule key={m.key} metric={m} index={i} />
          ))}
        </div>
      </section>

      <section className="np-section">
        <h2 className="np-section-title">Failure stack</h2>
        <p className="np-section-sub">
          Top ways students lose points — frequency is modeled from signal mix.
        </p>
        <div className="np-failure-table">
          <div className="np-failure-head">
            <span>Reason</span>
            <span>Modeled share</span>
            <span>Prevention</span>
          </div>
          {failureStack.map((row, idx) => (
            <div key={`${row.reason}-${idx}`} className="np-failure-row">
              <span>{row.reason}</span>
              <span>
                <span className="np-failure-pct">{row.pct}%</span>
                <span className="np-micro-bar">
                  <i style={{ width: `${row.pct}%` }} />
                </span>
              </span>
              <span className="np-failure-tip">{row.tip}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="np-section np-predict">
        <h2 className="np-section-title">Professor behavior predictions</h2>
        <ul className="np-predict-list">
          {predictions.map((p, i) => (
            <li key={i} className="np-predict-item">
              <p>{p.text}</p>
              <div className="np-predict-meta">
                <span>Confidence: {p.confidence}</span>
                <span>If wrong: {p.ifWrong}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="np-section np-decision">
        <h2 className="np-section-title">If you take this class, what happens?</h2>
        <div className="np-scenario-grid">
          <div className="np-scenario">
            <div className="np-eyebrow">{scenarios.consistent.label}</div>
            <div className="np-scenario-grade">{scenarios.consistent.grades}</div>
            <p>{scenarios.consistent.condition}</p>
          </div>
          <div className="np-scenario">
            <div className="np-eyebrow">{scenarios.average.label}</div>
            <div className="np-scenario-grade">{scenarios.average.grades}</div>
            <p>{scenarios.average.condition}</p>
          </div>
          <div className="np-scenario np-scenario-warn">
            <div className="np-eyebrow">{scenarios.low.label}</div>
            <div className="np-scenario-grade">{scenarios.low.grades}</div>
            <p>{scenarios.low.condition}</p>
          </div>
        </div>
      </section>

      <div className="np-cta-bar">
        <button type="button" className="np-btn np-btn-primary" onClick={onGeneratePlan}>
          Generate survival plan
        </button>
        <button type="button" className="np-btn np-btn-ghost" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          Analyze professor risk (scroll up)
        </button>
      </div>
    </div>
  );
}
