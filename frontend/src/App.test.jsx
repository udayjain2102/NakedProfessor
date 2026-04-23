import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const supabaseState = vi.hoisted(() => {
  const state = { currentUser: null, configured: true, workspaces: {} };
  return {
    state,
    getSession: vi.fn(async () => ({
      data: {
        session: state.currentUser ? { user: state.currentUser } : null,
      },
    })),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    })),
    exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_field, userId) => ({
          maybeSingle: vi.fn(async () => {
            const workspace = state.workspaces[userId];
            return workspace
              ? {
                  data: {
                    account_name: workspace.account_name,
                    subjects: workspace.subjects,
                  },
                  error: null,
                  status: 200,
                }
              : {
                  data: null,
                  error: null,
                  status: 406,
                };
          }),
        })),
      })),
      upsert: vi.fn(async (payload) => {
        state.workspaces[payload.user_id] = {
          account_name: payload.account_name,
          subjects: payload.subjects,
        };
        return { error: null };
      }),
      delete: vi.fn(() => ({
        eq: vi.fn(async (_field, userId) => {
          delete state.workspaces[userId];
          return { error: null };
        }),
      })),
    })),
  };
});

vi.mock("./lib/supabaseClient", () => ({
  getAuthRedirectUrl: vi.fn(() => window.location.origin),
  hasSupabaseConfig: vi.fn(() => supabaseState.state.configured),
  supabase: {
    auth: {
      getSession: supabaseState.getSession,
      onAuthStateChange: supabaseState.onAuthStateChange,
      exchangeCodeForSession: supabaseState.exchangeCodeForSession,
      signInWithOtp: supabaseState.signInWithOtp,
      signOut: supabaseState.signOut,
    },
    from: supabaseState.from,
  },
}));

import App from "./App";
import { STUDY_PLAN_SCHEMA_VERSION } from "./lib/studyPlanSchema";

let matchMediaMatches = false;

function installMatchMediaMock() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: matchMediaMatches,
      media: "(max-width: 960px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const SAMPLE_ARTIFACT = {
  schema_version: "1.0.0",
  generated_at: "2026-04-20T00:00:00Z",
  freshness: {
    generated_at: "2026-04-20T00:00:00Z",
    ttl_hours: 24 * 30,
  },
  schools: [
    {
      school_id: "school:st:test-university",
      name: "Test University",
      state: "ST",
      rank: 1,
    },
    {
      school_id: "school:pa:penn-state-behrend",
      name: "Pennsylvania State University - Behrend",
      state: "PA",
      rank: 2,
    },
  ],
  professors: [
    {
      professor_id: "prof:1",
      school_id: "school:st:test-university",
      legacy_id: 1,
      first_name: "Jane",
      last_name: "Doe",
      department: "Mathematics",
      profile_url: "https://example.com",
      metrics: {
        avg_rating: 4.2,
        avg_difficulty: 3.4,
        would_take_again_percent: 72,
        num_ratings: 15,
      },
    },
    {
      professor_id: "prof:2",
      school_id: "school:st:test-university",
      legacy_id: 2,
      first_name: "John",
      last_name: "Smith",
      department: "Mathematics",
      profile_url: "https://example.com/john",
      metrics: {
        avg_rating: 3.8,
        avg_difficulty: 3.6,
        would_take_again_percent: 61,
        num_ratings: 11,
      },
    },
    {
      professor_id: "prof:3",
      school_id: "school:pa:penn-state-behrend",
      legacy_id: 3,
      first_name: "Alex",
      last_name: "Morgan",
      department: "Computer Science",
      profile_url: "https://example.com/alex",
      metrics: {
        avg_rating: 4.1,
        avg_difficulty: 3.1,
        would_take_again_percent: 76,
        num_ratings: 19,
      },
    },
    {
      professor_id: "prof:4",
      school_id: "school:pa:penn-state-behrend",
      legacy_id: 4,
      first_name: "Jamie",
      last_name: "Lee",
      department: "Mathematics",
      profile_url: "https://example.com/jamie",
      metrics: {
        avg_rating: 3.9,
        avg_difficulty: 3.2,
        would_take_again_percent: 64,
        num_ratings: 12,
      },
    },
  ],
};

