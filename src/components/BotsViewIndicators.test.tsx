// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HermesProfile } from "../../shared/types";
import { BotsView } from "./BotsView";

function makeProfile(
  name: string,
  title: string,
  pocketMeta?: Record<string, unknown>
): HermesProfile {
  return {
    name,
    is_default: name === "default",
    model: "claude-sonnet-4",
    provider: "anthropic",
    has_env: true,
    skill_count: 1,
    gateway_running: true,
    description: `Beschreibung für ${title}`,
    display_name: title,
    bot_title: title,
    ...(pocketMeta ? { ui_meta: { "hermes-pocket": pocketMeta } } : {}),
  };
}

describe("BotsView unread indicators and Chief showcase", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Chief and pinned bots in the top showcase with star & unread badges, and unread badges on list items", () => {
    const onSelectBot = vi.fn();
    const profiles = [
      makeProfile("nova", "Nova Chief", { chief: true }),
      makeProfile("mika", "Mika", { pinned: true }),
      makeProfile("lena", "Lena Kalender"),
    ];

    render(
      <BotsView
        profiles={profiles}
        avatars={{}}
        unreadByBot={{
          nova: {
            count: 2,
            latestTimestampMs: Date.now(),
            preview: "Ich habe alles vorbereitet.",
          },
          lena: {
            count: 1,
            latestTimestampMs: Date.now(),
            preview: "Termin um 15 Uhr steht!",
          },
        }}
        loading={false}
        error={null}
        wsState="connected"
        selectedBotName={null}
        onSelectBot={onSelectBot}
        onRefreshProfiles={() => undefined}
        onAvatarChange={() => undefined}
      />
    );

    // Chief showcase contains Nova Chief (with unread count 2) & Mika
    const showcase = screen.getByLabelText("Chef und angeheftete Bots");
    expect(showcase).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Nova Chief \(Chef\) – 2 neue Nachrichten/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mika" })).toBeInTheDocument();

    // Non-showcase bot Lena shows unread preview & badge count 1 in the list below
    expect(screen.getByText("Termin um 15 Uhr steht!")).toBeInTheDocument();
    expect(screen.getByLabelText("1 neue Nachricht")).toHaveTextContent("1");

    // Clicking Nova opens her chat
    fireEvent.click(
      screen.getByRole("button", { name: /Nova Chief \(Chef\) – 2 neue Nachrichten/i })
    );
    expect(onSelectBot).toHaveBeenCalledWith("nova");
  });

  it("allows marking any bot as Chief directly from the bot list manage menu (⋯)", async () => {
    const profiles = [
      makeProfile("nova", "Nova"),
      makeProfile("mika", "Mika"),
    ];

    render(
      <BotsView
        profiles={profiles}
        avatars={{}}
        loading={false}
        error={null}
        wsState="disconnected"
        selectedBotName={null}
        onSelectBot={() => undefined}
        onRefreshProfiles={() => undefined}
        onAvatarChange={() => undefined}
      />
    );

    // Open manage sheet from the bot list row
    fireEvent.click(screen.getByRole("button", { name: "Nova verwalten" }));

    const chiefBtn = await screen.findByRole("button", { name: /Als Chef oben markieren/i });
    expect(chiefBtn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Oben anheften/i })).toBeInTheDocument();

    fireEvent.click(chiefBtn);

    // Nova is now promoted to the top Chief showcase
    expect(screen.getByLabelText("Chef und angeheftete Bots")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova (Chef)" })).toBeInTheDocument();
  });
});
