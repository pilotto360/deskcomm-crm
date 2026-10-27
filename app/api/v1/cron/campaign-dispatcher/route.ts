import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { ok, fail } from "@/lib/api/wrappers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { createAdminClient } from "@/lib/supabase/admin";
import { tickCampaigns } from "@/lib/campaigns/worker";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const requestId = randomUUID();
  const value = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (!value || !accepted.includes(value)) {
    return fail("forbidden", "Credencial de execução de cron inválida.", 403, { requestId });
  }

  try {
    const results = await tickCampaigns(getRequestPool(), createAdminClient());
    return ok({ results }, { requestId });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[campaign-dispatcher.cron] Falha ao rodar tickCampaigns", {
      error: detalhe,
      requestId,
    });
    return fail("internal_error", detalhe, 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
