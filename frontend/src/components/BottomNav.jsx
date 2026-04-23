export default function BottomNav({ tabs, activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === activeTab ? "nav-pill active" : "nav-pill"}
          onClick={() => onChange(tab.id)}
        >
          <span className="nav-pill-index">{tab.id.slice(0, 1).toUpperCase()}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
