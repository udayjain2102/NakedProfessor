import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("app ui", () => {
  it("navigates between screens and runs analysis from the brief screen", () => {
    render(<App />);

    expect(screen.getAllByText("Input studio").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(screen.getAllByText("Signal board").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /risks/i }));
    expect(screen.getAllByText("Failure stack").length).toBeGreaterThan(0);
    expect(screen.getByText(/Fatigue at root/i)).toBeInTheDocument();
  });
});
