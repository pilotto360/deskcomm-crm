import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOmniqueCreds } from "./credentials";
import type {
  ChannelTemplate,
  ChannelTemplateDraft,
  ChannelTemplateOps,
} from "../types";

interface RawOmniqueTemplate {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string | null;
  components?: unknown[];
  rejected_reason?: string | null;
  rejectedReason?: string | null;
  parameter_format?: string | null;
  parameterFormat?: string | null;
}

function toNeutral(t: RawOmniqueTemplate): ChannelTemplate {
  return {
    name: t.name ?? "",
    language: t.language ?? "",
    status: t.status ?? "UNKNOWN",
    category: t.category ?? null,
    components: Array.isArray(t.components) ? t.components : [],
    rejectedReason: t.rejected_reason ?? t.rejectedReason ?? null,
    parameterFormat: t.parameter_format ?? t.parameterFormat ?? null,
  };
}

function extractTemplateList(data: unknown): RawOmniqueTemplate[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as RawOmniqueTemplate[];
    if (Array.isArray(obj.templates)) return obj.templates as RawOmniqueTemplate[];
  }
  return [];
}

interface OmniqueScope {
  organizationId: string;
  instanceId: string;
}

async function resolveCredentials(scope: OmniqueScope) {
  const admin = createAdminClient();
  const c = await resolveOmniqueCreds(admin, {
    organizationId: scope.organizationId,
    instanceId: scope.instanceId,
  });
  if (!c) throw new Error("omnique_not_configured: sem credencial para esta conta.");
  return c;
}

async function callOmniqueManage<T>(
  scope: OmniqueScope,
  body: Record<string, unknown>,
): Promise<T> {
  const c = await resolveCredentials(scope);
  const res = await fetch(`${c.baseUrl}/chat-manage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: string;
    detail?: string;
  } | null;

  if (!res.ok || json?.error) {
    const detalhe = json?.detail || json?.error || `HTTP ${res.status}`;
    throw new Error(`omnique_template_failed: ${detalhe}`);
  }

  return (json?.data ?? (json as T)) as T;
}

export const omniqueTemplateOps: ChannelTemplateOps = {
  async list({ organizationId, sessionRef }): Promise<ChannelTemplate[]> {
    const raw = await callOmniqueManage<unknown>(
      { organizationId, instanceId: sessionRef },
      { action: "templates.list", limit: 100 },
    );
    const lista = extractTemplateList(raw);
    return lista.map(toNeutral);
  },

  async create({ organizationId, sessionRef, draft }): Promise<ChannelTemplate> {
    const raw = await callOmniqueManage<RawOmniqueTemplate>(
      { organizationId, instanceId: sessionRef },
      {
        action: "templates.create",
        name: draft.name,
        language: draft.language,
        category: draft.category,
        components: draft.components,
      },
    );
    return toNeutral(raw);
  },

  async update({ organizationId, sessionRef, name, patch }): Promise<ChannelTemplate> {
    const raw = await callOmniqueManage<RawOmniqueTemplate>(
      { organizationId, instanceId: sessionRef },
      {
        action: "templates.update",
        name,
        ...(patch.components ? { components: patch.components } : {}),
        ...(patch.category ? { category: patch.category } : {}),
      },
    );
    return toNeutral(raw);
  },

  async remove({ organizationId, sessionRef, name, language }): Promise<void> {
    await callOmniqueManage<unknown>(
      { organizationId, instanceId: sessionRef },
      {
        action: "templates.delete",
        name,
        ...(language ? { hsm_id: language } : {}),
      },
    );
  },
};
