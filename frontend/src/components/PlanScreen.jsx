export default function PlanScreen({ plan, quiz, loading }) {
  if (loading) {
    return (
      <div className="loading-pulse">
        <div className="pulse-bar" style={{ width: "85%" }} />
        <div className="pulse-bar" style={{ width: "60%" }} />
        <div className="pulse-bar" style={{ width: "75%" }} />
        <div className="pulse-bar" style={{ width: "70%" }} />
        <div className="pulse-bar" style={{ width: "80%" }} />
      </div>
    );
  }

  if (!plan && !quiz) {
    return (
      <div className="hero-card">
        <strong>Ready to generate.</strong>
        <p>Go to Brief, pick a professor and paste your syllabus, then run.</p>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {plan && (
        <article className="panel-card">
          <span className="section-label">Study Plan</span>
          <pre>{plan}</pre>
        </article>
      )}

      {quiz && (
        <article className="panel-card">
          <span className="section-label">Study Quiz</span>
          <pre>{quiz}</pre>
        </article>
      )}
    </div>
  );
}
