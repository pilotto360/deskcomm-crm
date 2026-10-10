/**
 * Quem sabe criar cobrança em qual provider — irmão de
 * `lib/plataformas-de-anuncio/registry.ts`, mesmo mecanismo (mapa com `null`
 * possível, para um provider entrar no vocabulário antes de ter client).
 */
import { criarCobrancaPix } from "./asaas/cobranca";
import type { CredencialDePagamento, PedidoDeCobranca, ProviderDePagamento, ResultadoDeCobranca } from "./types";

export interface TransporteDePagamento {
  provider: ProviderDePagamento;
  criarCobranca(
    credencial: CredencialDePagamento,
    pedido: PedidoDeCobranca,
  ): Promise<ResultadoDeCobranca>;
}

const TRANSPORTES: Record<ProviderDePagamento, TransporteDePagamento | null> = {
  asaas: { provider: "asaas", criarCobranca: criarCobrancaPix },
};

export function transporteDePagamentoDe(provider: ProviderDePagamento): TransporteDePagamento | null {
  return TRANSPORTES[provider] ?? null;
}

export function ehProviderDePagamentoConhecido(valor: unknown): valor is ProviderDePagamento {
  return typeof valor === "string" && valor in TRANSPORTES;
}
