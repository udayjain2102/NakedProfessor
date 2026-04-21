function RiskCard({ index, text }) {
  return (
    <article className="np-plan-risk-card">
      <span className="np-plan-card-kicker">Risk {String(index + 1).padStart(2, "0")}</span>
      <p>{text}</p>
    </article>
  );
}

export default function PlanRiskCards({ riskSummary }) {
  if (!riskSummary) return null;

  return (
    <section className="np-panel np-plan-section">
      <div className="np-plan-section-head">
        <span className="np-eyebrow">Risk Summary</span>
        <h3 className="np-section-title">{riskSummary.headline}</h3>
      </div>
      <div className="np-plan-risk-grid">
        {riskSummary.bullets.map((bullet, index) => (
          <RiskCard key={bullet} index={index} text={bullet} />
        ))}
      </div>
    </section>
  );
}
