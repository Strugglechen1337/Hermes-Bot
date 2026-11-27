// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hermesApi from "../lib/hermesApi";
import { PagesArchiveSheet } from "./PagesArchiveSheet";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PagesArchiveSheet", () => {
  it("lists public bot briefings, hides private-bot pages, and opens the sandboxed viewer", async () => {
    vi.spyOn(hermesApi, "fetchPocketPages").mockResolvedValue([
      {
        id: "morgen-20261127-abc123",
        title: "Dein Morgenüberblick",
        summary: "Wetter, Termine & News",
        bot: "nova-chief",
        createdAt: Date.now(),
      },
      {
        id: "secret-20261127-def456",
        title: "Versteckte Seite",
        summary: "Nur im Privaten Bereich",
        bot: "private-bot",
        createdAt: Date.now(),
      },
    ]);

    render(
      <PagesArchiveSheet
        open
        profiles={[]}
        privateProfileNames={["private-bot"]}
        avatars={{}}
        onClose={() => undefined}
      />
    );

    expect(await screen.findByText("Dein Morgenüberblick")).toBeInTheDocument();
    expect(screen.queryByText("Versteckte Seite")).toBeNull();
    expect(screen.getByRole("button", { name: /Dein Morgenüberblick.*teilen/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dein Morgenüberblick"));
    expect(screen.getByRole("dialog", { name: "Dein Morgenüberblick" })).toBeInTheDocument();
  });
});
