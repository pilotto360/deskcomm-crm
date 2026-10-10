import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOmniqueCreds } from "../omnique/credentials";
import type {
  ChannelAdapter,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

function toE164Digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function buildPayload(envelope: OutboundEnvelope, recipient: string): Record<string, unknown> {
  const base: Record<string, unknown> = { to: recipient };

  if (envelope.media) {
    base.type = envelope.kind;
    base.media = {
      link: envelope.media.url,
      caption: envelope.body || undefined,
    };
    return base;
  }

  base.type = "text";
  base.text = envelope.body || "";
  return base;
}

async function postOmnique(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ externalId: string | null }> {
  const res = await fetch(`${baseUrl}/chat-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
    detail?: string;
  };

  if (!res.ok || json.error) {
    const motivo = json.detail || json.error || `HTTP ${res.status}`;
    throw new Error(`omnique_send_failed: ${motivo}`);
  }

  return { externalId: json.id || null };
}

export const omniqueAdapter: ChannelAdapter = {
  provider: "omnique",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;
    const raw = input.phoneNumber || null;
    if (!raw) return null;
    const digits = toE164Digits(raw);
    return digits.length > 0 ? digits : null;
  },

  isConfigured(): boolean {
    return true;
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const admin = createAdminClient();
    const creds = await resolveOmniqueCreds(admin, {
      organizationId: envelope.organizationId,
      instanceId: envelope.sessionRef,
    });

    if (!creds) {
      throw new Error("omnique_not_configured: nenhuma credencial configurada.");
    }

    const recipient = toE164Digits(envelope.to);
    const payload = buildPayload(envelope, recipient);
    return postOmnique(creds.baseUrl, creds.apiKey, payload);
  },

  codes: {
    notConfigured: "omnique_not_configured",
    sendFailed: "omnique_send_failed",
    unknownError: "omnique_unknown_error",
  },
};
