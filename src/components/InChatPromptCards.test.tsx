// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalPromptCard,
  ClarifyPromptCard,
  SecretPromptCard,
} from "./InChatPromptCards";

afterEach(() => {
  cleanup();
});

describe("InChatPromptCards", () => {
  it("renders a clickable Yes/No Clarify card and submits Hermes ClarifyResult shape", () => {
    const onSubmit = vi.fn();
    render(
      <ClarifyPromptCard
        botLabel="Mika"
        request={{
          id: "req-1",
          method: "clarify",
          params: {
            session_id: "s1",
            questions: [
              {
                qid: "q_send",
                question: "Soll ich diese Zusammenfassung speichern?",
                choices: ["Ja", "Nein"],
                multi_select: false,
              },
            ],
          },
        }}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText("Soll ich diese Zusammenfassung speichern?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    expect(onSubmit).toHaveBeenCalledWith({ q_send: "Ja" }, "submitted");
  });

  it("renders an Approval card with clickable allow and deny buttons", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalPromptCard
        botLabel="Technik"
        approval={{
          request_id: "appr-1",
          kind: "command",
          command: "systemctl status nginx",
          description: "Status prüfen",
          allow_session: true,
        }}
        onDecide={onDecide}
      />
    );

    expect(screen.getByText("systemctl status nginx")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Ja, einmal erlauben/i }));
    });
    expect(onDecide).toHaveBeenCalledWith("once");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Nein, ablehnen/i }));
    });
    expect(onDecide).toHaveBeenCalledWith("deny");
  });

  it("renders a masked Secret prompt card and submits/cancels cleanly", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <SecretPromptCard
        botLabel="Nina"
        request={{
          id: "sec-1",
          method: "secret",
          params: {
            session_id: "s1",
            env_var: "BRAVE_API_KEY",
            prompt: "API-Key für die Websuche",
          },
        }}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    const input = screen.getByPlaceholderText(/BRAVE_API_KEY/i) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "test-secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: /Sicher senden/i }));
    expect(onSubmit).toHaveBeenCalledWith("test-secret-value");
    expect(input.value).toBe("");
  });
});
