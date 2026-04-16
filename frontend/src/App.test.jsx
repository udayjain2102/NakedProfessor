import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseState = vi.hoisted(() => {
  const state = { currentUser: null };
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
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
});

vi.mock("./lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: supabaseState.getSession,
      onAuthStateChange: supabaseState.onAuthStateChange,
      signInWithOAuth: supabaseState.signInWithOAuth,
      signInWithOtp: supabaseState.signInWithOtp,
      signOut: supabaseState.signOut,
    },
  },
}));

import App from "./App";

const SAMPLE_CSV = `school_rank,school_name,school_id,school_state,professor_id,professor_legacy_id,professor_first,professor_last,department,avg_rating,avg_difficulty,would_take_again_percent,num_ratings,profile_url
,Test University,T1,ST,TProf1,1,Jane,Doe,Mathematics,4.2,3.4,72,15,https://example.com
,Test University,T1,ST,TProf2,2,John,Smith,Mathematics,3.8,3.6,61,11,https://example.com/john`;

describe("NakedProfessor app", () => {
  beforeEach(() => {
    supabaseState.state.currentUser = null;
    supabaseState.getSession.mockClear();
    supabaseState.onAuthStateChange.mockClear();
    supabaseState.signInWithOAuth.mockClear();
    supabaseState.signInWithOtp.mockClear();
    supabaseState.signOut.mockClear();
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("top_colleges")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { rank: 1, name: "Test University", state: "ST" },
              { rank: 2, name: "Missing University", state: "ZZ" },
            ]),
        });
      }
      return Promise.resolve({
        text: () => Promise.resolve(SAMPLE_CSV),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    cleanup();
  });

  it("shows the hero state for a first-time visitor", async () => {
    render(<App />);

    expect(await screen.findByText(/NakedProfessor/i)).toBeInTheDocument();
    expect(screen.getByText(/Start by choosing a university/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Professor search unlocks after the university is selected/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Choose A University$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send magic link/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Search school/i }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/Choose a university first/i)).toBeDisabled();
    expect(screen.getByText(/Choose a school to load its professor roster/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: choose a university to begin/i)).toBeInTheDocument();
    const stepper = screen.getByRole("navigation", { name: /Stage progress/i });
    const stepperButtons = within(stepper).getAllByRole("button");
    expect(stepperButtons[0]).toBeDisabled();
    expect(stepperButtons[1]).toBeDisabled();
    expect(stepperButtons[2]).toBeDisabled();
  });

  it("hides schools without roster data from setup", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: /Test University/i })).toBeInTheDocument();
    expect(screen.queryByText(/Missing University/i)).not.toBeInTheDocument();
  });

  it("activates Reality Check after school and professor selection", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test University/i }));
    expect(screen.getByRole("textbox", { name: /Search professor/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Jane Doe/i }));
    expect(await screen.findByText(/Common risks/i)).toBeInTheDocument();
    expect(await screen.findByText(/Fatigue at root/i)).toBeInTheDocument();
    expect(screen.getByText(/Selected context/i)).toBeInTheDocument();
    expect(screen.getByText(/Mathematics · Test University/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: add your syllabus to generate a plan/i)).toBeInTheDocument();
  });

  it("shows a deliberate Game Plan state before syllabus input", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("button", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Build My Plan/i }));
    expect(screen.getByRole("heading", { name: /Add your syllabus/i })).toBeInTheDocument();
    expect(screen.getByText(/Effort vs grade simulator/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: add your syllabus to generate a plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Syllabus/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Generate Strategy$/i })).toBeDisabled();
  });

  it("progresses through all three stages", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("button", { name: /Jane Doe/i }));
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
    expect(screen.getByText(/Next: start tracking execution/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Start Tracking$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/✓ completed/i)).toHaveLength(2);
  });

  it("saves multiple professors under one subject account", async () => {
    supabaseState.state.currentUser = {
      id: "user-1",
      email: "arjun@psu.edu",
      user_metadata: { full_name: "Arjun" },
    };

    render(<App />);

    expect(await screen.findByRole("button", { name: /Test University/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Subject/i), {
      target: { value: "Calculus II" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Test University/i }));
    fireEvent.click(screen.getByRole("button", { name: /Jane Doe/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save professor to subject/i }));

    fireEvent.click(screen.getByRole("button", { name: /John Smith/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save professor to subject/i }));

    expect(screen.getByText(/1 subject saved on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed in as arjun@psu.edu/i)).toBeInTheDocument();
    const subjectButton = screen.getByRole("button", { name: /Calculus II/i });
    const subjectCard = subjectButton.closest("article");
    expect(subjectCard).not.toBeNull();
    expect(within(subjectCard).getByRole("button", { name: /^Jane Doe$/i })).toBeInTheDocument();
    expect(within(subjectCard).getByRole("button", { name: /^John Smith$/i })).toBeInTheDocument();
    expect(screen.getByText(/2 teachers/i)).toBeInTheDocument();
  });
});
