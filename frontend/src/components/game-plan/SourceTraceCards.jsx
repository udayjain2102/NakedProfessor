function formatSource(source) {
  return source.replace(/_/g, " ");
}

export default function SourceTraceCards({ sourceTrace }) {
  if (!sourceTrace?.length) return null;

  return (
    <section className="np-panel np-plan-section">
      <div className="np-plan-section-head">
        <span className="np-eyebrow">Source Trace</span>
        <h3 className="np-section-title">Why the plan points where it points</h3>
      </div>
      <div className="np-source-trace-grid">
        {sourceTrace.map((entry, index) => (
          <article key={`${entry.source}-${index}`} className="np-source-trace-card">
            <span className="np-plan-card-kicker">{formatSource(entry.source)}</span>
            <strong className="np-source-trace-detail">{entry.detail}</strong>
            <p className="np-fineprint">{entry.evidence}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
