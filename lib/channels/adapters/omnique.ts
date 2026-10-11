import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOmniqueCreds } from "../omnique/credentials";
import { omniqueTemplateOps } from "../omnique/templates";
import type {
  ChannelAdapter,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

function toE164Digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function extractOrderedValues(values: Record<string, string>): string[] {
  return Object.keys(values)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => values[k] ?? "");
}

function buildTemplateBody(params: string[]): unknown[] {
  if (params.length === 0) return [];
  return [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }];
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
  templates: omniqueTemplateOps,

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

  async sendTemplate(input: ChannelTenantScope & {
    beforeSend?: () => Promise<void>;
    sessionRef: string;
    to: string;
    providerConversationId?: string | null;
    name: string;
    language: string;
    values: Record<string, string>;
  }): Promise<{ externalId: string | null }> {
    const admin = createAdminClient();
    const creds = await resolveOmniqueCreds(admin, {
      organizationId: input.organizationId,
      instanceId: input.sessionRef,
    });
    if (!creds) throw new Error("omnique_not_configured: sem credencial configurada.");

    const recipient = toE164Digits(input.to);
    const params = extractOrderedValues(input.values);
    await input.beforeSend?.();

    const payload = {
      to: recipient,
      type: "template",
      template: {
        name: input.name,
        language: input.language || "pt_BR",
        components: buildTemplateBody(params),
      },
    };
    return postOmnique(creds.baseUrl, creds.apiKey, payload);
  },

  codes: {
    notConfigured: "omnique_not_configured",
    sendFailed: "omnique_send_failed",
    unknownError: "omnique_unknown_error",
  },
};

