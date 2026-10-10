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
}

export function omniqueBaseUrl(): string {
  const envUrl = process.env.OMNIQUE_API_BASE_URL?.trim();
  return envUrl || "https://bmsmuuzglqqoebaudcwk.supabase.co/functions/v1";
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
      .select("id, omnique_instance_id, omnique_api_key_encrypted")
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

  const row = data as { id: string; omnique_instance_id: string | null; omnique_api_key_encrypted: string | null } | null;
  if (!row || !row.omnique_api_key_encrypted) return null;

  const apiKey = await decryptWebhookSecret(admin, row.omnique_api_key_encrypted);
  if (!apiKey) return null;

  return {
    instanceId: row.omnique_instance_id || row.id,
    apiKey,
    baseUrl: omniqueBaseUrl(),
    source: "session",
  };
}

export async function validateOmniqueCredentials(
  apiKey: string,
): Promise<OmniqueValidation> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return { ok: false, reason: "Chave de API não informada." };

  try {
    const res = await fetch(`${omniqueBaseUrl()}/chat-manage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "numbers.list" }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: { data?: Array<{ display_phone_number?: string; verified_name?: string; id?: string }> };
      error?: string;
      detail?: string;
    };

    if (!res.ok || json.error) {
      return { ok: false, reason: json.detail || json.error || `HTTP ${res.status}` };
    }

    const firstNum = json.data?.data?.[0];
    return {
      ok: true,
      instanceId: firstNum?.id || "default",
      phoneNumber: firstNum?.display_phone_number ?? null,
      displayName: firstNum?.verified_name ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "rede_indisponivel";
    return { ok: false, reason: `Falha ao conectar com a Omnique: ${msg}` };
  }
}
