import type { HermesPendingApproval, HermesServerRequest } from "../../shared/types";

/**
 * A resume/create snapshot lists the prompt that is currently open. Hermes reports both
 * permission approvals and bot questions (`clarify`) there. Showing a question as an
 * approval card gives buttons that answer nothing, so split them.
 */
export function splitSnapshotPrompt(prompt: HermesPendingApproval | null | undefined): {
  approval: HermesPendingApproval | null;
  clarify: HermesServerRequest | null;
} {
  if (!prompt) return { approval: null, clarify: null };
  if (prompt.kind !== "clarify") return { approval: prompt, clarify: null };
  const id = prompt.prompt_id || prompt.request_id || prompt.id || "snapshot-clarify";
  const question = typeof prompt.question === "string" ? prompt.question : prompt.description;
  return {
    approval: null,
    clarify: {
      id,
      method: "clarify",
      params: {
        question: typeof question === "string" && question.trim() ? question : "Rückfrage des Bots",
        choices: Array.isArray(prompt.choices) ? prompt.choices : [],
        multi_select: Boolean(prompt.multi_select),
        __snapshot: true,
      },
    },
  };
}
