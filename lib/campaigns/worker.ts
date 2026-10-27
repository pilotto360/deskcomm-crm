import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { logger } from "@/lib/logger";

interface HorarioLocal {
  hora: number;
  minuto: number;
  diaSemana: number; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  dataStr: string; // YYYY-MM-DD
}

/** Retorna o horário atual no fuso horário do Brasil (America/Sao_Paulo). */
export function getHorarioSaoPaulo(now = new Date()): HorarioLocal {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    hora: parseInt(map.hour ?? "0", 10),
    minuto: parseInt(map.minute ?? "0", 10),
    diaSemana: weekdayMap[map.weekday ?? "Mon"] ?? 1,
    dataStr: `${map.year}-${map.month}-${map.day}`,
  };
}

/** Adiciona variação aleatória de jitter (anti-ban) ao intervalo base (±20%). */
export function calculaIntervaloComJitter(segundosBase: number): number {
  const variacao = segundosBase * 0.2; // 20%
  const jitter = (Math.random() * 2 - 1) * variacao;
  return Math.max(60, Math.round(segundosBase + jitter));
}

/** Extrai primeiro nome amigável a partir do display_name. */
export function extraiPrimeiroNome(nomeCompleto: string | null | undefined): string {
  if (!nomeCompleto) return "Amigo(a)";
  const primeiro = nomeCompleto.trim().split(/\s+/)[0] ?? "";
  if (!primeiro) return "Amigo(a)";
  // Capitaliza corretamente
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

export interface TickCampaignResult {
  campaignId: string;
  name: string;
  dispatched: boolean;
  reason?: string;
  recipientId?: string;
  phone?: string;
  contactName?: string;
}

/**
 * Executa uma rodada do motor de campanhas.
 * Verifica campanhas 'running' e dispara o próximo contato caso a janela, teto diário e intervalo permitam.
 */
export async function tickCampaigns(
  pool: pg.Pool,
  admin: SupabaseClient,
): Promise<TickCampaignResult[]> {
  const spTime = getHorarioSaoPaulo();
  const results: TickCampaignResult[] = [];

  // Busca campanhas ativas
  const { rows: campaigns } = await pool.query<{
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
  }>(`
    SELECT id, organization_id, name, channel_session_id, message_body,
           coalesce(teto_diario, 25) as teto_diario,
           coalesce(intervalo_segundos, 1200) as intervalo_segundos,
           coalesce(janela_inicio_hora, 9) as janela_inicio_hora,
           coalesce(janela_fim_hora, 18) as janela_fim_hora,
           pipeline_id, stage_id, agent_id
    FROM public.campaigns
    WHERE status = 'running'
    ORDER BY created_at ASC
  `);

  for (const c of campaigns) {
    try {
      const res = await dispatchNextForCampaign(pool, admin, c, spTime);
      results.push(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[campaigns.worker] Erro ao processar campanha", {
        campaignId: c.id,
        error: msg,
      });
      results.push({
        campaignId: c.id,
        name: c.name,
        dispatched: false,
        reason: `Erro: ${msg}`,
      });
    }
  }

  return results;
}

/**
 * Avalia e despacha o próximo contato de uma campanha específica.
 */
