import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const SAMPLE_CSV = `school_rank,school_name,school_id,school_state,professor_id,professor_legacy_id,professor_first,professor_last,department,avg_rating,avg_difficulty,would_take_again_percent,num_ratings,profile_url
,Test University,T1,ST,TProf1,1,Jane,Doe,Mathematics,4.2,3.4,72,15,https://example.com`;

describe("NakedProfessor app", () => {
  beforeEach(() => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("top_colleges")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { rank: 1, name: "Test University", state: "ST" },
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
  });

  it("loads professor data, shows Reality Check failure stack and navigates modes", async () => {
    render(<App />);

    expect(await screen.findByText(/NakedProfessor/i)).toBeInTheDocument();
    expect(await screen.findByText(/Failure stack/i)).toBeInTheDocument();
    expect(await screen.findByText(/Fatigue at root/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Game Plan/i }));
    expect(screen.getByText(/Effort vs grade simulator/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Execution Hub/i }));
    expect(screen.getByText("Plan alignment")).toBeInTheDocument();
  });
});
