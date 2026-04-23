import { materials } from "../data/materials";
import { clamp, formatNumber } from "./formatters";

export function calculate(inputs) {
  const material = materials[inputs.material];
  const netWidth = Math.max(inputs.width - inputs.hole, inputs.width * 0.35);
  const netArea = netWidth * inputs.thickness;
  const grossArea = inputs.width * inputs.thickness;
  const moment = inputs.load * inputs.length;
  const sectionModulus = (inputs.width * Math.pow(inputs.thickness, 2)) / 6;
  const bendingStress = moment / sectionModulus;
  const axialStress = inputs.load / netArea;
  const peakStress = bendingStress + axialStress;
  const inertia = (inputs.width * Math.pow(inputs.thickness, 3)) / 12;
  const deflection = (inputs.load * Math.pow(inputs.length, 3)) / (3 * material.E * inertia);
  const bearingStress = inputs.load / (inputs.hole * inputs.thickness);
  const mass = (grossArea * inputs.length * material.density) / 1000000;
  const tempModifier = clamp(1 - Math.max(inputs.temperature - 20, 0) * 0.0022, 0.68, 1);
  const endurance = material.uts * material.fatigueCoeff * tempModifier;
  const alternatingStress = peakStress * 0.55;
  const fatigueFos = endurance / alternatingStress;
  const yieldFos = material.yield / peakStress;
  const bearingFos = (1.5 * material.yield) / bearingStress;
  const deflectionMargin = inputs.maxDeflection / deflection;
  const thermalGrowth = 23e-6 * Math.max(inputs.temperature - 20, 0) * inputs.length;
  const predictedLife = Math.pow(endurance / Math.max(alternatingStress, 1), 5) * 1000;

  const failureModes = [
    {
      name: "Fatigue at root / hole edge",
      score: clamp((inputs.fosTarget / fatigueFos) * 72 + (inputs.cycles > 1000000 ? 16 : 0), 6, 97),
      detail: `Alternating stress is ${formatNumber(alternatingStress)} MPa versus estimated endurance ${formatNumber(endurance)} MPa.`,
      rationale:
        fatigueFos < inputs.fosTarget
          ? "Cycle life target is not supported by the current hot-spot stress range."
          : "Fatigue is credible but currently within margin for the requested life."
    },
    {
      name: "Yielding in cantilever section",
      score: clamp((inputs.fosTarget / yieldFos) * 68, 4, 96),
      detail: `Peak combined stress is ${formatNumber(peakStress)} MPa against ${inputs.material} yield ${formatNumber(material.yield)} MPa.`,
      rationale:
        yieldFos < inputs.fosTarget
          ? "The section is too thin or too long for the demanded static load."
          : "Static strength is acceptable with current geometry."
    },
    {
      name: "Excessive deflection",
      score: clamp((1 / deflectionMargin) * 78, 3, 94),
      detail: `Predicted tip deflection is ${formatNumber(deflection, 2)} mm for a limit of ${formatNumber(inputs.maxDeflection, 2)} mm.`,
      rationale:
        deflection > inputs.maxDeflection
          ? "Serviceability likely fails before material strength does."
          : "Stiffness is adequate for the stated target."
    },
    {
      name: "Bolt-hole bearing / local crushing",
      score: clamp((inputs.fosTarget / bearingFos) * 54 + (inputs.hole / inputs.width) * 25, 5, 89),
      detail: `Bearing stress is ${formatNumber(bearingStress)} MPa with a net width ratio of ${formatNumber(netWidth / inputs.width, 2)}.`,
      rationale:
        bearingFos < inputs.fosTarget
          ? "Hole region is overloaded and should be thickened or reinforced."
          : "Hole bearing is not the leading risk, but it remains a local stress raiser."
    }
  ].sort((a, b) => b.score - a.score);

  const recommendations = [];

  if (yieldFos < inputs.fosTarget || fatigueFos < inputs.fosTarget) {
    const stressReduction = Math.floor((1 - Math.pow(inputs.thickness / (inputs.thickness + 2), 2)) * 100);
    recommendations.push({
      title: "Increase thickness first",
      body: `Moving from ${formatNumber(inputs.thickness, 1)} mm to ${formatNumber(inputs.thickness + 2, 1)} mm cuts bending stress roughly ${stressReduction}% and meaningfully lifts both yield and fatigue margin.`
    });
  }

  if (deflection > inputs.maxDeflection) {
    recommendations.push({
      title: "Shorten the load path or add a gusset",
      body: `Deflection scales with length cubed. Reducing the span from ${formatNumber(inputs.length, 0)} mm to ${formatNumber(inputs.length - 20, 0)} mm or triangulating the bracket is a higher-leverage stiffness fix than chasing stronger alloy alone.`
    });
  }

  if (failureModes[0].name.includes("Fatigue")) {
    recommendations.push({
      title: "Reduce stress concentration near the fixed end",
      body: "Add a larger fillet, improve edge distance around the bolt hole, or split the load across two fasteners. This is the cleanest way to raise cycle life without large mass penalties."
    });
  }

  if (
    (yieldFos < inputs.fosTarget || fatigueFos < inputs.fosTarget) &&
    inputs.material !== "7075-T6 Aluminum" &&
    inputs.material !== "Ti-6Al-4V"
  ) {
    recommendations.push({
      title: "Upgrade the material only after geometry",
      body: "A stronger alloy helps, but this design is geometry-limited first. Once thickness and root geometry improve, stepping to 7075-T6 or titanium can add margin without a full redesign."
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      title: "Freeze geometry and validate with higher-fidelity analysis",
      body: "This screening pass looks healthy. The next move is a more realistic FEA model with contact and notch sensitivity to confirm local hot spots."
    });
  }

  const verdict =
    failureModes[0].score >= 75
      ? "Current concept is not release-ready. The dominant risk should be addressed before prototype signoff."
      : failureModes[0].score >= 45
        ? "Current concept is directionally workable but needs refinement before it is robust."
        : "Current concept passes this first-pass screen. A detailed model should confirm local hot spots.";

  const checks = [
    {
      name: "Net section stress",
      note: `Axial ${formatNumber(axialStress)} MPa + bending ${formatNumber(bendingStress)} MPa`,
      value: `${formatNumber(peakStress)} MPa`,
      pass: yieldFos >= inputs.fosTarget
    },
    {
      name: "Tip deflection",
      note: "Cantilever beam stiffness estimate",
      value: `${formatNumber(deflection, 2)} mm`,
      pass: deflection <= inputs.maxDeflection
    },
    {
      name: "Fatigue screen",
      note: `Endurance ${formatNumber(endurance)} MPa`,
      value: `FOS ${formatNumber(fatigueFos, 2)}`,
      pass: fatigueFos >= inputs.fosTarget
    },
    {
      name: "Hole bearing",
      note: `Bearing stress ${formatNumber(bearingStress)} MPa`,
      value: `FOS ${formatNumber(bearingFos, 2)}`,
      pass: bearingFos >= inputs.fosTarget
    },
    {
      name: "Thermal growth",
      note: "Free expansion over bracket reach",
      value: `${formatNumber(thermalGrowth, 2)} mm`,
      pass: false,
      watch: true
    }
  ];

  const metrics = [
    { label: "Predicted mass", value: `${formatNumber(mass, 3)} kg` },
    { label: "Peak stress", value: `${formatNumber(peakStress)} MPa` },
    { label: "Yield FOS", value: formatNumber(yieldFos, 2) },
    {
      label: "Predicted life",
      value: predictedLife > 1e9 ? ">1B cycles" : `${Math.round(predictedLife).toLocaleString()} cycles`
    }
  ];

  const trace = [
    {
      step: "01 Intake",
      title: "Parsed the brief into geometry, load, life, and thermal limits.",
      body: `Detected ${formatNumber(inputs.load, 0)} N load, ${formatNumber(inputs.length, 0)} mm span, ${formatNumber(inputs.cycles, 0)} cycle target, and ${formatNumber(inputs.temperature, 0)} C operation.`
    },
    {
      step: "02 Plan",
      title: "Selected a lean calculation stack for explainable screening.",
      body: "Combined bending stress, cantilever deflection, bolt-hole bearing, and endurance-based fatigue keep the readout demo-friendly without hiding the logic."
    },
    {
      step: "03 Validate",
      title: `${failureModes[0].name} emerged as the leading concern.`,
      body: `${failureModes[0].rationale} The current top risk score is ${Math.round(failureModes[0].score)}/100.`
    },
    {
      step: "04 Refine",
      title: "Generated redesign moves in the order of mechanical leverage.",
      body: recommendations[0].body
    }
  ];

  const insights = [
    {
      title: "Material trade-off",
      body: inputs.material.includes("Steel")
        ? "Steel gives excellent stiffness, but mass rises quickly. Good for durable mounts, weak for aggressive lightweight goals."
        : "Aluminum keeps mass low, but geometry quality matters more because stiffness and endurance are the tighter constraints."
    },
    {
      title: "Environment read",
      body:
        inputs.temperature >= 80
          ? "Hot service meaningfully derates fatigue endurance here, so thermal exposure is part of the failure story, not a footnote."
          : "Thermal load is modest, so strength and stiffness dominate the design decision."
    }
  ];

  return {
    axialStress,
    bendingStress,
    peakStress,
    deflection,
    bearingStress,
    mass,
    endurance,
    fatigueFos,
    yieldFos,
    bearingFos,
    thermalGrowth,
    predictedLife,
    failureModes,
    recommendations,
    verdict,
    checks,
    metrics,
    trace,
    insights
  };
}
