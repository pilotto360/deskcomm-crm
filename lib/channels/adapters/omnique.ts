import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOmniqueCreds } from "../omnique/credentials";
import { omniqueTemplateOps } from "../omnique/templates";
import type {
  ChannelAdapter,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveTemplateContract } from "../meta/template-contract";
import { buildComponents } from "../meta/build-components";

function toE164Digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function extractHeaderExample(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const header = components.find(
    (c) => (c?.type ?? "").toUpperCase() === "HEADER" && (c?.format ?? "").toUpperCase() === "IMAGE",
  );
  const handles = header?.example?.header_handle;
  return Array.isArray(handles) && typeof handles[0] === "string" ? handles[0].trim() : null;
}

function buildFallbackComponents(values: Record<string, string>): unknown[] {
  const comps: unknown[] = [];
  const headerUrl = values["header:1"] || values["header"];
  if (headerUrl) {
    comps.push({ type: "header", parameters: [{ type: "image", image: { link: headerUrl } }] });
  }
  const bodyParams = Object.entries(values)
    .filter(([k]) => !k.startsWith("header"))
    .map(([k, text]) => (/^\d+$/.test(k) ? { type: "text", text } : { type: "text", parameter_name: k, text }));
  if (bodyParams.length > 0) {
    comps.push({ type: "body", parameters: bodyParams });
  }
  return comps;
}

interface ResolveTemplateInput {
  organizationId: string;
  name: string;
  language: string;
  values: Record<string, string>;
}

import { isTemporaryMediaUrl, mirrorTemplateMedia } from "../template-media-mirror";

interface HeaderMirrorTarget {
  organizationId: string;
  name: string;
  url: string;
}

async function ensureMirroredHeader(
  admin: SupabaseClient,
  target: HeaderMirrorTarget,
): Promise<string> {
  if (!isTemporaryMediaUrl(target.url)) return target.url;
  const mirrored = await mirrorTemplateMedia(admin, {
    organizationId: target.organizationId,
    templateName: target.name,
    sourceUrl: target.url,
  });
  return mirrored ?? target.url;
}

async function resolveOmniqueComponents(
  admin: SupabaseClient,
  input: ResolveTemplateInput,
): Promise<unknown[]> {
  if (typeof admin?.from !== "function") {
    return buildFallbackComponents(input.values);
  }

  const { data: tpl } = await admin
    .from("meta_templates")
    .select("name, language, parameter_format, components, saved_values")
    .eq("organization_id", input.organizationId)
    .eq("name", input.name)
    .eq("language", input.language)
    .maybeSingle();

  if (!tpl) return buildFallbackComponents(input.values);

  const saved = (tpl.saved_values as Record<string, string> | null) ?? {};
  const merged: Record<string, string> = { ...saved, ...input.values };
  if (!merged["header:1"]) {
    const fallbackHeader = extractHeaderExample(tpl.components);
    if (fallbackHeader) merged["header:1"] = fallbackHeader;
  }

  if (merged["header:1"]) {
    merged["header:1"] = await ensureMirroredHeader(admin, {
      organizationId: input.organizationId,
      name: input.name,
      url: merged["header:1"],
    });
  }

  const contract = deriveTemplateContract({
    name: tpl.name,
    language: tpl.language,
    parameter_format: tpl.parameter_format,
    components: tpl.components as never,
  });

  try {
    return buildComponents(contract, merged);
  } catch {
    return buildFallbackComponents(merged);
  }
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
    const components = await resolveOmniqueComponents(admin, {
      organizationId: input.organizationId,
      name: input.name,
      language: input.language || "pt_BR",
      values: input.values,
    });
    await input.beforeSend?.();

    const payload = {
      to: recipient,
      type: "template",
      template: {
        name: input.name,
        language: input.language || "pt_BR",
        components,
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