const SAMPLE_CSV = [
  "school_rank,school_name,school_id,school_state,professor_id,professor_legacy_id,professor_first,professor_last,department,avg_rating,avg_difficulty,would_take_again_percent,num_ratings,profile_url",
  "1,Test University,school:st:test-university,ST,prof:1,1,Jane,Doe,Mathematics,4.2,3.4,72,15,https://example.com",
  "1,Test University,school:st:test-university,ST,prof:2,2,John,Smith,Mathematics,3.8,3.6,61,11,https://example.com/john",
  "2,Pennsylvania State University - Behrend,school:pa:penn-state-behrend,PA,prof:3,3,Alex,Morgan,Computer Science,4.1,3.1,76,19,https://example.com/alex",
  "2,Pennsylvania State University - Behrend,school:pa:penn-state-behrend,PA,prof:4,4,Jamie,Lee,Mathematics,3.9,3.2,64,12,https://example.com/jamie",
].join("\n");

const SAMPLE_STUDY_PLAN = {
  schemaVersion: STUDY_PLAN_SCHEMA_VERSION,
  riskSummary: {
    headline: "Moderate ambiguity risk",
    bullets: [
      "Lecture clarity is mixed, so build notes into a recap within 24 hours.",
      "Difficulty sits above average, so do not batch all problem practice near exams.",
      "Homework likely previews tests, so mistakes need to be logged early.",
    ],
  },
  weeklyPlan: {
    headline: "Front-load recall and problem reps",
    bullets: [
      "Block two short review sessions after each lecture.",
      "Reserve one longer weekly session for timed problem sets.",
      "Use the syllabus grading weights to prioritize homework and exam prep first.",
    ],
  },
  assessmentPlan: {
    headline: "Treat assessments as cumulative",
    bullets: [
      "Start exam review two weeks early with mixed practice.",
      "Convert graded homework misses into a recurring correction list.",
      "Mirror likely exam conditions once per week before each test.",
    ],
  },
  officeHoursStrategy: {
    headline: "Go in with proof of attempt",
    bullets: [
      "Bring one solved example and one blocked step.",
      "Ask the professor to confirm how they expect reasoning to be shown.",
      "Use office hours after the first weak assignment, not after a major exam miss.",
    ],
  },
  sourceTrace: [
    {
      source: "professor_signal",
      detail: "Difficulty and clarity drive the weekly repetition load.",
      evidence: "avg_difficulty 3.4 with moderate rating confidence.",
    },
    {
      source: "syllabus",
      detail: "Assessment prep starts early because exams dominate the grade.",
      evidence: "Midterm 30%, Final 40%, Homework 30%.",
    },
  ],
};

