// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./generate";
import { STUDY_PLAN_SCHEMA_VERSION } from "../src/lib/studyPlanSchema";

const SAMPLE_STUDY_PLAN = {
  schemaVersion: STUDY_PLAN_SCHEMA_VERSION,
  riskSummary: {
    headline: "Moderate grading risk",
    bullets: ["Weight homework feedback heavily.", "Start exam prep early.", "Clarify rubric assumptions."],
  },
  weeklyPlan: {
    headline: "Repeat lecture-to-practice cycles",
    bullets: ["Review notes within 24 hours.", "Do one timed set weekly.", "Track recurring misses."],
  },
  assessmentPlan: {
    headline: "Map each assessment to prep blocks",
    bullets: ["Back-plan two weeks from each exam.", "Reuse homework misses as study prompts.", "Practice under time constraints."],
  },
  officeHoursStrategy: {
    headline: "Use office hours to test your reasoning",
    bullets: ["Bring one worked attempt.", "Ask about grading expectations.", "Confirm exam-style mistakes early."],
  },
  sourceTrace: [
    {
      source: "syllabus",
      detail: "Assessment timing comes from the syllabus breakdown.",
      evidence: "Midterm 30%, Final 40%, Homework 30%",
    },
  ],
};

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("/api/generate", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("rejects non-POST methods", async () => {
    const res = createMockRes();

    await handler({ method: "GET" }, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("rejects requests without syllabus and professor signals", async () => {
    const res = createMockRes();

    await handler({ method: "POST", body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing syllabus or professorSignals." });
  });

  it("returns a validated structured plan when the model responds with valid JSON", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify(SAMPLE_STUDY_PLAN),
      }),
    });
    const res = createMockRes();

    await handler(
      {
        method: "POST",
        body: {
          syllabus: "Midterm 30%, Final 40%, Homework 30%",
          professorSignals: { workload: "medium", riskLevel: "moderate" },
        },
      },
      res
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ plan: SAMPLE_STUDY_PLAN });
  });

  it("returns 502 when the model response does not match the schema", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          schemaVersion: STUDY_PLAN_SCHEMA_VERSION,
          riskSummary: { headline: "Incomplete" },
        }),
      }),
    });
    const res = createMockRes();

    await handler(
      {
        method: "POST",
        body: {
          syllabus: "Quiz 10%",
          professorSignals: { workload: "high" },
        },
      },
      res
    );

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/schema|required|bullets/i);
  });
});
