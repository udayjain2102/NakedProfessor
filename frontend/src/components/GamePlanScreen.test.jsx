import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GamePlanScreen from "./GamePlanScreen";
import { STUDY_PLAN_SCHEMA_VERSION } from "../lib/studyPlanSchema";

const SAMPLE_PLAN = {
  schemaVersion: STUDY_PLAN_SCHEMA_VERSION,
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
    {
      source: "professor_signal",
      detail: "Difficulty level raises repetition needs.",
      evidence: "avg_difficulty 3.4 and moderate clarity.",
    },
  ],
};

function renderScreen() {
  return render(
    <GamePlanScreen
      professor={{
        professor_first: "Jane",
        professor_last: "Doe",
        avg_difficulty: 3.4,
      }}
      profile={{ workload: "medium" }}
      syllabus="Grading: Midterm 30%, Final 40%, Homework 30%"
      courseTitle="Calculus II"
      onSyllabusChange={vi.fn()}
      onCourseTitleChange={vi.fn()}
      materialsNote=""
      onMaterialsNoteChange={vi.fn()}
      onGenerate={vi.fn()}
      loading={false}
      plan={SAMPLE_PLAN}
      intel={{ risk: { level: "moderate" } }}
      studyHours={8}
      onStudyHoursChange={vi.fn()}
      highlightPrimaryCta={false}
      onFocusSyllabus={vi.fn()}
    />
  );
}

describe("GamePlanScreen", () => {
  it("renders structured plan sections instead of a single text block", () => {
    renderScreen();

    expect(
      screen.getByRole("heading", { name: /Execution map built from syllabus plus professor signals/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Moderate ambiguity risk/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Repeat review and timed practice/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Assessment windows and intervention points/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Exam weighting drives the assessment cadence/i)).toBeInTheDocument();
  });

  it("toggles the why-this-plan drawer", () => {
    renderScreen();

    const [toggle] = screen.getAllByRole("button", { name: /Why This Plan/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Risk posture/i)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const drawer = document.getElementById("np-why-plan-drawer");
    expect(drawer).not.toBeNull();
    expect(within(drawer).getByText(/Risk posture/i)).toBeInTheDocument();
    expect(within(drawer).getByText(/Use office hours to test assumptions/i)).toBeInTheDocument();
  });
});
