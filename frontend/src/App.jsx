import { useEffect, useState } from "react";
import BottomNav from "./components/BottomNav";
import BriefScreen from "./components/BriefScreen";
import AnalysisScreen from "./components/AnalysisScreen";
import PhoneFrame from "./components/PhoneFrame";
import RedesignScreen from "./components/RedesignScreen";
import RisksScreen from "./components/RisksScreen";
import { brand } from "./config/brand";
import { presets } from "./data/presets";
import { calculate } from "./lib/analysis";
import { getDefaultInputs, inferFieldsFromBrief } from "./lib/briefParser";

const screenTitles = {
  brief: "Input studio",
  analysis: "Signal board",
  risks: "Failure stack",
  redesign: "Redesign queue"
};

function getTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function getDateLabel() {
  return new Date().toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState("brief");
  const [inputs, setInputs] = useState(getDefaultInputs());
  const [result, setResult] = useState(() => calculate(getDefaultInputs()));
  const [timeLabel, setTimeLabel] = useState(getTimeLabel());
  const [dateLabel, setDateLabel] = useState(getDateLabel());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLabel(getTimeLabel());
      setDateLabel(getDateLabel());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  function handleInputChange(key, value) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  function handleBriefBlur() {
    setInputs((current) => inferFieldsFromBrief(current.brief, current));
  }

  function handleAnalyze() {
    const nextInputs = inferFieldsFromBrief(inputs.brief, inputs);
    setInputs(nextInputs);
    setResult(calculate(nextInputs));
    if (activeTab === "brief") {
      setActiveTab("analysis");
    }
  }

  function handlePreset(key) {
    const preset = presets[key];
    if (!preset) return;
    setInputs({ ...preset });
    setResult(calculate(preset));
    setActiveTab("analysis");
  }

  const screens = {
    brief: (
      <BriefScreen
        inputs={inputs}
        onInputChange={handleInputChange}
        onBriefBlur={handleBriefBlur}
        onApplyPreset={handlePreset}
        onAnalyze={handleAnalyze}
      />
    ),
    analysis: <AnalysisScreen result={result} />,
    risks: <RisksScreen result={result} />,
    redesign: <RedesignScreen result={result} />
  };

  return (
    <main className="app-shell">
      <section className="poster-stage">
        <div className="poster-copy">
          <div className="poster-tag-row">
            {brand.badges.map((badge) => (
              <span key={badge} className="poster-chip">
                {badge}
              </span>
            ))}
          </div>

          <div className="brand-lockup">
            <div className="brand-mark">{brand.shortName}</div>
            <div>
              <div className="eyebrow">{brand.heroEyebrow}</div>
              <h1>{brand.name}</h1>
            </div>
          </div>

          <p className="poster-headline">{brand.headline}</p>
          <p className="poster-subhead">{brand.subhead}</p>

          <div className="poster-panels">
            <article className="poster-panel">
              <span className="section-label">Current screen</span>
              <strong>{screenTitles[activeTab]}</strong>
              <p>App-like navigation makes the prototype feel closer to a product demo than a landing page.</p>
            </article>
            <article className="poster-panel poster-panel-light">
              <span className="section-label">Deployment</span>
              <strong>Vercel or Netlify</strong>
              <p>This build outputs static assets from `dist`, so either platform will work cleanly.</p>
            </article>
          </div>
        </div>

        <PhoneFrame>
          <header className="mobile-topbar">
            <div>
              <div className="eyebrow">{brand.statusLabel}</div>
              <strong>{dateLabel}</strong>
            </div>
            <div className="time-chip">{timeLabel}</div>
          </header>

          <section className="screen-header">
            <p>{brand.headline}</p>
            <strong>{screenTitles[activeTab]}</strong>
          </section>

          <div className="screen-body">{screens[activeTab]}</div>
          <BottomNav tabs={brand.tabs} activeTab={activeTab} onChange={setActiveTab} />
        </PhoneFrame>
      </section>
    </main>
  );
}
