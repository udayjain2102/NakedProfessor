import { useState } from "react";

function buildDrawerItems(plan) {
  return [
    {
      label: "Risk posture",
      text: plan.riskSummary.headline,
    },
    {
      label: "Weekly cadence",
      text: plan.weeklyPlan.headline,
    },
    {
      label: "Assessment timing",
      text: plan.assessmentPlan.headline,
    },
    {
      label: "Professor access",
      text: plan.officeHoursStrategy.headline,
    },
  ];
}

export default function WhyPlanDrawer({ plan }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!plan) return null;

  const items = buildDrawerItems(plan);

  return (
    <section className="np-panel np-plan-section np-why-drawer">
      <button
        type="button"
        className="np-why-drawer-toggle"
        aria-expanded={isOpen}
        aria-controls="np-why-plan-drawer"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>
          <span className="np-eyebrow">Why This Plan</span>
          <strong className="np-why-drawer-title">Reasoning behind the recommendations</strong>
        </span>
        <span className="np-why-drawer-icon" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      {isOpen && (
        <div id="np-why-plan-drawer" className="np-why-drawer-body">
          <div className="np-why-drawer-grid">
            {items.map((item) => (
              <article key={item.label} className="np-why-drawer-card">
                <span className="np-plan-card-kicker">{item.label}</span>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
