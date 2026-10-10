/**
 * O vocabulário do checkout direto de conversão (migration 0381).
 *
 * Decoupled de `crm_leads` de propósito — ver o cabeçalho da migration: uma
 * doação de site não é lead fechado no kanban, e forçar essa forma inventaria
 * um funil que ninguém abre só para satisfazer uma FK.
 */
export type TipoDeConversao = "avulsa" | "recorrente";

export interface EntradaDeCheckout {
  organizationId: string;
  /**
   * Hoje sempre `"google_ads"`: é a única plataforma de que este checkout
   * recebe click id (`gclid`). Campo já no formato agnóstico de
   * `PlataformaDeAnuncio` para o dia em que a captura de `fbclid` existir sem
   * precisar reabrir o contrato do checkout.
   */
  adPlatform: "google_ads";
  adClickId: string | null;
  conversionKind: TipoDeConversao;
  valorCentavos: number;
  moeda: string;
  pagador: {
    nome: string;
    email: string | null;
    telefone: string | null;
    documento: string;
  };
  utm: Record<string, string>;
}

export interface IntentoDeCheckoutCriado {
  intentId: string;
  copiaECola: string;
  qrCodeBase64: string;
  expiraEm: string | null;
  status: "pending";
}

export type ResultadoDeCriacaoDeIntento =
  | { ok: true; intento: IntentoDeCheckoutCriado }
  | { ok: false; motivo: string; codigo: "sem_conexao_de_pagamento" | "cobranca_recusada" | "erro_interno" };
