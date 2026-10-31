"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { locales } from "@/lib/i18n";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const voteRequestSchema = z.object({
  submissionId: z.uuid(),
  intent: z.enum(["cast", "revoke"]),
});

export type VoteActionResult = { ok: true } | { ok: false; errorCode?: string };

export async function changeVote(input: unknown): Promise<VoteActionResult> {
  const parsed = voteRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createServerSupabaseClient();
  const result = parsed.data.intent === "cast"
    ? await supabase.rpc("cast_vote", { p_submission_id: parsed.data.submissionId })
    : await supabase.rpc("revoke_vote", { p_submission_id: parsed.data.submissionId });

  if (result.error) return { ok: false, errorCode: result.error.code };
  // A galeria fica em cache: sem isto, a contagem volta atrasada e o botão parte de um número errado.
  for (const locale of locales) revalidatePath(`/${locale}`);
  return { ok: true };
}
