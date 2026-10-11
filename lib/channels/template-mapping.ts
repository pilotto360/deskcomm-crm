/**
 * Motor de Associação e Resolução de Variáveis de Templates com Dados do CRM.
 *
 * Permite associar cada parâmetro de um modelo (ex: {{primeiro_nome}}, {{1}})
 * a campos do contato, da organização ou a valores fixos pré-definidos.
 */

export type VariableSourceType =
  | "contact.first_name"
  | "contact.name"
  | "contact.phone_number"
  | "contact.email"
  | "contact.custom_field"
  | "organization.name"
  | "user.name"
  | "fixed";

export interface VariableMappingRule {
  source: VariableSourceType;
  customFieldKey?: string;
  fixedValue?: string;
}

export type TemplateVariableMappings = Record<string, VariableMappingRule>;

export interface ContactData {
  name?: string | null;
  display_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface ResolveTemplateContext {
  contact?: ContactData | null;
  organizationName?: string | null;
  userName?: string | null;
  savedValues?: Record<string, unknown> | null;
}

/** Sugere a melhor associação padrão com base no nome e formato do slot. */
export function suggestDefaultMapping(
  key: string,
  expects?: string,
): VariableMappingRule {
  if (expects === "image" || expects === "video" || expects === "document") {
    return { source: "fixed" };
  }
  const normalized = key.toLowerCase().trim();
  if (normalized === "primeiro_nome" || normalized === "first_name") {
    return { source: "contact.first_name" };
  }
  if (normalized === "nome" || normalized === "name") {
    return { source: "contact.name" };
  }
  if (normalized === "telefone" || normalized === "phone") {
    return { source: "contact.phone_number" };
  }
  if (normalized === "email" || normalized === "e_mail") {
    return { source: "contact.email" };
  }
  if (normalized === "empresa" || normalized === "organizacao") {
    return { source: "organization.name" };
  }
  return { source: "contact.first_name" };
}

function extractFirstName(contact?: ContactData | null): string {
  const raw = contact?.name || contact?.display_name || "";
  const first = raw.trim().split(/\s+/)[0];
  return first ?? "";
}

function resolveContactFieldValue(
  source: VariableSourceType,
  contact?: ContactData | null,
): string {
  switch (source) {
    case "contact.first_name":
      return extractFirstName(contact);
    case "contact.name":
      return (contact?.name || contact?.display_name || "").trim();
    case "contact.phone_number":
      return (contact?.phone_number || "").trim();
    case "contact.email":
      return (contact?.email || "").trim();
    default:
      return "";
  }
}

/** Extrai o valor concreto de uma regra de mapeamento. */
export function resolveValueFromRule(
  rule: VariableMappingRule,
  ctx: ResolveTemplateContext,
): string {
  if (rule.source === "fixed") {
    return rule.fixedValue?.trim() ?? "";
  }
  if (rule.source === "organization.name") {
    return ctx.organizationName?.trim() ?? "";
  }
  if (rule.source === "user.name") {
    return ctx.userName?.trim() ?? "";
  }
  if (rule.source === "contact.custom_field") {
    const key = rule.customFieldKey?.trim();
    if (!key || !ctx.contact?.custom_fields) return "";
    const val = ctx.contact.custom_fields[key];
    return val != null ? String(val).trim() : "";
  }
  return resolveContactFieldValue(rule.source, ctx.contact);
}

export interface ResolveParams {
  rawValues?: Record<string, string>;
  mappings?: TemplateVariableMappings;
  slotKeys: string[];
  ctx: ResolveTemplateContext;
}

/**
 * Resolve todos os valores de um template:
 * 1. Usa valores explícitos informados na chamada.
 * 2. Aplica as regras de mapeamento salvas no template.
 * 3. Aplica heurísticas de fallback (ex.: primeiro nome para chaves conhecidas).
 */
export function resolveTemplateVariables(
  params: ResolveParams,
): Record<string, string> {
  const result: Record<string, string> = { ...(params.rawValues ?? {}) };
  const mappings = params.mappings ?? {};

  for (const key of params.slotKeys) {
    const existing = result[key] ?? result[`header:${key}`];
    if (existing?.trim()) continue;

    const rule = mappings[key] ?? mappings[`header:${key}`];
    if (rule) {
      const resolved = resolveValueFromRule(rule, params.ctx);
      if (resolved) {
        result[key] = resolved;
        continue;
      }
    }

    const fallbackRule = suggestDefaultMapping(key);
    const fallbackValue = resolveValueFromRule(fallbackRule, params.ctx);
    if (fallbackValue) {
      result[key] = fallbackValue;
    }
  }

  return result;
}
