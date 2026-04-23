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

function PriorityCard({ metric, index }) {
  return (
    <article
      className="np-priority-card np-stagger-item"
      style={{ animationDelay: `${50 + index * 80}ms` }}
    >
      <span className="np-eyebrow">{metric.label}</span>
      <strong className="np-priority-value">{metric.percentileLabel}</strong>
      <p>{metric.action}</p>
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
            stroke="rgba(0,0,0,0.1)"
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
              <stop offset="0%" stopColor="#7A947A" />
              <stop offset="100%" stopColor="#0a0a0a" />
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
  highlightPrimaryCta,
}) {
  if (!intel || !professor) {
    return (
      <div className="np-empty">
        <h2 className="np-title">Reality Check</h2>
        <p>Select a professor in Setup to see the risk readout.</p>
      </div>
    );
  }

  const { risk, tldr, survival, metrics, failureStack, scenarios, predictions } =
    intel;
  const leadSignals = metrics.slice(0, 3);

  return (
    <div className="np-screen np-screen-reality">
      <header className="np-poster-hero np-stagger-item" style={{ animationDelay: "0ms" }}>
        <div className="np-poster-main">
          <div className="np-hero-kicker">01 / Reality Check</div>
          <h1 className="np-hero-title">
            {professor.professor_first} {professor.professor_last}
          </h1>
          <p className="np-hero-course">
            {courseTitle?.trim() || "Set course name in Game Plan"}
          </p>
          <dl className="np-hero-data-rail" aria-label="Professor dossier metrics">
            <div>
              <dt>Dept</dt>
              <dd>{professor.department || "Pending"}</dd>
            </div>
            <div>
              <dt>Rating</dt>
              <dd>{professor.avg_rating || "n/a"}</dd>
            </div>
            <div>
              <dt>Difficulty</dt>
              <dd>{professor.avg_difficulty || "n/a"}</dd>
            </div>
            <div>
              <dt>Reports</dt>
              <dd>{professor.num_ratings || "n/a"}</dd>
            </div>
          </dl>
          <p className="np-hero-tldr">{tldr}</p>
          <div className="np-risk-row">
            <span
              className={`np-risk-badge np-risk-${risk.level.toLowerCase()}`}
            >
              {risk.level} risk
            </span>
            <p className="np-risk-copy">{risk.explanation}</p>
          </div>
        </div>

        <div className="np-side-stack">
          <SurvivalGauge survival={survival} />
          <article className="np-priority-card">
            <span className="np-eyebrow">Immediate move</span>
            <strong className="np-priority-value">
              {risk.level === "High"
                ? "Front-load effort"
                : risk.level === "Medium"
                  ? "Stay ahead weekly"
                  : "Keep consistency"}
            </strong>
            <p>{leadSignals[0]?.action}</p>
          </article>
        </div>
      </header>

      <section className="np-section">
        <h2 className="np-section-title">Start here</h2>
        <p className="np-section-sub">
          These three signals define the class fastest and should shape your first two weeks.
        </p>
        <div className="np-priority-grid">
          {leadSignals.map((metric, index) => (
            <PriorityCard key={metric.key} metric={metric} index={index} />
          ))}
        </div>
      </section>

      <section className="np-section">
        <h2 className="np-section-title">Professor signals</h2>
        <p className="np-section-sub">
          Benchmarked signals that explain workload, clarity, and grading pressure.
        </p>
        <div className="np-insight-list">
          {metrics.map((m, i) => (
            <InsightModule key={m.key} metric={m} index={i} />
          ))}
        </div>
      </section>

      <section className="np-section">
        <h2 className="np-section-title">Common risks</h2>
        <p className="np-section-sub">
          Most common ways students lose points, modeled from the professor signal mix.
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

      <div className="np-dual-grid">
        <section className="np-section np-panel np-predict">
          <h2 className="np-section-title">Likely professor patterns</h2>
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

        <section className="np-section np-panel np-decision">
          <h2 className="np-section-title">Likely outcomes</h2>
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
      </div>

      <div className="np-cta-bar">
        <button
          type="button"
          className={`np-btn np-btn-primary ${highlightPrimaryCta ? "np-btn-highlight" : ""}`}
          onClick={onGeneratePlan}
          id="np-build-plan"
        >
          Build My Plan
        </button>
      </div>
    </div>
  );
}
