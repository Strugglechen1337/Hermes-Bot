// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotRoutinesSheet } from "./BotRoutinesSheet";

vi.mock("../lib/hermesApi", () => ({
  fetchCronJobs: vi.fn(async () => [
    {
      id: "job-1",
      name: "Morgen-Briefing",
      schedule_display: "An Werktagen gegen 07:00",
      enabled: false,
      profile: "clara-it",
    },
    {
      id: "job-2",
      name: "Server-Check",
      schedule_display: "Jeden Sonntag gegen 10:00",
      enabled: true,
      profile: "clara-it",
    },
  ]),
  pauseCronJob: vi.fn(async () => ({ ok: true })),
  resumeCronJob: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BotRoutinesSheet", () => {
  it("lists per-bot routines, pauses active ones directly, and requires confirmation to activate paused ones", async () => {
    const api = await import("../lib/hermesApi");
    render(
      <BotRoutinesSheet
        open={true}
        profileName="clara-it"
        botLabel="Clara"
        onClose={() => {}}
      />
    );

    expect(await screen.findByText("Morgen-Briefing")).toBeInTheDocument();
    expect(screen.getByText("Server-Check")).toBeInTheDocument();

    // Pause active routine immediately
    const pauseSwitch = screen.getByRole("switch", { name: "Server-Check pausieren" });
    fireEvent.click(pauseSwitch);
    await waitFor(() => {
      expect(api.pauseCronJob).toHaveBeenCalledWith("job-2", "clara-it");
    });

    // Activating a paused routine must show explicit confirmation first
    const enableSwitch = screen.getByRole("switch", { name: "Morgen-Briefing aktivieren" });
    fireEvent.click(enableSwitch);
    expect(api.resumeCronJob).not.toHaveBeenCalled();
    expect(await screen.findByText("Routine aktivieren?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ja, aktivieren" }));
    await waitFor(() => {
      expect(api.resumeCronJob).toHaveBeenCalledWith("job-1", "clara-it");
    });
  });
});
