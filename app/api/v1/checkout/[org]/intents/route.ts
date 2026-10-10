/**
 * POST /api/v1/checkout/[org]/intents — cria uma intenção de checkout (Pix)
 * fora do funil de leads (migration 0381).
 *
 * Rota PÚBLICA de propósito: quem chama é o navegador do doador, sem sessão
 * nossa — é o mesmo raciocínio da landing page de gclid
 * (`app/api/v1/anuncios/google/[org]/route.ts`), mas aqui a resposta É JSON
 * (`ok`/`fail`), porque quem lê é o `fetch` da própria página de checkout, não
 * um navegador sendo redirecionado.
 *
 * A organização é resolvida pelo `slug` na URL, nunca aceita no corpo — a
 * mesma régua de `lib/plataformas-de-anuncio/credenciais.ts`: `organization_id`
 * só vem de fonte confiável (aqui, o path), nunca do JSON que o cliente manda.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ok, fail } from "@/lib/api/wrappers";
import { criarIntencaoDeCheckout } from "@/lib/checkout/intencao";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ org: string }>;
}

const bodySchema = z.object({
  valor_centavos: z.number().int().positive().max(100_000_000),
  moeda: z.string().trim().toUpperCase().default("BRL"),
  tipo: z.enum(["avulsa", "recorrente"]).default("avulsa"),
  gclid: z.string().trim().min(1).max(512).nullable().optional(),
  utm: z.record(z.string(), z.string()).default({}),
  pagador: z.object({
    nome: z.string().trim().min(2).max(200),
    email: z.string().trim().email().nullable().optional(),
    telefone: z.string().trim().max(30).nullable().optional(),
    documento: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length === 11 || v.length === 14, "CPF ou CNPJ inválido"),
  }),
});

function clientIp(req: NextRequest): string | null {
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  return req.headers.get("x-real-ip")?.trim() || null;
}

const TETO_POR_IP = 10;
const JANELA_SEGUNDOS = 60;

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { org } = await ctx.params;

  const ip = clientIp(req);
  if (ip !== null) {
    const limite = await checkRateLimit(`checkout-intents:${org}:${ip}`, TETO_POR_IP, JANELA_SEGUNDOS);
    if (!limite.allowed) {
      return fail("rate_limited", "muitas tentativas — aguarde um instante", 429, {
        headers: { "Retry-After": String(JANELA_SEGUNDOS) },
      });
    }
  }

  const jsonBruto = await req.json().catch(() => null);
  const corpo = bodySchema.safeParse(jsonBruto);
  if (!corpo.success) {
    return fail("validation_error", "dados de checkout inválidos", 422, {
      details: corpo.error.flatten(),
    });
  }

  const admin = createAdminClient();

  const { data: organizacao, error: erroOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", org)
    .maybeSingle();

  if (erroOrg) {
    logger.error("[checkout.intents] leitura da organização falhou", { org, detalhe: erroOrg.message });
  }
  const organizationId = (organizacao as { id: string } | null)?.id ?? null;
  if (!organizationId) return fail("not_found", "checkout indisponível", 404);

  const resultado = await criarIntencaoDeCheckout(admin, {
    organizationId,
    adPlatform: "google_ads",
    adClickId: corpo.data.gclid ?? null,
    conversionKind: corpo.data.tipo,
    valorCentavos: corpo.data.valor_centavos,
    moeda: corpo.data.moeda,
    pagador: {
      nome: corpo.data.pagador.nome,
      email: corpo.data.pagador.email ?? null,
      telefone: corpo.data.pagador.telefone ?? null,
      documento: corpo.data.pagador.documento,
    },
    utm: corpo.data.utm,
  });

  if (!resultado.ok) {
    const status = resultado.codigo === "sem_conexao_de_pagamento" ? 503 : 502;
    return fail(resultado.codigo, resultado.motivo, status);
  }

  return ok(
    {
      intent_id: resultado.intento.intentId,
      copia_e_cola: resultado.intento.copiaECola,
      qr_code_base64: resultado.intento.qrCodeBase64,
      expira_em: resultado.intento.expiraEm,
      status: resultado.intento.status,
    },
    { status: 201 },
  );
}
