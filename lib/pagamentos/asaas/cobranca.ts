/**
 * O client do Asaas — irmão declarado de
 * `lib/plataformas-de-anuncio/google/conversions.ts`: mesma disciplina de não
 * vazar o nome do endpoint pra fora deste arquivo, mesmo jeito de classificar
 * erro por física (rede/5xx é transitório, o resto é "motivo" para a tela).
 *
 * ─── Reais, não centavos ─────────────────────────────────────────────────────
 *
 * A CASA guarda dinheiro em `_cents` (doutrina). O Asaas cobra em UNIDADE da
 * moeda (`19.90`, não `1990`) — a conversão acontece só aqui, na borda, nunca
 * em código que fala com o resto do app.
 *
 * ─── Por que procura o cliente antes de criar ────────────────────────────────
 *
 * O Asaas não deduplica por CPF: chamar `POST /customers` a cada doação criaria
 * um cadastro novo por doador recorrente, sujando exatamente o painel que o
 * usuário pediu para não sujar (a motivação original desta feature inteira). A
 * busca por `cpfCnpj` primeiro é o preço de manter o painel dele legível.
 *
 * ─── O que este arquivo NÃO faz ─────────────────────────────────────────────
 *
 * Não decide QUANDO chamar, não lê credencial do banco, não sabe o que é uma
 * `checkout_conversion_intent`. Só fala com o Asaas.
 */
import { logger } from "@/lib/logger";
import type { CredencialDePagamento, PedidoDeCobranca, ResultadoDeCobranca } from "../types";

const BASE_PRODUCTION = "https://api.asaas.com/v3";
const BASE_SANDBOX = "https://api-sandbox.asaas.com/v3";

const TEMPO_LIMITE_MS = 15_000;

function enderecoBase(credencial: CredencialDePagamento): string {
  return credencial.environment === "sandbox" ? BASE_SANDBOX : BASE_PRODUCTION;
}

function headers(credencial: CredencialDePagamento): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    // Nome de header exato da API do Asaas — não é Bearer, é este campo.
    access_token: credencial.apiKey,
  };
}

async function chamar(
  credencial: CredencialDePagamento,
  caminho: string,
  init: RequestInit,
): Promise<{ ok: true; corpo: unknown } | { ok: false; status: number; corpo: unknown }> {
  const resposta = await fetch(`${enderecoBase(credencial)}${caminho}`, {
    ...init,
    headers: { ...headers(credencial), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  const texto = await resposta.text().catch(() => "");
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { raw: texto };
  }
  if (!resposta.ok) return { ok: false, status: resposta.status, corpo };
  return { ok: true, corpo };
}

function mensagemDeErro(corpo: unknown): string {
  if (corpo && typeof corpo === "object" && "errors" in corpo) {
    const erros = (corpo as { errors?: unknown }).errors;
    if (Array.isArray(erros) && erros.length > 0) {
      const primeiro = erros[0] as { description?: string; code?: string };
      return primeiro.description ?? primeiro.code ?? "erro sem descrição";
    }
  }
  return "erro sem formato reconhecido";
}

async function buscarOuCriarCliente(
  credencial: CredencialDePagamento,
  pagador: PedidoDeCobranca["pagador"],
): Promise<{ ok: true; customerId: string } | { ok: false; motivo: string }> {
  const busca = await chamar(
    credencial,
    `/customers?cpfCnpj=${encodeURIComponent(pagador.documento)}`,
    { method: "GET" },
  );
  if (busca.ok) {
    const corpo = busca.corpo as { data?: Array<{ id: string }> } | null;
    const existente = corpo?.data?.[0]?.id;
    if (existente) return { ok: true, customerId: existente };
  }

  const criacao = await chamar(credencial, "/customers", {
    method: "POST",
    body: JSON.stringify({
      name: pagador.nome,
      email: pagador.email ?? undefined,
      cpfCnpj: pagador.documento,
    }),
  });
  if (!criacao.ok) {
    return { ok: false, motivo: `criação de cliente falhou: ${mensagemDeErro(criacao.corpo)}` };
  }
  const idCriado = (criacao.corpo as { id?: string } | null)?.id;
  if (!idCriado) return { ok: false, motivo: "criação de cliente não devolveu id" };
  return { ok: true, customerId: idCriado };
}

/** `yyyy-MM-dd`, hoje em UTC — o Asaas exige `dueDate`, mesmo para Pix imediato. */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Exportados para o teste vigiar as regras sem falar com a rede — mesmo padrão de `google/conversions.ts`. */
export const INTERNOS = { mensagemDeErro, hojeISO } as const;

export async function criarCobrancaPix(
  credencial: CredencialDePagamento,
  pedido: PedidoDeCobranca,
): Promise<ResultadoDeCobranca> {
  if (pedido.moeda.toUpperCase() !== "BRL") {
    return { ok: false, motivo: `Asaas só cobra em BRL; pedido veio em ${pedido.moeda}` };
  }

  const cliente = await buscarOuCriarCliente(credencial, pedido.pagador);
  if (!cliente.ok) return { ok: false, motivo: cliente.motivo };

  const criacaoCobranca = await chamar(credencial, "/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: cliente.customerId,
      billingType: "PIX",
      value: pedido.valorCentavos / 100,
      dueDate: hojeISO(),
      description: pedido.descricao,
      externalReference: pedido.referenciaExterna,
    }),
  });
  if (!criacaoCobranca.ok) {
    logger.warn("[pagamentos.asaas] criação de cobrança recusada", {
      status: criacaoCobranca.status,
      referenciaExterna: pedido.referenciaExterna,
    });
    return { ok: false, motivo: `criação de cobrança falhou: ${mensagemDeErro(criacaoCobranca.corpo)}` };
  }
  const idCobranca = (criacaoCobranca.corpo as { id?: string } | null)?.id;
  if (!idCobranca) return { ok: false, motivo: "criação de cobrança não devolveu id" };

  const qr = await chamar(credencial, `/payments/${idCobranca}/pixQrCode`, { method: "GET" });
  if (!qr.ok) {
    return { ok: false, motivo: `leitura do QR Pix falhou: ${mensagemDeErro(qr.corpo)}` };
  }
  const dadosQr = qr.corpo as {
    encodedImage?: string;
    payload?: string;
    expirationDate?: string | null;
  } | null;
  if (!dadosQr?.encodedImage || !dadosQr?.payload) {
    return { ok: false, motivo: "resposta do QR Pix sem encodedImage/payload" };
  }

  return {
    ok: true,
    cobranca: {
      idNoProvider: idCobranca,
      copiaECola: dadosQr.payload,
      qrCodeBase64: dadosQr.encodedImage,
      expiraEm: dadosQr.expirationDate ? new Date(dadosQr.expirationDate) : null,
    },
  };
}
