/**
 * GET /api/v1/checkout/[org]/intents/[id] — a página de checkout usa esta
 * rota para saber se o Pix já foi pago (polling curto, enquanto o QR está na
 * tela). Pública pelo mesmo motivo da criação, e por isso devolve o MÍNIMO:
 * status e nada de dado do pagador — quem tem o `id` (um `uuid` que só quem
 * criou a intenção recebeu) só precisa saber "ainda esperando" ou "confirmado".
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ org: string; id: string }>;
}

const idSchema = z.string().uuid();

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { org, id } = await ctx.params;
  const idValidado = idSchema.safeParse(id);
  if (!idValidado.success) return fail("validation_error", "id inválido", 422);

  const admin = createAdminClient();

  const { data: organizacao } = await admin.from("organizations").select("id").eq("slug", org).maybeSingle();
  const organizationId = (organizacao as { id: string } | null)?.id ?? null;
  if (!organizationId) return fail("not_found", "checkout indisponível", 404);

  const { data: intencao } = await admin
    .from("checkout_conversion_intents")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("id", idValidado.data)
    .maybeSingle();

  if (!intencao) return fail("not_found", "intenção não encontrada", 404);

  return ok({ status: (intencao as { status: string }).status });
}
