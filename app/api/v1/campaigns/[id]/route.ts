import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";

export const dynamic = "force-dynamic";

const patchCampaignSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(["running", "paused", "cancelled"]).optional(),
  teto_diario: z.number().int().min(1).max(1000).optional(),
  intervalo_segundos: z.number().int().min(60).max(86400).optional(),
  janela_inicio_hora: z.number().int().min(0).max(23).optional(),
  janela_fim_hora: z.number().int().min(1).max(24).optional(),
  message_body: z.string().min(5).max(4000).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/campaigns/[id] — Retorna detalhes e últimos envios da campanha.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId });
  if (!authz.ok) return authz.response;

  const orgId = authz.org.orgId;
  const pool = getRequestPool();

  try {
    const { rows: campaigns } = await pool.query(`
      SELECT 
        c.*,
        cs.name as channel_name,
        p.name as pipeline_name,
        s.name as stage_name,
        count(cr.id)::int as total_recipients,
        count(cr.id) filter (where cr.status = 'sent')::int as sent_total,
        count(cr.id) filter (where cr.status = 'pending')::int as pending_total,
        count(cr.id) filter (where cr.status = 'failed')::int as failed_total,
        count(cr.id) filter (
          where cr.status = 'sent' 
          and cr.sent_at >= (now() at time zone 'America/Sao_Paulo')::date at time zone 'America/Sao_Paulo'
        )::int as sent_today,
        max(cr.sent_at) as last_sent_at
      FROM public.campaigns c
      LEFT JOIN public.channel_sessions cs ON cs.id = c.channel_session_id
      LEFT JOIN public.crm_pipelines p ON p.id = c.pipeline_id
      LEFT JOIN public.crm_stages s ON s.id = c.stage_id
      LEFT JOIN public.campaign_recipients cr ON cr.campaign_id = c.id
      WHERE c.id = $1 AND c.organization_id = $2
      GROUP BY c.id, cs.name, p.name, s.name
    `, [id, orgId]);

    const campaign = campaigns[0];
    if (!campaign) {
      return fail("not_found", "Campanha não encontrada.", 404, { requestId });
    }

    // Busca os 20 destinatários mais recentes
    const { rows: recentRecipients } = await pool.query(`
      SELECT 
        cr.id, cr.status, cr.recipient_address, cr.sent_at, cr.last_error_code, cr.last_error_detail,
        co.display_name as contact_name
      FROM public.campaign_recipients cr
      LEFT JOIN public.contacts co ON co.id = cr.contact_id
      WHERE cr.campaign_id = $1
      ORDER BY cr.sent_at DESC NULLS LAST, cr.created_at ASC
      LIMIT 20
    `, [id]);

    return ok({ campaign, recent_recipients: recentRecipients }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail("internal_error", `Falha ao carregar campanha: ${msg}`, 500, { requestId });
  }
}

/**
 * PATCH /api/v1/campaigns/[id] — Pausa, retoma ou altera configurações da campanha.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const orgId = authz.org.orgId;
  const body = await req.json().catch(() => null);
  const parsed = patchCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const data = parsed.data;
  const pool = getRequestPool();

  try {
    const updates: string[] = [];
    const values: unknown[] = [id, orgId];
    let idx = 3;

    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(data.status);
      if (data.status === "running") {
        updates.push(`started_at = coalesce(started_at, now())`);
        updates.push(`paused_at = null`);
      } else if (data.status === "paused") {
        updates.push(`paused_at = now()`);
      } else if (data.status === "cancelled") {
        updates.push(`cancelled_at = now()`);
      }
    }
    if (data.teto_diario !== undefined) {
      updates.push(`teto_diario = $${idx++}`);
      values.push(data.teto_diario);
    }
    if (data.intervalo_segundos !== undefined) {
      updates.push(`intervalo_segundos = $${idx++}`);
      values.push(data.intervalo_segundos);
    }
    if (data.janela_inicio_hora !== undefined) {
      updates.push(`janela_inicio_hora = $${idx++}`);
      values.push(data.janela_inicio_hora);
    }
    if (data.janela_fim_hora !== undefined) {
      updates.push(`janela_fim_hora = $${idx++}`);
      values.push(data.janela_fim_hora);
    }
    if (data.message_body !== undefined) {
      updates.push(`message_body = $${idx++}`);
      values.push(data.message_body);
      updates.push(`content_version = content_version + 1`);
    }

    if (updates.length === 0) {
      return fail("bad_request", "Nenhum campo para atualizar.", 400, { requestId });
    }

    updates.push("updated_at = now()");

    const { rows } = await pool.query(
      `
      UPDATE public.campaigns
      SET ${updates.join(", ")}
      WHERE id = $1 AND organization_id = $2
      RETURNING id, name, status, teto_diario, intervalo_segundos, janela_inicio_hora, janela_fim_hora, updated_at
      `,
      values,
    );

    if (rows.length === 0) {
      return fail("not_found", "Campanha não encontrada.", 404, { requestId });
    }

    await audit({
      action: "campaigns.updated",
      resourceType: "campaign",
      resourceId: id,
      organizationId: orgId,
      userId: authz.user.id,
      requestId,
      metadata: data,
    });

    return ok({ campaign: rows[0] }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail("internal_error", `Falha ao atualizar campanha: ${msg}`, 500, { requestId });
  }
}
