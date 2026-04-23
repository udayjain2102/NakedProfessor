export default function AnalysisScreen({ result }) {
  return (
    <div className="screen-stack">
      <section className="hero-card hero-card-dark">
        <div className="eyebrow">02 Analysis</div>
        <h2>Checks, margins, and confidence reads in one pass.</h2>
        <p>The same engineering logic is preserved here, just staged into a cleaner mobile dashboard.</p>
      </section>

      <div className="metric-grid">
        {result.metrics.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span className="section-label">{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <section className="panel-card">
        <div className="section-label">Mechanical checks</div>
        <div className="check-list">
          {result.checks.map((check) => (
            <article key={check.name} className="check-row">
              <div>
                <strong>{check.name}</strong>
                <p>{check.note}</p>
              </div>
              <div className="check-side">
                <span>{check.value}</span>
                <span
                  className={
                    check.watch
                      ? "status-chip risk-medium"
                      : check.pass
                        ? "status-chip risk-low"
                        : "status-chip risk-high"
                  }
                >
                  {check.watch ? "Watch fit-up" : check.pass ? "Pass" : "Fail"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="section-label">Reasoning trace</div>
        <div className="trace-list">
          {result.trace.map((item) => (
            <article key={item.step} className="trace-card">
              <span>{item.step}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
