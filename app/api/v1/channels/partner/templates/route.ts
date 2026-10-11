import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * As definições aprovadas do canal INTERMEDIADO — listar, sincronizar, criar.
 *
 * ─── Por que uma rota nova, e não a de sempre ──────────────────────────────
 *
 * `/api/v1/channels/templates` resolve a conexão por `metaSessionForOrg` e lê
 * `wabaId`. Numa instalação que só tem o canal intermediado, isso devolve lista
 * VAZIA — e o operador conclui que não tem nenhuma definição aprovada quando
 * tem várias. Foi exatamente o que aconteceu: o seletor do inbox dizia "nenhum
 * modelo aprovado ainda" para uma conta cheia deles.
 *
 * A rota de lá continua intacta. Fundir as duas exigiria mexer no caminho do
 * canal oficial, que funciona, para servir um canal que ele não conhece.
 *
 * ─── Tudo passa pelo seam ──────────────────────────────────────────────────
 *
 * Esta rota não sabe com QUEM fala: pede o adapter da sessão e chama
 * `adapter.templates`. Quem não implementa devolve 501, e nenhum nome de
 * provider aparece aqui — o `lint:channels` reprovaria.
 *
 * ─── O espelho carrega a conexão de origem (migration 0144) ───────────────
 *
 * `channel_session_id` é o que permite responder "o que posso usar NESTA
 * conexão?". Sem ele, dois números do mesmo provider dividiriam a mesma lista.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { findPartnerSession } from "@/lib/channels/connect";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Contexto {
  orgId: string;
  sessionId: string;
  sessionRef: string;
  provider: ChannelProvider;
  idioma: Idioma;
}

/**
 * Resolve org + conexão + adapter, ou devolve a resposta de erro pronta.
 *
 * A conexão vem do banco e não do corpo: `organization_id` tirado do body é o
 * anti-pattern nº 10 da doutrina, e aqui daria a um tenant a lista do outro.
 */
async function contexto(
  requestId: string,
): Promise<{ ok: true; ctx: Contexto } | { ok: false; res: Response }> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, res: fail("unauthenticated", "Faça login.", 401, { requestId }) };
  const t = (texto: string) => traduzir(texto, user.idioma);
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, res: fail("forbidden", t("Sem organização ativa."), 403, { requestId }) };

  const admin = createAdminClient();
  const sessao = await findPartnerSession(admin, org.orgId);
  if (!sessao || sessao.archivedAt) {
    return {
      ok: false,
      res: fail("not_found", t("Nenhuma conexão de parceiro ativa."), 404, { requestId }),
    };
  }

  const { data: linha } = await admin
    .from("channel_sessions")
    // As COLUNAS do ref vêm do seam. Escrevê-las à mão aqui nomeia os providers
    // — e o `lint:channels` reprovou a primeira versão deste arquivo por isso,
    // que é a catraca funcionando.
    .select(`id, ${CHANNEL_SESSION_REF_COLUMNS}`)
    .eq("id", sessao.id)
    .maybeSingle();

  const provider = ((linha?.provider as string) ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider;
  const sessionRef = linha ? resolveSessionRef(linha as unknown as ChannelSessionRef) : null;
  if (!sessionRef) {
    return {
      ok: false,
      res: fail("failed_precondition", t("Conexão sem identificador utilizável."), 409, { requestId }),
    };
  }

  return {
    ok: true,
    ctx: { orgId: org.orgId, sessionId: sessao.id, sessionRef, provider, idioma: user.idioma },
  };
}

import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";
import { mirrorAndResolveTemplateHeader } from "@/lib/channels/template-media-mirror";

interface MetaTemplateRow {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejected_reason: string | null;
  components: unknown;
  synced_at: string;
  parameter_format?: string;
  saved_values?: Record<string, string>;
}

function formatTemplateItem(t: MetaTemplateRow) {
  const contrato = deriveTemplateContract({
    name: t.name,
    language: t.language,
    parameter_format: t.parameter_format,
    components: t.components as never,
  });
  return {
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category ?? null,
    rejectedReason: t.rejected_reason ?? null,
    parameterFormat: contrato.parameterFormat,
    syncedAt: t.synced_at,
    slots: contrato.slots.map((s) => ({
      key: s.key,
      expects: s.expects,
      onde: describeAddress(s.address),
    })),
    components: (t.components as unknown[]) ?? [],
    saved_values: t.saved_values ?? {},
  };
}

/** Lista o que está ESPELHADO. Rápido, e é o que a tela mostra. */
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const r = await contexto(requestId);
  if (!r.ok) return r.res;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_templates")
    .select("name, language, status, category, rejected_reason, components, synced_at, parameter_format, saved_values")
    .eq("organization_id", r.ctx.orgId)
    .eq("channel_session_id", r.ctx.sessionId)
    .order("status")
    .order("name");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(
    {
      templates: (data ?? []).map((t) => formatTemplateItem(t as unknown as MetaTemplateRow)),
    },
    { requestId },
  );
}

