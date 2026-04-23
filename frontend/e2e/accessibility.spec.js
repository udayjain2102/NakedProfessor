import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SAMPLE_PLAN = {
  schemaVersion: "study-plan.v1",
  riskSummary: {
    headline: "Moderate ambiguity risk",
    bullets: [
      "Lecture clarity is uneven.",
      "Difficulty stays above average.",
      "Homework likely predicts assessments.",
    ],
  },
  weeklyPlan: {
    headline: "Repeat review and timed practice",
    bullets: [
      "Review notes within 24 hours.",
      "Run one timed problem set weekly.",
      "Track every repeated mistake.",
    ],
  },
  assessmentPlan: {
    headline: "Start exam prep two weeks early",
    bullets: [
      "Back-plan from every major assessment.",
      "Turn missed homework into study prompts.",
      "Practice under the same time pressure.",
    ],
  },
  officeHoursStrategy: {
    headline: "Use office hours to test assumptions",
    bullets: [
      "Bring one worked example.",
      "Ask how reasoning is graded.",
      "Go before the first big exam miss.",
    ],
  },
  sourceTrace: [
    {
      source: "syllabus",
      detail: "Exam weighting drives the assessment cadence.",
      evidence: "Midterm 30%, Final 40%, Homework 30%",
    },
  ],
};

function seriousViolationsOnly(results) {
  return results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact || "")
  );
}

function formatViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = seriousViolationsOnly(results);
  expect(formatViolations(seriousViolations)).toEqual([]);
}

test("select route has no serious accessibility violations", async ({ page }) => {
  await page.goto("/app/select");
  await expect(page.getByText(/NakedProfessor/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Browse schools/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("professor route has no serious accessibility violations", async ({ page }) => {
  await page.goto("/app/professor/prof:1");
  await expect(page.getByRole("heading", { name: /Reality Check/i })).toBeVisible();
  await expect(page.getByText(/Common risks/i)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("game-plan route has no serious accessibility violations", async ({ page }) => {
  await page.goto("/app/plan/prof:1");
  await expect(page.getByRole("heading", { level: 1, name: /Game Plan/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /Add your syllabus/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("saved route has no serious accessibility violations", async ({ page }) => {
  await page.addInitScript((plan) => {
    window.localStorage.setItem(
      "np-student-workspace-v1:guest",
      JSON.stringify({
        accountName: "Guest mode",
        subjects: [
          {
            id: "subject-1",
            name: "Calculus II",
            courseTitle: "Calculus II",
            syllabus: "Midterm 30%, Final 40%, Homework 30%",
            materialsNote: "",
            plan,
            planReady: true,
            studyHours: 8,
            schoolKey: "test-university",
            schoolName: "Test University",
            activeProfessorId: "prof:1",
            savedProfessors: [
              {
                professorId: "prof:1",
                professorName: "Jane Doe",
                department: "Mathematics",
                schoolKey: "test-university",
                schoolName: "Test University",
                rating: 4.2,
                difficulty: 3.4,
              },
            ],
          },
        ],
      })
    );
  }, SAMPLE_PLAN);

  await page.goto("/saved");
  await expect(page.getByRole("button", { name: /Calculus II/i })).toBeVisible();
  await expect(page.getByText(/1 subject saved on this device/i)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
