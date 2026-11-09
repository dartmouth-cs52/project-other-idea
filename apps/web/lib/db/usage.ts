import "server-only";
import type { TurnRequest } from "@haptic/protocol";
import type { SessionClaims } from "../sessionToken";
import { createAdminClient } from "../supabase/admin";

export interface TurnRecord {
  model: string;
  firstTokenMs: number;
  firstPointMs: number;
  raw: string;
  inputTokens: number;
  outputTokens: number;
  outcome: string;
  invalidPoints: number;
}

/** First successful SDK session flips the dashboard to "Installed". */
export async function markInstalled(siteId: string, origin: string): Promise<void> {
  await createAdminClient()
    .from("sites")
    .update({ installed_at: new Date().toISOString(), installed_origin: origin })
    .eq("id", siteId)
    .is("installed_at", null);
}

export async function recordTurn(claims: SessionClaims, turn: TurnRequest, record: TurnRecord): Promise<void> {
  const { error } = await createAdminClient().rpc("record_turn", {
    p_site: claims.siteId,
    p_org: claims.orgId,
    p_session: claims.sessionId,
    p_kind: turn.kind,
    // Customers see the questions their users ask. Continue turns carry no new question.
    p_question: (turn.kind === "ask" ? turn.question : turn.goal)?.slice(0, 500) ?? "",
    p_path: turn.snapshot.path,
    p_step: turn.step ?? 0,
    p_outcome: record.outcome,
    p_model: record.model,
    p_tokens_in: record.inputTokens,
    p_tokens_out: record.outputTokens,
    p_first_token_ms: record.firstTokenMs || 0,
    p_first_point_ms: record.firstPointMs || 0,
  });
  if (error) console.error("[haptic] recordTurn failed:", error.message);
}