export async function dispatchNextForCampaign(
  pool: pg.Pool,
  admin: SupabaseClient,
  c: {
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
  },
  spTime = getHorarioSaoPaulo(),
): Promise<TickCampaignResult> {
  // 1. Validação de dia útil (Segunda a Sexta = 1 a 5)
  if (spTime.diaSemana === 0 || spTime.diaSemana === 6) {
    return {
      campaignId: c.id,
      name: c.name,
      dispatched: false,
      reason: "Fim de semana (campanha configurada para dias úteis).",
    };
  }

  // 2. Validação da janela de horário comercial
  if (spTime.hora < c.janela_inicio_hora || spTime.hora >= c.janela_fim_hora) {
    return {
      campaignId: c.id,
      name: c.name,
      dispatched: false,
      reason: `Fora da janela de envio (${c.janela_inicio_hora}h às ${c.janela_fim_hora}h). Hora atual: ${spTime.hora}h.`,
    };
  }

  // 3. Validação do teto diário
  const { rows: statsRows } = await pool.query<{
    enviados_hoje: number;
    ultimo_envio: Date | null;
  }>(
    `
    SELECT 
      count(*) filter (WHERE sent_at >= (now() at time zone 'America/Sao_Paulo')::date at time zone 'America/Sao_Paulo')::int as enviados_hoje,
      max(sent_at) as ultimo_envio
    FROM public.campaign_recipients
    WHERE campaign_id = $1 AND status = 'sent'
    `,
    [c.id],
  );

  const stats = statsRows[0] ?? { enviados_hoje: 0, ultimo_envio: null };
  if (stats.enviados_hoje >= c.teto_diario) {
    return {
      campaignId: c.id,
      name: c.name,
      dispatched: false,
      reason: `Teto diário atingido (${stats.enviados_hoje}/${c.teto_diario}). Próximo envio amanhã.`,
    };
  }

  // 4. Validação de intervalo com jitter anti-ban
  if (stats.ultimo_envio) {
    const elapsedSec = (Date.now() - new Date(stats.ultimo_envio).getTime()) / 1000;
    const requiredInterval = calculaIntervaloComJitter(c.intervalo_segundos);
    if (elapsedSec < requiredInterval) {
      const faltaMin = Math.ceil((requiredInterval - elapsedSec) / 60);
      return {
        campaignId: c.id,
        name: c.name,
        dispatched: false,
        reason: `Aguardando intervalo anti-ban (~${faltaMin} min restantes).`,
      };
    }
  }

  // 5. Seleciona o próximo destinatário pendente com lock pessimista
  const client = await pool.connect();
  let recipient: {
    id: string;
    contact_id: string;
    recipient_address: string | null;
  } | null = null;

  try {
    await client.query("BEGIN");

    const selRes = await client.query<{
      id: string;
      contact_id: string;
      recipient_address: string | null;
    }>(
      `
      SELECT id, contact_id, recipient_address
      FROM public.campaign_recipients
      WHERE campaign_id = $1 AND status = 'pending' AND eligibility_status = 'eligible'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
      `,
      [c.id],
    );

    if (selRes.rows.length === 0) {
      // Nenhum pendente restante -> campanha concluída!
      await client.query(
        `UPDATE public.campaigns SET status = 'completed', completed_at = now() WHERE id = $1`,
        [c.id],
      );
      await client.query("COMMIT");
      return {
        campaignId: c.id,
        name: c.name,
        dispatched: false,
        reason: "Todos os contatos da campanha foram processados. Campanha concluída!",
      };
    }

    recipient = selRes.rows[0]!;

    // Marca como enviando provisoriamente
    await client.query(
      `UPDATE public.campaign_recipients SET status = 'sending', last_attempt_at = now() WHERE id = $1`,
      [recipient.id],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // 6. Obtém dados do contato
  const { rows: contactRows } = await pool.query<{
    id: string;
    display_name: string | null;
    phone_number: string | null;
    tags: string[] | null;
  }>(
    `SELECT id, display_name, phone_number, tags FROM public.contacts WHERE id = $1`,
    [recipient.contact_id],
  );

  const contact = contactRows[0];
  if (!contact || !contact.phone_number) {
    await pool.query(
      `UPDATE public.campaign_recipients SET status = 'failed', last_error_code = 'NO_PHONE', last_error_detail = 'Contato sem telefone válido' WHERE id = $1`,
      [recipient.id],
    );
    return {
      campaignId: c.id,
      name: c.name,
      dispatched: false,
      reason: "Contato sem telefone válido.",
    };
  }

  // 7. Renderiza mensagem com {{primeiro_nome}}
  const primeiroNome = extraiPrimeiroNome(contact.display_name);
  let renderedText = c.message_body || "";
  renderedText = renderedText.replace(/{{\s*(primeiro_nome|nome)\s*}}/gi, primeiroNome);

  // 8. Abre a conversa no CRM pelo canal configurado
  const opened = await openSharedContactConversation(admin, c.organization_id, {
    channel_session_id: c.channel_session_id,
    contact_id: contact.id,
  });

  // 9. Envia a mensagem pelo WhatsApp
  const sentMsg = await sendMessageHandler(
    admin,
    {
      organization_id: c.organization_id,
      actor: c.agent_id
        ? { type: "ai_agent", id: `campaign:${c.id}`, agent_id: c.agent_id, role: "ai_operator" }
        : { type: "webhook_source", id: `campaign:${c.id}` },
      requestId: `campanha:${c.id}:${recipient.id}`,
    },
    {
      conversation_id: opened.conversation_id,
      type: "text",
      body: renderedText,
    },
  );

  // 10. Atualiza o status do destinatário para 'sent'
  await pool.query(
    `
    UPDATE public.campaign_recipients
    SET status = 'sent',
        message_id = $2,
        conversation_id = $3,
        rendered_body = $4,
        sent_at = now(),
        attempt_count = attempt_count + 1
    WHERE id = $1
    `,
    [recipient.id, sentMsg.id, opened.conversation_id, renderedText],
  );

  // 11. Atualiza as tags do contato: remove pendente e adiciona enviado
  await pool.query(
    `
    UPDATE public.contacts
    SET tags = array_append(array_remove(tags, 'recadastramento_pendente'), 'recadastramento_enviado'),
        updated_at = now()
    WHERE id = $1
    `,
    [contact.id],
  );

  // Atualiza também na tabela legacy public.contatos se existir
  await pool.query(
    `
    UPDATE public.contatos
    SET tags = array_append(array_remove(tags, 'recadastramento_pendente'), 'recadastramento_enviado')
    WHERE id = $1
    `,
    [contact.id],
  ).catch(() => {});

  // 12. Se a campanha tiver pipeline e stage configurados, adiciona/atualiza no funil
  if (c.pipeline_id && c.stage_id) {
    await pool.query(
      `
      INSERT INTO public.crm_leads (
        organization_id,
        contact_id,
        pipeline_id,
        stage_id,
        title,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'open', now(), now())
      ON CONFLICT (organization_id, pipeline_id, contact_id) 
      DO UPDATE SET stage_id = EXCLUDED.stage_id, updated_at = now()
      `,
      [
        c.organization_id,
        contact.id,
        c.pipeline_id,
        c.stage_id,
        contact.display_name || contact.phone_number,
      ],
    ).catch(async () => {
      // Caso não haja constraint UNIQUE em (org, pipeline, contact), insere ou atualiza normalmente
      const existing = await pool.query(
        `SELECT id FROM public.crm_leads WHERE organization_id = $1 AND pipeline_id = $2 AND contact_id = $3 LIMIT 1`,
        [c.organization_id, c.pipeline_id, contact.id],
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE public.crm_leads SET stage_id = $1, updated_at = now() WHERE id = $2`,
          [c.stage_id, existing.rows[0]?.id],
        );
      } else {
        await pool.query(
          `INSERT INTO public.crm_leads (organization_id, contact_id, pipeline_id, stage_id, title, status)
           VALUES ($1, $2, $3, $4, $5, 'open')`,
          [
            c.organization_id,
            contact.id,
            c.pipeline_id,
            c.stage_id,
            contact.display_name || contact.phone_number,
          ],
        );
      }
    });
  }

  return {
    campaignId: c.id,
    name: c.name,
    dispatched: true,
    recipientId: recipient.id,
    phone: contact.phone_number,
    contactName: contact.display_name ?? undefined,
  };
}
