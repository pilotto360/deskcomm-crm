/**
 * `criarIntencaoDeCheckout` — o passo que junta ler credencial de pagamento,
 * criar a cobrança Pix no Asaas e gravar a linha de correlação
 * (`checkout_conversion_intents`, migration 0381) que o webhook de
 * confirmação vai reencontrar depois.
 *
 * ─── Ordem importa: grava a linha ANTES de criar a cobrança ─────────────────
 *
 * Se a criação no Asaas tivesse sucesso e a gravação da linha falhasse depois,
 * o dinheiro do doador estaria a caminho e NENHUM registro nosso saberia
 * disso — o webhook chegaria com um `externalReference` que não bate com
 * nada. Gravando a linha primeiro (com `provider_charge_id` nulo) e
 * atualizando com o id da cobrança depois, o pior caso vira uma linha
 * `pending` órfã (visível, corrigível), nunca um pagamento invisível.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencialDePagamento } from "@/lib/pagamentos/credenciais";
import { transporteDePagamentoDe } from "@/lib/pagamentos/registry";
import type { PedidoDeCobranca } from "@/lib/pagamentos/types";
import type { EntradaDeCheckout, ResultadoDeCriacaoDeIntento } from "./tipos";

const PROVIDER = "asaas" as const;

export async function criarIntencaoDeCheckout(
  admin: SupabaseClient,
  entrada: EntradaDeCheckout,
): Promise<ResultadoDeCriacaoDeIntento> {
  const credencial = await lerCredencialDePagamento(admin, entrada.organizationId, PROVIDER);
  if (!credencial.ok) {
    logger.warn("[checkout.intencao] sem credencial de pagamento utilizável", {
      organizationId: entrada.organizationId,
      motivo: credencial.motivo,
    });
    return { ok: false, motivo: "checkout indisponível no momento", codigo: "sem_conexao_de_pagamento" };
  }

  const transporte = transporteDePagamentoDe(PROVIDER);
  if (!transporte) {
    // Inalcançável em uso normal — mesmo raciocínio do irmão em conversions.ts.
    return { ok: false, motivo: "provider sem transporte configurado", codigo: "erro_interno" };
  }

  const referenciaExterna = randomUUID();

  // Grava ANTES de chamar o Asaas — ver o cabeçalho do arquivo.
  const { data: linha, error: erroInsercao } = await admin
    .from("checkout_conversion_intents")
    .insert({
      organization_id: entrada.organizationId,
      ad_platform: entrada.adPlatform,
      ad_click_id: entrada.adClickId,
      conversion_kind: entrada.conversionKind,
      provider: PROVIDER,
      external_reference: referenciaExterna,
      value_cents: entrada.valorCentavos,
      currency: entrada.moeda.toUpperCase(),
      payer_name: entrada.pagador.nome,
      payer_email: entrada.pagador.email,
      payer_phone: entrada.pagador.telefone,
      utm: entrada.utm,
      status: "pending",
    })
    .select("id")
    .single();

  if (erroInsercao || !linha) {
    logger.error("[checkout.intencao] gravação da intenção falhou", {
      organizationId: entrada.organizationId,
      erro: erroInsercao?.message,
    });
    return { ok: false, motivo: "falha ao registrar a intenção de checkout", codigo: "erro_interno" };
  }

  const intentId = (linha as { id: string }).id;

  const pedido: PedidoDeCobranca = {
    valorCentavos: entrada.valorCentavos,
    moeda: entrada.moeda.toUpperCase(),
    descricao:
      entrada.conversionKind === "recorrente" ? "Doação mensal" : "Doação avulsa",
    referenciaExterna,
    pagador: {
      nome: entrada.pagador.nome,
      email: entrada.pagador.email,
      documento: entrada.pagador.documento.replace(/\D/g, ""),
    },
  };

  const resultado = await transporte.criarCobranca(credencial.credencial, pedido);

  if (!resultado.ok) {
    // A linha fica `pending` sem `provider_charge_id` — auditável, não some.
    // Não tentamos apagá-la: um `pending` órfão é sinal de problema de
    // configuração (a mesma régua de `MotivoSemCredencial`), não lixo a limpar.
    logger.error("[checkout.intencao] criação de cobrança recusada pelo provider", {
      organizationId: entrada.organizationId,
      intentId,
      motivo: resultado.motivo,
    });
    await admin
      .from("checkout_conversion_intents")
      .update({ status: "failed", report_detail: resultado.motivo })
      .eq("id", intentId);
    return { ok: false, motivo: "não foi possível gerar o Pix agora", codigo: "cobranca_recusada" };
  }

  const { error: erroAtualizacao } = await admin
    .from("checkout_conversion_intents")
    .update({ provider_charge_id: resultado.cobranca.idNoProvider })
    .eq("id", intentId);
  if (erroAtualizacao) {
    // A cobrança JÁ existe no Asaas e o doador JÁ tem o QR na tela — não
    // desfazemos nada por causa de uma escrita de acompanhamento. Fica
    // registrado para quem opera investigar via `provider_charge_id` direto
    // no Asaas se o webhook não encontrar a linha depois.
    logger.error("[checkout.intencao] gravação do provider_charge_id falhou", {
      intentId,
      providerChargeId: resultado.cobranca.idNoProvider,
      erro: erroAtualizacao.message,
    });
  }

  return {
    ok: true,
    intento: {
      intentId,
      copiaECola: resultado.cobranca.copiaECola,
      qrCodeBase64: resultado.cobranca.qrCodeBase64,
      expiraEm: resultado.cobranca.expiraEm ? resultado.cobranca.expiraEm.toISOString() : null,
      status: "pending",
    },
  };
}
