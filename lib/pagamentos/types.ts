/**
 * O vocabulário AGNÓSTICO do eixo de pagamento — irmão de
 * `lib/plataformas-de-anuncio/types.ts`, mesma catraca (nenhuma feature nomeia
 * o provider fora daqui; ver `docs/doctrine/restricao-de-canal.md`).
 *
 * Hoje só existe um provider (`asaas`), mas o vocabulário já nasce agnóstico
 * pela mesma razão que `lib/plataformas-de-anuncio/` nasceu com `meta_ads` e
 * `google_ads` juntos: separar "o que o checkout PRECISA" de "como o Asaas
 * entrega" evita que a segunda integração de pagamento (se um dia existir)
 * precise reabrir este contrato.
 */

export type ProviderDePagamento = "asaas";

/**
 * Um pedido de cobrança Pix — no formato da CASA, não no do provider.
 */
export interface PedidoDeCobranca {
  valorCentavos: number;
  /** ISO-4217, sempre maiúsculo. Hoje só BRL: o Asaas não cobra em outra moeda. */
  moeda: string;
  descricao: string;
  /** A chave que volta no webhook de confirmação — a MESMA da linha em `checkout_conversion_intents`. */
  referenciaExterna: string;
  pagador: {
    nome: string;
    email: string | null;
    /** Só dígitos. CPF (11) ou CNPJ (14). */
    documento: string;
  };
}

/** O que a tela de checkout precisa para desenhar o Pix — QR e copia-e-cola. */
export interface CobrancaPixCriada {
  idNoProvider: string;
  copiaECola: string;
  /** PNG em base64, pronto para `<img src="data:image/png;base64,...">`. */
  qrCodeBase64: string;
  expiraEm: Date | null;
}

export type ResultadoDeCobranca =
  | { ok: true; cobranca: CobrancaPixCriada }
  | { ok: false; motivo: string };

/** As credenciais do gateway, já decifradas. */
export interface CredencialDePagamento {
  provider: ProviderDePagamento;
  apiKey: string;
  /** Valida que um webhook recebido veio mesmo do provider — nunca logado. */
  webhookToken: string | null;
  environment: "sandbox" | "production";
}
