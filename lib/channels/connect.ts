/**
 * Conexão de um canal por CREDENCIAL — do lado de dentro do seam.
 *
 * A tela e a rota não podem saber qual provider é (invariante 1 da doutrina),
 * mas precisam de três coisas concretas: como se chama o canal para o usuário,
 * quais campos pedir, e se a credencial que ele colou presta. As três moram
 * aqui, onde nomear o provider é permitido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { CHANNEL_PROVIDER_ZERNIO, CHANNEL_PROVIDER_OMNIQUE } from "./capabilities";
import { zernioBaseUrl } from "./zernio/credentials";
import { omniqueBaseUrl, validateOmniqueCredentials } from "./omnique/credentials";
import type { ChannelProvider } from "./types";

export const PARTNER_CHANNEL_PROVIDER: ChannelProvider = CHANNEL_PROVIDER_OMNIQUE;
export const PARTNER_CHANNEL_LABEL = "Omnique";

export interface PartnerOption {
  id: string;
  label: string;
  requiresAccountId: boolean;
  keyPlaceholder: string;
  description: string;
}

export const PARTNER_OPTIONS: PartnerOption[] = [
  {
    id: "omnique",
    label: "Omnique",
    requiresAccountId: false,
    keyPlaceholder: "zpk_...",
    description: "Conecte seu WhatsApp através da Omnique (Cloud API oficial). Basta informar sua chave de API.",
  },
  {
    id: "zernio",
    label: "Zernio",
    requiresAccountId: true,
    keyPlaceholder: "Chave de API",
    description: "Conecte seu WhatsApp através da Zernio. Informe seu Account ID e Chave de API.",
  },
];

export function partnerLabel(provider?: string): string {
  return provider === "zernio" || provider === CHANNEL_PROVIDER_ZERNIO ? "Zernio" : "Omnique";
}

export function defaultPartnerProvider(): string {
  return CHANNEL_PROVIDER_OMNIQUE;
}

export function partnerEndpoint(provider?: string): string {
  return provider === "zernio" || provider === CHANNEL_PROVIDER_ZERNIO
    ? zernioBaseUrl()
    : omniqueBaseUrl();
}

export interface PartnerCredentialsInput {
  provider?: string;
  accountId?: string;
  apiKey: string;
}

export type PartnerValidation =
  | {
      ok: true;
      phoneNumber: string | null;
      displayName: string | null;
      qualityRating: string | null;
    }
  | { ok: false; reason: string };

async function validateZernio(accountId: string, apiKey: string): Promise<PartnerValidation> {
  let res: Response;
  try {
    res = await fetch(`${zernioBaseUrl()}/v1/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { ok: false, reason: "Não foi possível falar com o provedor. Tente de novo." };
  }
  if (!res.ok) return { ok: false, reason: `Provedor respondeu ${res.status}.` };

  const json = (await res.json().catch(() => null)) as { accounts?: Record<string, unknown>[] } | null;
  const contas = Array.isArray(json?.accounts) ? json.accounts : [];
  const conta = contas.find((c) => String(c._id ?? c.id) === accountId);
  if (!conta) return { ok: false, reason: "Conta não encontrada para esta chave." };
  if (conta.platform !== "whatsapp") {
    return { ok: false, reason: `Esta conta é de ${String(conta.platform ?? "outra rede")}, não de WhatsApp.` };
  }
  const meta = (conta.metadata ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    phoneNumber: typeof meta.displayPhoneNumber === "string" ? meta.displayPhoneNumber : null,
    displayName: typeof conta.displayName === "string" ? conta.displayName : null,
    qualityRating: typeof meta.qualityRating === "string" ? meta.qualityRating : null,
  };
}

async function validateOmnique(apiKey: string): Promise<PartnerValidation> {
  const res = await validateOmniqueCredentials(apiKey);
  if (!res.ok) return { ok: false, reason: res.reason || "Chave recusada pela Omnique." };
  return {
    ok: true,
    phoneNumber: res.phoneNumber ?? null,
    displayName: res.displayName ?? "Omnique",
    qualityRating: "GREEN",
  };
}

export async function validatePartnerCredentials(input: PartnerCredentialsInput): Promise<PartnerValidation> {
  const apiKey = input.apiKey.trim();
  const accountId = (input.accountId ?? "").trim();
  const provider = input.provider || (apiKey.startsWith("zpk_") ? "omnique" : (accountId ? "zernio" : "omnique"));

  if (!apiKey) return { ok: false, reason: "Informe a chave de API." };
  if (provider === "omnique" || provider === CHANNEL_PROVIDER_OMNIQUE) {
    return validateOmnique(apiKey);
  }
  if (!accountId) return { ok: false, reason: "Informe o Account ID." };
  return validateZernio(accountId, apiKey);
}

export interface PartnerSession {
  id: string;
  provider: ChannelProvider;
  accountId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  status: string | null;
  webhookPathToken: string | null;
  hasApiKey: boolean;
  archivedAt: string | null;
}

const COLUNAS =
  "id, provider, zernio_account_id, omnique_instance_id, phone_number, display_name, status, webhook_path_token, zernio_token_encrypted, omnique_api_key_encrypted";

function toPartnerSession(row: Record<string, unknown> | null): PartnerSession | null {
  if (!row) return null;
  const isOmnique = row.provider === CHANNEL_PROVIDER_OMNIQUE;
  return {
    id: row.id as string,
    provider: (row.provider as ChannelProvider) ?? (isOmnique ? CHANNEL_PROVIDER_OMNIQUE : CHANNEL_PROVIDER_ZERNIO),
    accountId: isOmnique ? ((row.omnique_instance_id as string) ?? null) : ((row.zernio_account_id as string) ?? null),
    phoneNumber: (row.phone_number as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
    webhookPathToken: (row.webhook_path_token as string) ?? null,
    hasApiKey: isOmnique ? !!row.omnique_api_key_encrypted : !!row.zernio_token_encrypted,
    archivedAt: (row.archived_at as string) ?? null,
  };
}

export async function findPartnerSession(
  admin: SupabaseClient,
  organizationId: string,
  preferredProvider?: ChannelProvider,
): Promise<PartnerSession | null> {
  const providers = preferredProvider
    ? [preferredProvider]
    : [CHANNEL_PROVIDER_OMNIQUE, CHANNEL_PROVIDER_ZERNIO];

  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .in("provider", providers)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const { data } = await queryTolerantToMissingArchived(
    () => buscar(`${COLUNAS}, ${ARCHIVED_AT}`),
    () => buscar(COLUNAS),
  );
  return toPartnerSession(data as Record<string, unknown> | null);
}

function buildPartnerRow(input: {
  organizationId: string;
  provider?: string;
  accountId?: string;
  apiKeyEncrypted: string;
  webhookPathToken: string;
  webhookSecretEncrypted: string;
  phoneNumber: string | null;
  displayName: string;
}): Record<string, unknown> {
  const isOmnique = input.provider === "omnique" || input.provider === CHANNEL_PROVIDER_OMNIQUE || !input.accountId;
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    provider: isOmnique ? CHANNEL_PROVIDER_OMNIQUE : CHANNEL_PROVIDER_ZERNIO,
    webhook_path_token: input.webhookPathToken,
    webhook_secret_encrypted: input.webhookSecretEncrypted,
    phone_number: input.phoneNumber,
    display_name: input.displayName,
    status: "WORKING",
    archived_at: null,
  };
  if (isOmnique) {
    row.omnique_instance_id = input.accountId || "default";
    row.omnique_api_key_encrypted = input.apiKeyEncrypted;
  } else {
    row.zernio_account_id = input.accountId;
    row.zernio_token_encrypted = input.apiKeyEncrypted;
  }
  return row;
}

export async function savePartnerSession(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    existingId: string | null;
    provider?: string;
    accountId?: string;
    apiKeyEncrypted: string;
    webhookPathToken: string;
    webhookSecretEncrypted: string;
    phoneNumber: string | null;
    displayName: string;
  },
): Promise<{ error: string | null }> {
  const linha = buildPartnerRow(input);
  const { error } = input.existingId
    ? await admin.from("channel_sessions").update(linha).eq("id", input.existingId)
    : await admin.from("channel_sessions").insert({ ...linha, metadata: metadataInicialDoCanal() });

  return { error: error?.message ?? null };
}

export async function archivePartnerSession(
  admin: SupabaseClient,
  organizationId: string,
  sessionId?: string,
): Promise<{ error: string | null }> {
  let q = admin
    .from("channel_sessions")
    .update({ archived_at: new Date().toISOString(), status: "DISCONNECTED" })
    .eq("organization_id", organizationId)
    .in("provider", [CHANNEL_PROVIDER_OMNIQUE, CHANNEL_PROVIDER_ZERNIO]);

  if (sessionId) q = q.eq("id", sessionId);
  const { error } = await q;
  return { error: error?.message ?? null };
}