/**
 * Sincroniza com a plataforma, ou CRIA uma definição nova.
 *
 * Duas ações na mesma rota porque as duas terminam no mesmo lugar — o espelho —
 * e separá-las obrigaria a tela a saber que criar também sincroniza.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await contexto(requestId);
  if (!r.ok) return r.res;
  const t = (texto: string) => traduzir(texto, r.ctx.idioma);

  const adapter = getAdapter(r.ctx.provider);
  if (!adapter.templates) {
    return fail("not_implemented", t("Este canal não gerencia definições."), 501, { requestId });
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    acao?: string;
    name?: string;
    language?: string;
    category?: string;
    components?: unknown[];
  };

  try {
    if (corpo.acao === "criar") {
      if (!corpo.name || !corpo.language || !Array.isArray(corpo.components)) {
        return fail("invalid_request", t("Faltam nome, idioma ou conteúdo."), 400, { requestId });
      }
      // A plataforma valida o formato do nome e devolve o motivo com código. Não
      // duplicamos a regra: regra copiada envelhece separado da fonte.
      await adapter.templates.create({
        organizationId: r.ctx.orgId,
        sessionRef: r.ctx.sessionRef,
        draft: {
          name: corpo.name,
          language: corpo.language,
          category: (corpo.category ?? "UTILITY") as "AUTHENTICATION" | "MARKETING" | "UTILITY",
          components: corpo.components,
        },
      });
      await audit({
        action: "template.created",
        organizationId: r.ctx.orgId,
        resourceType: "channel_session",
        resourceId: r.ctx.sessionId,
        requestId,
        metadata: { name: corpo.name, language: corpo.language },
      });
    }

    // Sincroniza sempre — inclusive depois de criar: a definição nasce em
    // revisão, e o operador precisa VER que ela existe e está pendente. Sem
    // isso ele criaria a mesma de novo, achando que não salvou.
    const remotas = await adapter.templates.list({
      organizationId: r.ctx.orgId,
      sessionRef: r.ctx.sessionRef,
    });
    const admin = createAdminClient();
    const agora = new Date().toISOString();

    let gravadas = 0;
    for (const t of remotas) {
      const { updatedSavedValues } = await mirrorAndResolveTemplateHeader(admin, {
        organizationId: r.ctx.orgId,
        templateName: t.name,
        components: t.components,
      });

      const { data: existingRow } = await admin
        .from("meta_templates")
        .select("saved_values")
        .eq("organization_id", r.ctx.orgId)
        .eq("channel_session_id", r.ctx.sessionId)
        .eq("name", t.name)
        .eq("language", t.language)
        .maybeSingle();

      const existingSaved = (existingRow?.saved_values as Record<string, unknown>) ?? {};
      const mergedSavedValues = {
        ...existingSaved,
        ...updatedSavedValues,
      };

      const { error } = await admin.from("meta_templates").upsert(
        {
          organization_id: r.ctx.orgId,
          channel_session_id: r.ctx.sessionId,
          waba_id: r.ctx.sessionRef,
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          rejected_reason: t.rejectedReason ?? null,
          components: t.components,
          contract_hash: "",
          parameter_format: t.parameterFormat ?? "POSITIONAL",
          saved_values: mergedSavedValues,
          synced_at: agora,
          updated_at: agora,
        },
        { onConflict: "organization_id,waba_id,name,language" },
      );
      if (error) {
        logger.warn("[partner/templates] upsert falhou", { name: t.name, detail: error.message });
        continue;
      }
      gravadas++;
    }

    return ok({ sincronizadas: gravadas, total: remotas.length }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    logger.error("[partner/templates] falhou", { detail: msg, requestId });
    return fail("upstream_error", msg, 502, { requestId });
  }
}

interface PatchMappingBody {
  name: string;
  language: string;
  mappings?: Record<string, unknown>;
  saved_values?: Record<string, string>;
}

async function persistTemplateMapping(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  sessionId: string,
  body: PatchMappingBody,
): Promise<{ ok: boolean; error?: string; saved?: Record<string, unknown> }> {
  const { data: existing, error: findErr } = await admin
    .from("meta_templates")
    .select("saved_values")
    .eq("organization_id", orgId)
    .eq("channel_session_id", sessionId)
    .eq("name", body.name)
    .eq("language", body.language)
    .maybeSingle();

  if (findErr || !existing) return { ok: false, error: "Modelo não encontrado." };

  const current = (existing.saved_values as Record<string, unknown>) ?? {};
  const updated: Record<string, unknown> = {
    ...current,
    ...(body.saved_values ?? {}),
  };
  if (body.mappings) updated.mappings = body.mappings;

  const { error: upErr } = await admin
    .from("meta_templates")
    .update({ saved_values: updated, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("channel_session_id", sessionId)
    .eq("name", body.name)
    .eq("language", body.language);

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, saved: updated };
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await contexto(requestId);
  if (!r.ok) return r.res;

  let body: PatchMappingBody;
  try {
    body = (await req.json()) as PatchMappingBody;
  } catch {
    return fail("invalid_json", "Corpo inválido.", 400, { requestId });
  }

  if (!body.name || !body.language) {
    return fail("invalid_request", "Nome e idioma são obrigatórios.", 400, { requestId });
  }

  const admin = createAdminClient();
  const res = await persistTemplateMapping(admin, r.ctx.orgId, r.ctx.sessionId, body);
  if (!res.ok) {
    return fail(res.error === "Modelo não encontrado." ? "not_found" : "internal_error", res.error ?? "erro", 400, { requestId });
  }

  return ok({ name: body.name, language: body.language, saved_values: res.saved }, { requestId });
}
