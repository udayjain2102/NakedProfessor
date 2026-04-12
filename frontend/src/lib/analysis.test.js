import { describe, expect, it } from "vitest";
import { presets } from "../data/presets";
import { calculate } from "./analysis";
import { inferFieldsFromBrief } from "./briefParser";

describe("analysis engine", () => {
  it("preserves the hot arm top risk and recommendation branch", () => {
    const result = calculate(presets.hotArm);
    expect(result.failureModes[0].name).toBe("Fatigue at root / hole edge");
    expect(result.recommendations[0].title).toBe("Increase thickness first");
  });

  it("keeps factory mount yield and deflection values in a realistic range", () => {
    const result = calculate(presets.factoryMount);
    expect(result.peakStress).toBeGreaterThan(250);
    expect(result.deflection).toBeGreaterThan(0.5);
  });

  it("keeps the current material when the brief does not specify one", () => {
    const inputs = inferFieldsFromBrief(presets.lightBracket.brief, presets.hotArm);
    expect(inputs.material).toBe("6061-T6 Aluminum");
    expect(inputs.load).toBe(500);
    expect(inputs.hole).toBe(6);
    expect(inputs.maxDeflection).toBe(1.5);
  });

  it("switches material when the brief explicitly calls out an alloy", () => {
    const explicit = inferFieldsFromBrief(
      "Use 7075 aluminum for a 500 N bracket with a 6 mm hole and under 1.5 mm deflection.",
      presets.hotArm
    );
    expect(explicit.material).toBe("7075-T6 Aluminum");
  });
});
