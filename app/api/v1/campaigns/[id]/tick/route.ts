import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNextForCampaign } from "@/lib/campaigns/worker";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/campaigns/[id]/tick — Força o disparo do próximo contato elegível da campanha (para teste ou avanço manual).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const orgId = authz.org.orgId;
  const pool = getRequestPool();
  const admin = createAdminClient();

  try {
    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      channel_session_id: string;
      message_body: string;
      teto_diario: number;
      intervalo_segundos: number;
      janela_inicio_hora: number;
      janela_fim_hora: number;
      pipeline_id: string | null;
      stage_id: string | null;
      agent_id: string | null;
    }>(
      `
      SELECT 
        id, organization_id, name, channel_session_id, message_body,
        coalesce(teto_diario, 25) as teto_diario,
        coalesce(intervalo_segundos, 1200) as intervalo_segundos,
        coalesce(janela_inicio_hora, 9) as janela_inicio_hora,
        coalesce(janela_fim_hora, 18) as janela_fim_hora,
        pipeline_id, stage_id, agent_id
      FROM public.campaigns
      WHERE id = $1 AND organization_id = $2
      `,
      [id, orgId],
    );

    const campaign = rows[0];
    if (!campaign) {
      return fail("not_found", "Campanha não encontrada.", 404, { requestId });
    }

    // Passamos um horário simulado no meio do expediente para permitir disparo de teste sob demanda
    const simulatedTime = {
      hora: 12,
      minuto: 0,
      diaSemana: 2, // Terça
      dataStr: new Date().toISOString().slice(0, 10),
    };

    // Temporariamente zeramos o intervalo para permitir disparo manual
    const campaignForManualTick = {
      ...campaign,
      intervalo_segundos: 0,
    };

    const res = await dispatchNextForCampaign(pool, admin, campaignForManualTick, simulatedTime);

    return ok({ result: res }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail("internal_error", `Falha ao disparar contato da campanha: ${msg}`, 500, {
      requestId,
    });
  }
}
