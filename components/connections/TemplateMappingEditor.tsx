"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import {
  suggestDefaultMapping,
  type VariableSourceType,
  type VariableMappingRule,
  type TemplateVariableMappings,
} from "@/lib/channels/template-mapping";

export interface TemplateSlotInfo {
  key: string;
  expects: string;
  onde: string;
}

interface TemplateMappingEditorProps {
  templateName: string;
  templateLanguage: string;
  slots: TemplateSlotInfo[];
  savedValues?: Record<string, unknown>;
  onSaved?: () => void;
}

interface LocalRuleState {
  source: VariableSourceType;
  customFieldKey: string;
  fixedValue: string;
}

const FONTES_DISPONIVEIS: { value: VariableSourceType; label: string }[] = [
  { value: "contact.first_name", label: "Primeiro nome do contato" },
  { value: "contact.name", label: "Nome completo do contato" },
  { value: "contact.phone_number", label: "Telefone do contato" },
  { value: "contact.email", label: "E-mail do contato" },
  { value: "contact.custom_field", label: "Campo personalizado do contato" },
  { value: "organization.name", label: "Nome da organização" },
  { value: "user.name", label: "Nome do atendente" },
  { value: "fixed", label: "Valor fixo personalizado" },
];

function initRulesFromProps(
  slots: TemplateSlotInfo[],
  saved?: Record<string, unknown>,
): Record<string, LocalRuleState> {
  const existingMappings = (saved?.mappings as TemplateVariableMappings) ?? {};
  const rules: Record<string, LocalRuleState> = {};

  for (const slot of slots) {
    const existing = existingMappings[slot.key];
    if (existing) {
      rules[slot.key] = {
        source: existing.source,
        customFieldKey: existing.customFieldKey ?? "",
        fixedValue: existing.fixedValue ?? "",
      };
      continue;
    }
    if (slot.expects === "image" || slot.expects === "video" || slot.expects === "document") {
      const headerVal = typeof saved?.["header:1"] === "string" ? saved["header:1"] : "";
      rules[slot.key] = { source: "fixed", customFieldKey: "", fixedValue: headerVal };
      continue;
    }
    const def = suggestDefaultMapping(slot.key, slot.expects);
    rules[slot.key] = {
      source: def.source,
      customFieldKey: def.customFieldKey ?? "",
      fixedValue: def.fixedValue ?? "",
    };
  }
  return rules;
}

export function TemplateMappingEditor({
  templateName,
  templateLanguage,
  slots,
  savedValues,
  onSaved,
}: TemplateMappingEditorProps) {
  const t = useT();
  const [salvando, setSalvando] = useState(false);
  const [rules, setRules] = useState<Record<string, LocalRuleState>>(() =>
    initRulesFromProps(slots, savedValues),
  );

  function updateSlotSource(key: string, source: VariableSourceType) {
    setRules((prev) => ({
      ...prev,
      [key]: { ...prev[key]!, source },
    }));
  }

  function updateSlotCustomKey(key: string, customFieldKey: string) {
    setRules((prev) => ({
      ...prev,
      [key]: { ...prev[key]!, customFieldKey },
    }));
  }

  function updateSlotFixedValue(key: string, fixedValue: string) {
    setRules((prev) => ({
      ...prev,
      [key]: { ...prev[key]!, fixedValue },
    }));
  }

  async function handleSalvar() {
    setSalvando(true);
    const mappings: TemplateVariableMappings = {};
    const extraSavedValues: Record<string, string> = {};

    for (const slot of slots) {
      const r = rules[slot.key]!;
      const mappingRule: VariableMappingRule = { source: r.source };
      if (r.source === "contact.custom_field") mappingRule.customFieldKey = r.customFieldKey;
      if (r.source === "fixed") mappingRule.fixedValue = r.fixedValue;
      mappings[slot.key] = mappingRule;

      if (slot.expects === "image" && r.source === "fixed" && r.fixedValue) {
        extraSavedValues["header:1"] = r.fixedValue;
      }
    }

    try {
      await apiClient.patch("/api/v1/channels/partner/templates", {
        name: templateName,
        language: templateLanguage,
        mappings,
        saved_values: extraSavedValues,
      });
      toast.success(t("Associação de variáveis salva com sucesso!"));
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Falha ao salvar associação."));
    } finally {
      setSalvando(false);
    }
  }

  if (slots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("Este modelo não possui parâmetros para associar.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="text-xs font-semibold text-foreground">
          {t("Associação de Variáveis com o CRM")}
        </h4>
        <Button size="sm" onClick={handleSalvar} disabled={salvando}>
          {salvando ? t("Salvando…") : t("Salvar Associação")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((slot) => {
          const rule = rules[slot.key] ?? { source: "contact.first_name", customFieldKey: "", fixedValue: "" };
          const isMedia = slot.expects === "image" || slot.expects === "video" || slot.expects === "document";

          return (
            <div key={slot.key} className="flex flex-col gap-1.5 rounded-md border p-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {slot.onde} ({`{{${slot.key}}}`})
                </span>
                <span className="text-[10px] uppercase font-mono px-1 rounded bg-muted text-muted-foreground">
                  {slot.expects}
                </span>
              </div>

              {!isMedia ? (
                <>
                  <select
                    value={rule.source}
                    onChange={(e) => updateSlotSource(slot.key, e.target.value as VariableSourceType)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {FONTES_DISPONIVEIS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {t(f.label)}
                      </option>
                    ))}
                  </select>

                  {rule.source === "contact.custom_field" && (
                    <input
                      type="text"
                      placeholder={t("Nome do campo personalizado (ex: codigo)")}
                      value={rule.customFieldKey}
                      onChange={(e) => updateSlotCustomKey(slot.key, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                  )}

                  {rule.source === "fixed" && (
                    <input
                      type="text"
                      placeholder={t("Valor fixo a enviar")}
                      value={rule.fixedValue}
                      onChange={(e) => updateSlotFixedValue(slot.key, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">
                    {t("URL pública do arquivo (Supabase Storage):")}
                  </label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={rule.fixedValue}
                    onChange={(e) => updateSlotFixedValue(slot.key, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
