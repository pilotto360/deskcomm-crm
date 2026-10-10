/**
 * `reportarConversaoDaIntencao` — a ponte entre um `checkout_conversion_intent`
 * PAGO e o transporte de conversões do Google Ads
 * (`lib/plataformas-de-anuncio/google/conversions.ts`), chamado DIRETO — sem
 * passar por `lib/conversoes/envio.handler.ts`, que é gated em `crm_leads`
 * (`status = 'won'`) e nunca dispara para uma doação que não tem lead.
 *
 * ─── Por que reimplementar em vez de generalizar o handler existente ────────
 *
 * `conversaoDeVendaHandler` é um `EventHandler` no barramento de eventos de
 * LEAD (`lead.won`/`lead.stage_changed`) — reescrevê-lo para aceitar um evento
 * que não é de lead misturaria dois gatilhos de naturezas diferentes num
 * arquivo cuja doutrina inteira (comentário de cabeçalho de lá) é reler o
 * `crm_leads` como fonte de verdade. Este arquivo é o irmão decoupled: mesmo
 * DESTINO (`transporteDe('google_ads')!.enviar`), gatilho e fonte de verdade
 * diferentes (o webhook do Asaas, `checkout_conversion_intents`).
 *
 * ─── Sem lead, `ConversaoOffline.leadId` recebe o id da própria intenção ────
 *
 * O campo é usado hoje só para log e para compor `eventoId` (dedup do lado do
 * Google) — nunca vai no payload HTTP (conferido em `google/conversions.ts`).
 * Usar `intentId` ali é seguro e evita reabrir o contrato agnóstico do eixo de
 * conversões só para tornar um campo opcional.
 *
 * ─── Avulsa × recorrente: a escolha da ação de conversão é DESTE arquivo ────
 *
 * `credenciais.ts` (agnóstico) só carrega os dois ids possíveis
 * (`conversionActionId`/`conversionActionIdRecorrente`, migration 0381). Quem
 * decide qual dos dois vai no envio é quem SABE que a venda foi avulsa ou
 * recorrente — que é este arquivo, não o transporte nem a leitura de
 * credencial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { transporteDe } from "@/lib/plataformas-de-anuncio/registry";
import type { ConversaoOffline } from "@/lib/plataformas-de-anuncio/types";

interface IntencaoPaga {
  id: string;
  organization_id: string;
  ad_click_id: string | null;
  conversion_kind: "avulsa" | "recorrente";
  value_cents: number;
  currency: string;
  payer_phone: string | null;
  paid_at: string | null;
}

export type ResultadoDoReporte =
  | { tipo: "reportado" }
  | { tipo: "sem_click_id" }
  | { tipo: "sem_credencial"; motivo: string }
  | { tipo: "sem_acao_de_conversao" }
  | { tipo: "falhou"; permanente: boolean; detalhe: string };

/**
 * Qual ação de conversão do Google Ads usar — pura, sem I/O, para o teste de
 * unidade vigiar a regra sem precisar de rede nem de banco.
 *
 * `recorrente` cai para a ação `avulsa` quando a organização não cadastrou
 * uma distinta (migration 0381: a coluna nova é nullable de propósito, "nem
 * toda organização vende assinatura"). `avulsa` nunca cai para `recorrente` —
 * não faria sentido reportar doação única na ação de assinatura.
 */
export function escolherAcaoDeConversao(
  tipo: "avulsa" | "recorrente",
  acoes: { avulsa: string | null; recorrente: string | null },
): string | null {
  if (tipo === "recorrente") return acoes.recorrente ?? acoes.avulsa;
  return acoes.avulsa;
}

export async function reportarConversaoDaIntencao(
  admin: SupabaseClient,
  intencao: IntencaoPaga,
): Promise<ResultadoDoReporte> {
  // Sem gclid não há o que reportar — a doação foi confirmada e o dinheiro
  // entrou de qualquer forma; só a atribuição ao anúncio é que se perde. Nunca
  // um motivo para marcar o PAGAMENTO como falho.
  if (!intencao.ad_click_id) return { tipo: "sem_click_id" };

  const leitura = await lerCredencial(admin, intencao.organization_id, "google_ads");
  if (!leitura.ok) {
    return { tipo: "sem_credencial", motivo: leitura.motivo };
  }

  const acaoDeConversao = escolherAcaoDeConversao(intencao.conversion_kind, {
    avulsa: leitura.credencial.google?.conversionActionId ?? null,
    recorrente: leitura.credencial.google?.conversionActionIdRecorrente ?? null,
  });

  if (!acaoDeConversao) return { tipo: "sem_acao_de_conversao" };

  const credencialComAcaoCerta = {
    ...leitura.credencial,
    google: leitura.credencial.google
      ? { ...leitura.credencial.google, conversionActionId: acaoDeConversao }
      : undefined,
  };

  const conversao: ConversaoOffline = {
    organizationId: intencao.organization_id,
    leadId: intencao.id,
    evento: "Purchase",
    // Dedup do lado do Google: mesma intenção nunca reporta duas vezes, mesmo
    // se o webhook do Asaas reentregar a notificação (Asaas reentrega em falha).
    eventoId: `checkout:${intencao.id}`,
    ocorridoEm: intencao.paid_at ? new Date(intencao.paid_at) : new Date(),
    cliqueDeOrigem: intencao.ad_click_id,
    telefone: intencao.payer_phone ? intencao.payer_phone.replace(/\D/g, "") : null,
    valorCentavos: intencao.value_cents,
    moeda: intencao.currency,
  };

  const transporte = transporteDe("google_ads");
  if (!transporte) return { tipo: "sem_credencial", motivo: "plataforma_sem_transporte" };

  const resultado = await transporte.enviar(credencialComAcaoCerta, conversao);

  if (resultado.tipo === "ok") return { tipo: "reportado" };
  if (resultado.tipo === "transitorio") {
    logger.warn("[checkout.conversao] envio transitório, retry cabe ao chamador", {
      intentId: intencao.id,
      detalhe: resultado.detalhe,
    });
    return { tipo: "falhou", permanente: false, detalhe: resultado.detalhe };
  }
  logger.error("[checkout.conversao] envio recusado de forma permanente", {
    intentId: intencao.id,
    detalhe: resultado.detalhe,
  });
  return { tipo: "falhou", permanente: true, detalhe: resultado.detalhe };
}
