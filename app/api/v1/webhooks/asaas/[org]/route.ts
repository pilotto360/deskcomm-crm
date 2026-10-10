/**
 * POST /api/v1/webhooks/asaas/[org] — confirmação de pagamento do Asaas.
 *
 * Já coberta por `/^\/api\/v1\/webhooks\//` em `lib/auth/public-paths.ts`
 * (comentário de lá: "público" é o proxy não decidir, a AUTENTICAÇÃO real é
 * o token do webhook, verificado AQUI).
 *
 * ─── Duas responsabilidades que este arquivo mantém separadas ───────────────
 *
 * 1. Confirmar o PAGAMENTO — sempre que o token bate e a intenção existe,
 *    transição `pending -> paid`, idempotente (reentrega do Asaas em falha de
 *    rede é o caso comum, não a exceção).
 * 2. Reportar a CONVERSÃO ao Google Ads — melhor esforço, DEPOIS de já ter
 *    confirmado o pagamento. Uma falha aqui (rede do Google, credencial
 *    incompleta) não pode fazer este endpoint devolver erro para o Asaas: o
 *    Asaas reenviaria o MESMO webhook de pagamento por um problema que é
 *    nosso, do lado do Google — o pagamento já está correto, só a atribuição
 *    que ainda não saiu. A intenção fica em `status = 'paid'` (não
 *    `'reported'`) com o motivo em `report_detail`, visível para reprocesso
 *    manual; não há job de retry automático nesta v1.
 *
 * ─── Por que o token vem de HEADER, não de query string ─────────────────────
 *
 * O Asaas manda o valor configurado na tela "Token de autenticação" do
 * webhook no header `asaas-access-token`. Comparar aqui, contra o valor
 * cifrado em `payment_provider_connections.webhook_token_encrypted`
 * (migration 0381), é o que impede QUALQUER POST nesta rota de ser tratado
 * como pagamento confirmado.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { reportarConversaoDaIntencao } from "@/lib/checkout/conversao-de-doacao";
import { logger } from "@/lib/logger";
import { lerCredencialDePagamento } from "@/lib/pagamentos/credenciais";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ org: string }>;
}

const payloadSchema = z.object({
  event: z.string(),
  payment: z.object({
    id: z.string(),
    externalReference: z.string().nullable().optional(),
    status: z.string().optional(),
  }),
});

/** Eventos que significam "dinheiro entrou". O resto (vencido, estornado, etc.) é 200 sem efeito. */
const EVENTOS_DE_PAGAMENTO_CONFIRMADO = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { org } = await ctx.params;

  const jsonBruto = await req.json().catch(() => null);
  const payload = payloadSchema.safeParse(jsonBruto);
  if (!payload.success) {
    // 200: corpo que o Asaas não reconheceria como sucesso dispararia retry
    // eterno de um payload que nunca vai ficar válido reenviando igual.
    logger.warn("[webhooks.asaas] payload fora do formato esperado", { org });
    return new NextResponse(null, { status: 200 });
  }

  const admin = createAdminClient();

  const { data: organizacao } = await admin.from("organizations").select("id").eq("slug", org).maybeSingle();
  const organizationId = (organizacao as { id: string } | null)?.id ?? null;
  if (!organizationId) return new NextResponse(null, { status: 200 });

  const credencial = await lerCredencialDePagamento(admin, organizationId, "asaas");
  if (!credencial.ok || !credencial.credencial.webhookToken) {
    logger.error("[webhooks.asaas] sem token de webhook configurado — recusando", { org });
    return new NextResponse(null, { status: 200 });
  }

  const tokenRecebido = req.headers.get("asaas-access-token");
  if (!tokenRecebido || tokenRecebido !== credencial.credencial.webhookToken) {
    logger.error("[webhooks.asaas] token de webhook não confere", { org });
    // 401 aqui É intencional, ao contrário dos outros ramos: um token errado
    // não é "formato que nunca vai ficar válido" — pode ser o Asaas com o
    // token antigo por uma reconfiguração nossa, e o Asaas expõe o histórico
    // de tentativas/erros na própria tela dele, útil para quem opera notar.
    return new NextResponse(null, { status: 401 });
  }

  if (!EVENTOS_DE_PAGAMENTO_CONFIRMADO.has(payload.data.event)) {
    return new NextResponse(null, { status: 200 });
  }

  const externalReference = payload.data.payment.externalReference;
  if (!externalReference) {
    logger.warn("[webhooks.asaas] pagamento confirmado sem externalReference", {
      org,
      providerChargeId: payload.data.payment.id,
    });
    return new NextResponse(null, { status: 200 });
  }

  const { data: intencao, error: erroLeitura } = await admin
    .from("checkout_conversion_intents")
    .select("id, organization_id, ad_click_id, conversion_kind, value_cents, currency, payer_phone, status, paid_at")
    .eq("organization_id", organizationId)
    .eq("external_reference", externalReference)
    .maybeSingle();

  if (erroLeitura || !intencao) {
    logger.error("[webhooks.asaas] intenção não encontrada para externalReference", {
      org,
      externalReference,
      erro: erroLeitura?.message,
    });
    return new NextResponse(null, { status: 200 });
  }

  const linha = intencao as {
    id: string;
    organization_id: string;
    ad_click_id: string | null;
    conversion_kind: "avulsa" | "recorrente";
    value_cents: number;
    currency: string;
    payer_phone: string | null;
    status: string;
    paid_at: string | null;
  };

  // Idempotente: reentrega do Asaas do MESMO evento não paga nem reporta duas
  // vezes. `reported`/`paid` já passaram por aqui uma vez; `failed`/`expired`
  // não avançam sozinhos (exigiriam decisão humana, fora do escopo desta v1).
  if (linha.status !== "pending") {
    return new NextResponse(null, { status: 200 });
  }

  const agora = new Date().toISOString();
  const { error: erroUpdate } = await admin
    .from("checkout_conversion_intents")
    .update({ status: "paid", paid_at: agora })
    .eq("id", linha.id)
    .eq("status", "pending"); // corrida entre duas reentregas simultâneas: só uma vence.

  if (erroUpdate) {
    logger.error("[webhooks.asaas] transição para paid falhou", { intentId: linha.id, erro: erroUpdate.message });
    return new NextResponse(null, { status: 200 });
  }

  const reporte = await reportarConversaoDaIntencao(admin, {
    id: linha.id,
    organization_id: linha.organization_id,
    ad_click_id: linha.ad_click_id,
    conversion_kind: linha.conversion_kind,
    value_cents: linha.value_cents,
    currency: linha.currency,
    payer_phone: linha.payer_phone,
    paid_at: agora,
  });

  if (reporte.tipo === "reportado") {
    await admin
      .from("checkout_conversion_intents")
      .update({ status: "reported", reported_at: new Date().toISOString() })
      .eq("id", linha.id);
  } else if (reporte.tipo === "sem_click_id") {
    // Sem o que reportar — o pagamento fica `paid` como estado final, não erro.
    await admin
      .from("checkout_conversion_intents")
      .update({ report_detail: "sem gclid; conversão não reportada" })
      .eq("id", linha.id);
  } else {
    const detalhe =
      "detalhe" in reporte
        ? reporte.detalhe
        : "motivo" in reporte
          ? reporte.motivo
          : "sem ação de conversão configurada";
    logger.warn("[webhooks.asaas] reporte de conversão não concluído", { intentId: linha.id, detalhe });
    await admin.from("checkout_conversion_intents").update({ report_detail: detalhe }).eq("id", linha.id);
  }

  return new NextResponse(null, { status: 200 });
}