describe("NakedProfessor app", () => {
  const renderApp = (initialEntries = ["/app/select"]) =>
    render(
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    );

  beforeEach(() => {
    matchMediaMatches = false;
    installMatchMediaMock();
    supabaseState.state.currentUser = null;
    supabaseState.state.configured = true;
    supabaseState.state.workspaces = {};
    supabaseState.getSession.mockClear();
    supabaseState.onAuthStateChange.mockClear();
    supabaseState.exchangeCodeForSession.mockClear();
    supabaseState.signInWithOtp.mockClear();
    supabaseState.signOut.mockClear();
    supabaseState.from.mockClear();
    window.history.replaceState({}, "", "/");
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("top200_plus_behrend_professors.csv") || url.includes("professor-artifacts")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(SAMPLE_CSV),
        });
      }
      if (url.includes("normalized")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(SAMPLE_ARTIFACT),
        });
      }
      if (url.includes("top_colleges")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { rank: 1, name: "Test University", state: "ST" },
              { rank: 2, name: "Pennsylvania State University - Behrend", state: "PA" },
              { rank: 3, name: "Missing University", state: "ZZ" },
            ]),
        });
      }
      if (url.includes("/api/generate")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ plan: SAMPLE_STUDY_PLAN }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    cleanup();
  });

  it("shows the hero state for a first-time visitor", async () => {
    renderApp();

    expect(await screen.findByText(/NakedProfessor/i)).toBeInTheDocument();
    expect(screen.getByText(/Start by picking a professor/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Search for a school in Setup, then choose a professor to unlock the workflow/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Jump to Setup$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send magic link/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Search school/i }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/Select a school first/i)).toBeDisabled();
    expect(screen.getByText(/No school selected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: choose a school to begin/i)).toBeInTheDocument();
    const stepper = screen.getByRole("navigation", { name: /Stage progress/i });
    const stepperButtons = within(stepper).getAllByRole("button");
    expect(stepperButtons[0]).toBeDisabled();
    expect(stepperButtons[1]).toBeDisabled();
    expect(stepperButtons[2]).toBeDisabled();
  });

  it("exchanges callback codes from email sign-in links", async () => {
    window.history.replaceState({}, "", "/?code=email-code&type=magiclink");
    supabaseState.exchangeCodeForSession.mockImplementationOnce(async () => {
      supabaseState.state.currentUser = {
        id: "user-1",
        email: "arjun@psu.edu",
        user_metadata: { full_name: "Arjun" },
      };
      return { data: {}, error: null };
    });

    renderApp();

    expect(await screen.findByText(/Signed in as arjun@psu.edu/i)).toBeInTheDocument();
    expect(supabaseState.exchangeCodeForSession).toHaveBeenCalledWith("email-code");
    expect(window.location.search).toBe("");
  });

  it("shows redirect errors from invalid magic links", async () => {
    window.history.replaceState(
      {},
      "",
      "/?error_description=Magic+link+is+invalid+or+has+expired"
    );

    renderApp();

    expect(
      await screen.findByText(/Magic link is invalid or has expired/i)
    ).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("shows ranked schools without rosters and exposes the empty state", async () => {
    renderApp();

    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Missing University/i }));
    expect(screen.getByText(/This ranked school does not have a professor roster yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: choose a school with a roster/i)).toBeInTheDocument();
  });

  it("activates Reality Check after school and professor selection", async () => {
    renderApp();

    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Test University/i }));
    expect(screen.getByRole("combobox", { name: /Search professor/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/i }));
    expect(await screen.findByText(/Common risks/i)).toBeInTheDocument();
    expect(await screen.findByText(/Fatigue at root/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Jane Doe/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mathematics · Test University/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Next: add your syllabus to generate a plan/i)).toBeInTheDocument();
  });

  it("supports fuzzy alias search and keyboard selection", async () => {
    renderApp();

    const schoolInput = await screen.findByRole("combobox", { name: /Search school/i });
    fireEvent.change(schoolInput, { target: { value: "tu" } });
    fireEvent.keyDown(schoolInput, { key: "Enter" });

    const professorInput = screen.getByRole("combobox", { name: /Search professor/i });
    expect(professorInput).toBeEnabled();

    fireEvent.change(professorInput, { target: { value: "jdoe" } });
    fireEvent.keyDown(professorInput, { key: "ArrowDown" });
    fireEvent.keyDown(professorInput, { key: "Enter" });

    expect(await screen.findByText(/Common risks/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Jane Doe/i).length).toBeGreaterThan(0);
  });

  it("matches school acronyms and professor compact last-first aliases", async () => {
    renderApp();

    const schoolInput = await screen.findByRole("combobox", { name: /Search school/i });
    fireEvent.change(schoolInput, { target: { value: "psb" } });
    expect(
      screen.getByRole("option", { name: /Pennsylvania State University - Behrend/i })
    ).toBeInTheDocument();
    fireEvent.keyDown(schoolInput, { key: "Enter" });

    const professorInput = screen.getByRole("combobox", { name: /Search professor/i });
    fireEvent.change(professorInput, { target: { value: "morganalex" } });
    expect(screen.getByRole("option", { name: /Alex Morgan/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Jamie Lee/i })).not.toBeInTheDocument();

    fireEvent.keyDown(professorInput, { key: "Enter" });

    expect(
      (await screen.findAllByText(/Computer Science · Pennsylvania State University - Behrend/i))
        .length
    ).toBeGreaterThan(0);
  });

  it("uses a mobile command palette with Escape focus restoration", async () => {
    matchMediaMatches = true;
    installMatchMediaMock();
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Open Setup/i }));
    const schoolLauncherLabel = await screen.findByText(/^Find a school$/i);
    const schoolLauncher = schoolLauncherLabel.closest("button");
    expect(schoolLauncher).not.toBeNull();
    fireEvent.click(schoolLauncher);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const paletteInput = screen.getByRole("combobox");
    fireEvent.change(paletteInput, { target: { value: "tu" } });
    fireEvent.keyDown(paletteInput, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(schoolLauncher).toHaveFocus());
  });

  it("shows a deliberate Game Plan state before syllabus input", async () => {
    renderApp();

    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Build My Plan/i }));
    expect(screen.getByRole("heading", { name: /Add your syllabus/i })).toBeInTheDocument();
    expect(screen.getByText(/Effort vs grade simulator/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: add your syllabus to generate a plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Syllabus/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Generate Strategy$/i })).toBeDisabled();
  });

  it("progresses through all three stages", async () => {
    renderApp();

    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Build My Plan/i }));
    fireEvent.change(screen.getByPlaceholderText(/Grading:/i), {
      target: {
        value: "Grading: Midterm 30%, Final 40%, Homework 30%\nSchedule: Midterm Oct 14",
      },
    });
    const stepper = screen.getByRole("navigation", { name: /Stage progress/i });
    expect(screen.getByText(/Next: generate your weekly strategy/i)).toBeInTheDocument();
    expect(within(stepper).getAllByRole("button")[1]).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^Generate Strategy$/i }));

    expect(await screen.findByText("Plan alignment", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText(/Next: start tracking execution/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Start Tracking$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/✓ completed/i)).toHaveLength(2);
    expect(screen.getByText(/^Current$/i)).toBeInTheDocument();
  });

  it("falls back to guest device storage when Supabase env vars are absent", async () => {
    supabaseState.state.configured = false;

    renderApp();

    expect(await screen.findByText(/Guest mode is active/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send magic link/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Subject/i), {
      target: { value: "Calculus II" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save professor to subject/i }));

    expect(screen.getByText(/1 subject saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Calculus II/i })).toBeInTheDocument();

    cleanup();
    renderApp();

    expect(await screen.findByText(/1 subject saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Calculus II/i })).toBeInTheDocument();
  });

  it("saves multiple professors under one subject account", async () => {
    supabaseState.state.currentUser = {
      id: "user-1",
      email: "arjun@psu.edu",
      user_metadata: { full_name: "Arjun" },
    };

    renderApp();

    expect(await screen.findByRole("option", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Subject/i), {
      target: { value: "Calculus II" },
    });

    fireEvent.click(screen.getByRole("option", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save professor to subject/i }));

    fireEvent.click(screen.getByRole("option", { name: /John Smith/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save professor to subject/i }));

    expect(screen.getByText(/1 subject saved to your account/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed in as arjun@psu.edu/i)).toBeInTheDocument();
    const subjectButton = screen.getByRole("button", { name: /Calculus II/i });
    const subjectCard = subjectButton.closest("article");
    expect(subjectCard).not.toBeNull();
    expect(within(subjectCard).getByRole("button", { name: /^Jane Doe$/i })).toBeInTheDocument();
    expect(within(subjectCard).getByRole("button", { name: /^John Smith$/i })).toBeInTheDocument();
    expect(screen.getByText(/2 teachers/i)).toBeInTheDocument();

    cleanup();
    renderApp();

    expect(await screen.findByText(/1 subject saved to your account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Calculus II/i })).toBeInTheDocument();
  });
});
