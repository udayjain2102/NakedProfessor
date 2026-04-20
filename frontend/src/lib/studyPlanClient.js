import { parseStudyPlanResponse } from "./studyPlanSchema";

export async function generateStudyPlan({ syllabus, professorSignals }) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      syllabus,
      professorSignals,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Study plan generation failed.");
  }

  return parseStudyPlanResponse(payload.plan);
}
