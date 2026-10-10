import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  PARTNER_OPTIONS,
  archivePartnerSession,
  defaultPartnerProvider,
  findPartnerSession,
  partnerEndpoint,
  partnerLabel,
  savePartnerSession,
  validatePartnerCredentials,
} from "@/lib/channels/connect";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const conectarSchema = z.object({
  provider: z.string().optional(),
  account_id: z.string().trim().max(200).optional(),
  api_key: z.string().trim().min(8).max(500),
});

function urlDoWebhook(req: NextRequest, token: string): string {
  return `${basePublicaDaInstalacao(req)}/api/v1/webhooks/channel/${token}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const sessao = await findPartnerSession(createAdminClient(), authz.org.orgId);
  const conectado = !!sessao && !sessao.archivedAt;
  const rotulo = partnerLabel(sessao?.provider);

  return ok(
    {
      label: rotulo,
      connected: conectado,
      channel_session_id: conectado ? sessao.id : null,
      provider: conectado ? sessao.provider : defaultPartnerProvider(),
      options: PARTNER_OPTIONS,
      account_id: conectado ? sessao.accountId : null,
      phone_number: conectado ? sessao.phoneNumber : null,
      display_name: conectado ? sessao.displayName : null,
      status: conectado ? sessao.status : null,
      has_api_key: conectado ? sessao.hasApiKey : false,
      endpoint: conectado ? partnerEndpoint(sessao.provider) : null,
      webhook_url: conectado && sessao.webhookPathToken ? urlDoWebhook(req, sessao.webhookPathToken) : null,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = conectarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", t("Chave de API é obrigatória"), 422, { requestId });
  }

  const v = await validatePartnerCredentials({
    provider: parsed.data.provider,
    accountId: parsed.data.account_id,
    apiKey: parsed.data.api_key,
  });
  if (!v.ok) return fail("invalid_request", v.reason, 422, { requestId });

  const admin = createAdminClient();
  const chaveCifrada = await encryptWebhookSecret(admin, parsed.data.api_key);
  const segredoWebhook = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoWebhook);

  if (!chaveCifrada || !segredoCifrado) {
    return fail("invalid_request", t("cifra indisponível nesta instalação"), 422, { requestId });
  }

  const existente = await findPartnerSession(admin, authz.org.orgId);
  const token = existente?.webhookPathToken ?? randomBytes(16).toString("hex");
  const rotulo = partnerLabel(parsed.data.provider);

  const { error } = await savePartnerSession(admin, {
    organizationId: authz.org.orgId,
    existingId: existente?.id ?? null,
    provider: parsed.data.provider,
    accountId: parsed.data.account_id?.trim(),
    apiKeyEncrypted: chaveCifrada,
    webhookPathToken: token,
    webhookSecretEncrypted: segredoCifrado,
    phoneNumber: v.phoneNumber ? `+${v.phoneNumber.replace(/\D/g, "")}` : null,
    displayName: v.displayName ?? rotulo,
  });
  if (error) return fail("internal_error", error, 500, { requestId });

  return ok(
    {
      connected: true,
      phone_number: v.phoneNumber ? `+${v.phoneNumber.replace(/\D/g, "")}` : null,
      display_name: v.displayName ?? rotulo,
      quality_rating: v.qualityRating,
      webhook_url: urlDoWebhook(req, token),
      webhook_secret: segredoWebhook,
    },
    { requestId },
  );
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { error } = await archivePartnerSession(admin, authz.org.orgId);
  if (error) return fail("internal_error", error, 500, { requestId });

  return ok({ disconnected: true }, { requestId });
}
