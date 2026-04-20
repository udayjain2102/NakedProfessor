function ChecklistItem({ item }) {
  return (
    <li className="np-plan-check-item">
      <span className="np-plan-check-mark" aria-hidden="true">
        □
      </span>
      <span>{item}</span>
    </li>
  );
}

export default function WeeklyChecklist({ weeklyPlan }) {
  if (!weeklyPlan) return null;

  return (
    <section className="np-panel np-plan-section">
      <div className="np-plan-section-head">
        <span className="np-eyebrow">Weekly Checklist</span>
        <h3 className="np-section-title">{weeklyPlan.headline}</h3>
      </div>
      <ul className="np-plan-checklist">
        {weeklyPlan.bullets.map((bullet) => (
          <ChecklistItem key={bullet} item={bullet} />
        ))}
      </ul>
    </section>
  );
}
