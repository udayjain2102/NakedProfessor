export default function RedesignScreen({ result }) {
  return (
    <div className="screen-stack">
      <section className="summary-card">
        <div className="section-label">04 Redesign</div>
        <h2>{result.verdict}</h2>
        <p>Recommended first move: {result.recommendations[0]?.title}.</p>
      </section>

      <section className="panel-card">
        <div className="section-label">Recommended moves</div>
        <div className="recommendation-list">
          {result.recommendations.map((item) => (
            <article key={item.title} className="recommendation-card">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="section-label">Design notes</div>
        <div className="insight-list">
          {result.insights.map((item) => (
            <article key={item.title} className="insight-card">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
