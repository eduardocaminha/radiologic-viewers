import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeVote } from "@/app/[locale]/v/[slug]/actions";

const { revalidatePath, rpc } = vi.hoisted(() => ({ revalidatePath: vi.fn(), rpc: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc }) }));

const submissionId = "77777777-7777-4777-8777-777777777777";

describe("changeVote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renova a galeria dos três idiomas depois do voto", async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(changeVote({ submissionId, intent: "cast" })).resolves.toEqual({ ok: true });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/pt", "/en", "/es"]);
  });

  it("não renova a galeria quando o voto falha", async () => {
    rpc.mockResolvedValue({ error: { code: "VOT02" } });
    await expect(changeVote({ submissionId, intent: "revoke" })).resolves.toEqual({ ok: false, errorCode: "VOT02" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
