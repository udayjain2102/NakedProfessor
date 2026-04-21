function MilestoneColumn({ label, headline, bullets, tone }) {
  return (
    <article className={`np-plan-milestone-card np-plan-milestone-${tone}`}>
      <span className="np-plan-card-kicker">{label}</span>
      <strong className="np-plan-milestone-headline">{headline}</strong>
      <ul className="np-plan-milestone-list">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </article>
  );
}

export default function PlanMilestones({ assessmentPlan, officeHoursStrategy }) {
  if (!assessmentPlan || !officeHoursStrategy) return null;

  return (
    <section className="np-panel np-plan-section">
      <div className="np-plan-section-head">
        <span className="np-eyebrow">Milestones</span>
        <h3 className="np-section-title">Assessment windows and intervention points</h3>
      </div>
      <div className="np-plan-milestone-grid">
        <MilestoneColumn
          label="Assessment Plan"
          headline={assessmentPlan.headline}
          bullets={assessmentPlan.bullets}
          tone="assessment"
        />
        <MilestoneColumn
          label="Office-Hours Strategy"
          headline={officeHoursStrategy.headline}
          bullets={officeHoursStrategy.bullets}
          tone="office"
        />
      </div>
    </section>
  );
}
