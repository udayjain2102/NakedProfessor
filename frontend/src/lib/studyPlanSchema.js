export const STUDY_PLAN_SCHEMA_VERSION = "1.0.0";

const TRACE_SOURCES = new Set(["syllabus", "professor_signal", "inference"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, message) {
  assert(typeof value === "string" && value.trim().length > 0, message);
}

function assertStringArray(value, message) {
  assert(Array.isArray(value) && value.length > 0, message);
  value.forEach((item, index) => {
    assertNonEmptyString(item, `${message} (item ${index + 1})`);
  });
}

function validateTraceItem(item, index) {
  assert(isPlainObject(item), `sourceTrace[${index}] must be an object.`);
  assert(
    typeof item.source === "string" && TRACE_SOURCES.has(item.source),
    `sourceTrace[${index}].source must be one of: ${Array.from(TRACE_SOURCES).join(", ")}.`
  );
  assertNonEmptyString(item.detail, `sourceTrace[${index}].detail is required.`);
  assertNonEmptyString(item.evidence, `sourceTrace[${index}].evidence is required.`);
}

function validateSection(section, fieldName) {
  assert(isPlainObject(section), `${fieldName} must be an object.`);
  assertNonEmptyString(section.headline, `${fieldName}.headline is required.`);
  assertStringArray(section.bullets, `${fieldName}.bullets must contain at least one item.`);
}

export function validateStudyPlan(value) {
  assert(isPlainObject(value), "Study plan response must be an object.");
  assert(
    value.schemaVersion === STUDY_PLAN_SCHEMA_VERSION,
    `schemaVersion must equal ${STUDY_PLAN_SCHEMA_VERSION}.`
  );
  validateSection(value.riskSummary, "riskSummary");
  validateSection(value.weeklyPlan, "weeklyPlan");
  validateSection(value.assessmentPlan, "assessmentPlan");
  validateSection(value.officeHoursStrategy, "officeHoursStrategy");
  assert(
    Array.isArray(value.sourceTrace) && value.sourceTrace.length > 0,
    "sourceTrace must contain at least one item."
  );
  value.sourceTrace.forEach(validateTraceItem);
  return value;
}

export function parseStudyPlanResponse(value) {
  return validateStudyPlan(value);
}

export function buildStudyPlanPrompt({ syllabus, professorSignals }) {
  return [
    "Return JSON only.",
    "You are an academic strategist generating a study plan grounded in professor signals and syllabus text.",
    "Use this schema exactly:",
    JSON.stringify(
      {
        schemaVersion: STUDY_PLAN_SCHEMA_VERSION,
        riskSummary: { headline: "string", bullets: ["string"] },
        weeklyPlan: { headline: "string", bullets: ["string"] },
        assessmentPlan: { headline: "string", bullets: ["string"] },
        officeHoursStrategy: { headline: "string", bullets: ["string"] },
        sourceTrace: [
          {
            source: "syllabus | professor_signal | inference",
            detail: "string",
            evidence: "string",
          },
        ],
      },
      null,
      2
    ),
    "Constraints:",
    "- Keep each bullets array to 3-5 concrete items.",
    "- Tie recommendations to the provided signals instead of generic study advice.",
    "- Use sourceTrace to show where each major recommendation came from.",
    "",
    `Professor signals:\n${JSON.stringify(professorSignals, null, 2)}`,
    "",
    `Syllabus text:\n${syllabus}`,
  ].join("\n");
}

export const __internal = {
  TRACE_SOURCES,
  isPlainObject,
};
