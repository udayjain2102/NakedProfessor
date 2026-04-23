import { riskLevel } from "../lib/formatters";

export default function RisksScreen({ result }) {
  return (
    <div className="screen-stack">
      <section className="hero-card hero-card-accent">
        <div className="eyebrow">03 Risks</div>
        <h2>Rank the likely breakpoints, then show the rationale.</h2>
        <p>Each failure mode stays explainable, sortable, and tuned for fast demo narration.</p>
      </section>

      <div className="risk-list">
        {result.failureModes.map((mode) => {
          const level = riskLevel(mode.score);
          return (
            <article key={mode.name} className="risk-card">
              <div className="risk-card-head">
                <div>
                  <span className="section-label">Failure mode</span>
                  <strong>{mode.name}</strong>
                </div>
                <span className={`status-chip ${level.className}`}>{level.label}</span>
              </div>
              <p>{mode.detail}</p>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${mode.score}%` }} />
              </div>
              <p>{mode.rationale}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
