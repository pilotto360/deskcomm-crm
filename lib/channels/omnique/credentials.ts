import type { SupabaseClient } from "@supabase/supabase-js";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface OmniqueCredentials {
  instanceId: string;
  apiKey: string;
  baseUrl: string;
  source: "session" | "env";
}

export interface OmniqueCredsLookup {
  organizationId: string;
  instanceId?: string;
}

export interface OmniqueValidation {
  ok: boolean;
  instanceId?: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  reason?: string;
  baseUrl?: string;
}

export function omniqueBaseUrl(): string {
  const envUrl = process.env.OMNIQUE_API_BASE_URL?.trim();
  return envUrl || "https://auth.omnique.com.br/functions/v1";
}

export async function resolveOmniqueCreds(
  admin: SupabaseClient,
  lookup: OmniqueCredsLookup,
): Promise<OmniqueCredentials | null> {
  const { organizationId, instanceId } = lookup;
  if (!organizationId) return null;

  const base = () => {
    let q = admin
      .from("channel_sessions")
      .select("id, omnique_instance_id, omnique_api_key_encrypted, metadata")
      .eq("organization_id", organizationId)
      .eq("provider", "omnique");
    if (instanceId) q = q.eq("omnique_instance_id", instanceId);
    return q;
  };

  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (error) {
    throw new Error(`omnique_creds_lookup_failed: ${error.code} ${error.message}`);
  }

  const row = data as {
    id: string;
    omnique_instance_id: string | null;
    omnique_api_key_encrypted: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  if (!row || !row.omnique_api_key_encrypted) return null;

  const apiKey = await decryptWebhookSecret(admin, row.omnique_api_key_encrypted);
  if (!apiKey) return null;

  const metaUrl = typeof row.metadata?.omnique_base_url === "string" ? row.metadata.omnique_base_url.trim() : "";

  return {
    instanceId: row.omnique_instance_id || row.id,
    apiKey,
    baseUrl: metaUrl || omniqueBaseUrl(),
    source: "session",
  };
}

export interface ValidateOmniqueInput {
  apiKey: string;
  baseUrl?: string;
  phoneNumberId?: string;
}

interface OmniqueNumberItem {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
}

function selectOmniqueNumber(
  numbers: OmniqueNumberItem[],
  preferredId?: string,
): { instanceId: string; phoneNumber: string | null; displayName: string | null } {
  const cleanPref = preferredId?.trim();
  const matched = cleanPref ? numbers.find((n) => n.id === cleanPref) : undefined;
  const chosen = matched ?? numbers[0];

  return {
    instanceId: chosen?.id || cleanPref || "default",
    phoneNumber: chosen?.display_phone_number ?? null,
    displayName: chosen?.verified_name ?? null,
  };
}

export async function validateOmniqueCredentials(
  input: ValidateOmniqueInput | string,
): Promise<OmniqueValidation> {
  const opts = typeof input === "string" ? { apiKey: input } : input;
  const cleanKey = opts.apiKey.trim();
  if (!cleanKey) return { ok: false, reason: "Chave de API não informada." };

  const endpoint = opts.baseUrl?.trim() || omniqueBaseUrl();

  try {
    const res = await fetch(`${endpoint}/chat-manage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "numbers.list" }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: { data?: OmniqueNumberItem[] };
      error?: string;
      detail?: string;
    };

    if (!res.ok || json.error) {
      return { ok: false, reason: json.detail || json.error || `HTTP ${res.status}` };
    }

    const numbers = json.data?.data ?? [];
    const selected = selectOmniqueNumber(numbers, opts.phoneNumberId);
    return {
      ok: true,
      instanceId: selected.instanceId,
      phoneNumber: selected.phoneNumber,
      displayName: selected.displayName,
      baseUrl: endpoint,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "rede_indisponivel";
    return { ok: false, reason: `Falha ao conectar com a Omnique: ${msg}` };
  }
}
