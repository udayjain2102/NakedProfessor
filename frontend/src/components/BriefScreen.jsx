import { materials } from "../data/materials";
import { presets } from "../data/presets";

const fieldMeta = [
  ["load", "Load (N)", 1],
  ["length", "Span / reach (mm)", 1],
  ["width", "Plate width (mm)", 1],
  ["thickness", "Thickness (mm)", 1],
  ["hole", "Hole diameter (mm)", 1],
  ["cycles", "Target life (cycles)", 1],
  ["temperature", "Temperature (C)", 1],
  ["maxDeflection", "Max deflection (mm)", 0.1],
  ["fosTarget", "Target factor of safety", 0.1]
];

export default function BriefScreen({
  inputs,
  onInputChange,
  onBriefBlur,
  onApplyPreset,
  onAnalyze
}) {
  return (
    <div className="screen-stack">
      <section className="hero-card">
        <div className="eyebrow">01 Intake</div>
        <h2>Mechanical brief, cleaned up for decision-making.</h2>
        <p>
          Drop in a part description, load condition, and life target. The parser will infer fields,
          then the solver will recut the brief into stress, fatigue, and redesign output.
        </p>
      </section>

      <section className="panel-card">
        <div className="section-label">Presets</div>
        <div className="preset-strip">
          {Object.entries(presets).map(([key, preset]) => (
            <button key={key} type="button" className="chip-button" onClick={() => onApplyPreset(key)}>
              {preset.material.split(" ")[0]}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="brief">
          Natural language brief
        </label>
        <textarea
          id="brief"
          value={inputs.brief}
          onChange={(event) => onInputChange("brief", event.target.value)}
          onBlur={onBriefBlur}
        />

        <div className="field-grid field-grid-top">
          <div className="field-card">
            <label className="field-label" htmlFor="material">
              Material
            </label>
            <select
              id="material"
              value={inputs.material}
              onChange={(event) => onInputChange("material", event.target.value)}
            >
              {Object.keys(materials).map((material) => (
                <option key={material} value={material}>
                  {material}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-grid">
          {fieldMeta.map(([key, label, step]) => (
            <div key={key} className="field-card">
              <label className="field-label" htmlFor={key}>
                {label}
              </label>
              <input
                id={key}
                type="number"
                step={step}
                value={inputs[key]}
                onChange={(event) => onInputChange(key, Number(event.target.value))}
              />
            </div>
          ))}
        </div>

        <button type="button" className="action-button" onClick={onAnalyze}>
          Run analysis
        </button>
      </section>
    </div>
  );
}
