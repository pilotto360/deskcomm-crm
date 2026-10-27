import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";

export const dynamic = "force-dynamic";

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(1000).optional(),
  channel_session_id: z.string().uuid(),
  message_body: z.string().min(5).max(4000),
  tag: z.string().min(1),
  teto_diario: z.number().int().min(1).max(1000).default(25),
  intervalo_segundos: z.number().int().min(60).max(86400).default(1200),
  janela_inicio_hora: z.number().int().min(0).max(23).default(9),
  janela_fim_hora: z.number().int().min(1).max(24).default(18),
  pipeline_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  auto_start: z.boolean().default(true),
});

/**
 * GET /api/v1/campaigns — Lista as campanhas da organização ativa com contadores e progresso.
 */
export async function GET(req: NextRequest) {
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
      WHERE c.organization_id = $1
      GROUP BY c.id, cs.name, p.name, s.name
      ORDER BY c.created_at DESC
    `, [orgId]);

    return ok({ campaigns }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail("internal_error", `Falha ao listar campanhas: ${msg}`, 500, { requestId });
  }
}

/**
 * POST /api/v1/campaigns — Cria uma nova campanha e popula a lista de destinatários pela tag.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const orgId = authz.org.orgId;
  const body = await req.json().catch(() => null);
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos para criar campanha.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const data = parsed.data;
  const pool = getRequestPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Busca contatos que possuem a tag especificada e telefone
    const contactsRes = await client.query<{
      id: string;
      phone_number: string;
    }>(
      `
      SELECT id, phone_number
      FROM public.contacts
      WHERE organization_id = $1 
        AND phone_number IS NOT NULL 
        AND btrim(phone_number) <> ''
        AND $2 = ANY(tags)
      ORDER BY created_at ASC
      `,
      [orgId, data.tag],
    );

    const eligibleContacts = contactsRes.rows;
    const initialStatus = data.auto_start ? "running" : "draft";

    // 2. Insere a campanha
    const campRes = await client.query<{ id: string }>(
      `
      INSERT INTO public.campaigns (
        organization_id,
        name,
        description,
        status,
        channel_session_id,
        message_body,
        base_legal,
        lia_ref,
        audience_filter,
        intervalo_segundos,
        janela_inicio_hora,
        janela_fim_hora,
        teto_diario,
        pipeline_id,
        stage_id,
        agent_id,
        snapshot_total,
        snapshot_eligible,
        started_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'legitimate_interest', 'LIA-REATIVACAO',
        $7, $8, $9, $10, $11, $12, $13, $14, $15, $15,
        CASE WHEN $4 = 'running' THEN now() ELSE null END,
        now(), now()
      )
      RETURNING id
      `,
      [
        orgId,
        data.name,
        data.description ?? null,
        initialStatus,
        data.channel_session_id,
        data.message_body,
        JSON.stringify({ tag: data.tag }),
        data.intervalo_segundos,
        data.janela_inicio_hora,
        data.janela_fim_hora,
        data.teto_diario,
        data.pipeline_id ?? null,
        data.stage_id ?? null,
        data.agent_id ?? null,
        eligibleContacts.length,
      ],
    );

    const campaignId = campRes.rows[0]!.id;

    // 3. Popula os destinatários em lote
    if (eligibleContacts.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < eligibleContacts.length; i += batchSize) {
        const chunk = eligibleContacts.slice(i, i + batchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        chunk.forEach((c, idx) => {
          const offset = idx * 5;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
          values.push(orgId, campaignId, c.id, c.phone_number, "pending");
        });

        await client.query(
          `
          INSERT INTO public.campaign_recipients (
            organization_id, campaign_id, contact_id, recipient_address, status
          ) VALUES ${placeholders.join(", ")}
          `,
          values,
        );
      }
    }

    await client.query("COMMIT");

    await audit({
      action: "campaigns.created",
      resourceType: "campaign",
      resourceId: campaignId,
      organizationId: orgId,
      userId: authz.user.id,
      requestId,
      metadata: {
        name: data.name,
        tag: data.tag,
        eligible_count: eligibleContacts.length,
        status: initialStatus,
      },
    });

    return ok(
      {
        id: campaignId,
        name: data.name,
        status: initialStatus,
        total_recipients: eligibleContacts.length,
      },
      { requestId, status: 201 },
    );
  } catch (err) {
    await client.query("ROLLBACK");
    const msg = err instanceof Error ? err.message : String(err);
    return fail("internal_error", `Falha ao criar campanha: ${msg}`, 500, { requestId });
  } finally {
    client.release();
  }
}
