import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutinesView } from "./RoutinesView";
import * as api from "../lib/hermesApi";

vi.mock("../lib/hermesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/hermesApi")>();
  return {
    ...actual,
    fetchCronJobs: vi.fn(),
    fetchCronJobRuns: vi.fn(),
    pauseCronJob: vi.fn(),
    resumeCronJob: vi.fn(),
    triggerCronJob: vi.fn(),
  };
});

describe("RoutinesView safety guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchCronJobs).mockResolvedValue([
      {
        id: "job-mika-mail",
        profile: "mika",
        name: "Mika: Wichtige Mails melden",
        schedule_display: "09:00, 13:00, 18:00 Europe/Berlin",
        enabled: false,
        state: "paused",
        deliver: "local",
      },
    ]);
  });

  it("displays paused routines honestly and requires explicit confirmation before resuming", async () => {
    render(
      <RoutinesView
        profiles={[
          {
            name: "mika",
            is_default: false,
            model: "gpt-6.1-terra",
            provider: "openai",
            has_env: true,
            skill_count: 2,
            gateway_running: true,
            description: "E-Mail-Assistentin",
            display_name: "Mika",
            bot_title: "Mika",
          },
        ]}
      />
    );

    expect(await screen.findByText("Mika: Wichtige Mails melden")).toBeInTheDocument();
    expect(screen.getByText("Pausiert")).toBeInTheDocument();

    // Tapping "Aktivieren…" must NOT call resumeCronJob directly; it must show the warning confirmation sheet
    fireEvent.click(screen.getByRole("button", { name: /Aktivieren/i }));
    expect(api.resumeCronJob).not.toHaveBeenCalled();
    expect(screen.getByText("Routine wirklich aktivieren?")).toBeInTheDocument();

    // Cancelling leaves the routine untouched
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => {
      expect(screen.queryByText("Routine wirklich aktivieren?")).not.toBeInTheDocument();
    });
    expect(api.resumeCronJob).not.toHaveBeenCalled();
  });
});
