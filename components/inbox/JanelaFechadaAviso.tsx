"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { fonteDeTemplates, rotaDeTemplates } from "@/lib/channels/templates-fonte";
import { lerConteudo } from "@/lib/channels/template-conteudo";
import { cn } from "@/lib/utils";

interface ModeloSlot {
  key: string;
  expects: string;
  onde: string;
}

interface ModeloAprovado {
  name: string;
  language: string;
  status: string;
  slots?: ModeloSlot[];
  components?: unknown[];
  saved_values?: Record<string, string>;
}

function extractHeaderExample(components?: unknown[]): string | null {
  if (!Array.isArray(components)) return null;
  const header = components.find(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      String((c as Record<string, unknown>).type).toUpperCase() === "HEADER" &&
      String((c as Record<string, unknown>).format).toUpperCase() === "IMAGE",
  ) as Record<string, unknown> | undefined;
  const example = header?.example as Record<string, unknown> | undefined;
  const handles = example?.header_handle;
  return Array.isArray(handles) && typeof handles[0] === "string" ? handles[0].trim() : null;
}

function textoDoModelo(modelo: ModeloAprovado, valores?: Record<string, string>): string {
  let body = lerConteudo(modelo.components ?? []).body?.trim() || modelo.name;
  if (valores) {
    for (const [k, v] of Object.entries(valores)) {
      if (v) body = body.replaceAll(`{{${k}}}`, v);
    }
  }
  return body;
}

import {
  resolveTemplateVariables,
  type TemplateVariableMappings,
} from "@/lib/channels/template-mapping";

function computeInitialValues(
  atual: ModeloAprovado,
  contactName?: string | null,
): Record<string, string> {
  const initial: Record<string, string> = {};
  const headerHandle = extractHeaderExample(atual.components);
  const rawMappings = (atual.saved_values as Record<string, unknown> | undefined)?.mappings;
  const mappings = rawMappings as TemplateVariableMappings | undefined;

  const resolved = resolveTemplateVariables({
    rawValues: {},
    mappings,
    slotKeys: (atual.slots ?? []).map((s) => s.key),
    ctx: {
      contact: contactName ? { name: contactName } : null,
      savedValues: atual.saved_values,
    },
  });

  for (const s of atual.slots ?? []) {
    if (s.expects === "image") {
      const img = (atual.saved_values as Record<string, string> | undefined)?.["header:1"] || headerHandle || "";
      initial[s.key] = img;
      initial[`header:${s.key}`] = img;
    } else {
      initial[s.key] = resolved[s.key] ?? "";
    }
  }
  return initial;
}

interface JanelaFechadaAvisoProps {
  conversationId: string;
  provider: string | null;
  motivo: string;
  contactName?: string | null;
}

export function JanelaFechadaAviso({
  conversationId,
  provider,
  motivo,
  contactName,
}: JanelaFechadaAvisoProps) {
  const t = useT();
  const send = useSendMessage();
  const [escolhido, setEscolhido] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});

  const fonte = fonteDeTemplates(provider);
  const { data } = useQuery({
    queryKey: ["templates-da-conversa", fonte],
    enabled: fonte !== null,
    queryFn: async () =>
      apiClient.get<{ data: { templates: ModeloAprovado[] } }>(rotaDeTemplates(fonte!)),
    staleTime: 30_000,
  });

  const aprovados = useMemo(
    () => (data?.data.templates ?? []).filter((tpl) => tpl.status?.toUpperCase() === "APPROVED"),
    [data],
  );

  const atual = aprovados.find((tpl) => `${tpl.name}|${tpl.language}` === escolhido) ?? null;
  const slotsObrigatorios = atual?.slots ?? [];

  useEffect(() => {
    if (!atual) {
      setValores({});
      return;
    }
    setValores(computeInitialValues(atual, contactName));
  }, [atual, contactName]);

  const faltando = slotsObrigatorios.some((s) => {
    const val = valores[s.key] || valores[`header:${s.key}`] || "";
    return !val.trim();
  });

  function enviar() {
    if (!atual) return;
    send.mutate(
      {
        conversation_id: conversationId,
        type: "template",
        template_name: atual.name,
        template_language: atual.language,
        template_values: valores,
        body: textoDoModelo(atual, valores),
      },
      {
        onSuccess: () => {
          setEscolhido("");
          setValores({});
          toast.success(t("Modelo enviado — a janela reabre quando o cliente responder."));
        },
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : t("Não consegui enviar o modelo.")),
      },
    );
  }

  if (!fonte) return <p role="status" className="border-t px-4 py-3 text-sm text-muted-foreground">{motivo}</p>;

  return (
    <div className="border-t border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
      <p className="mb-2 text-xs text-amber-900 dark:text-amber-200">{motivo}</p>

      {aprovados.length === 0 ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
          {t("Nenhum modelo aprovado ainda. Crie um em")} <strong>{t("Conexões → Templates")}</strong>{" "}
          {t("e envie quando a plataforma aprovar.")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={escolhido}
              onChange={(e) => setEscolhido(e.target.value)}
              disabled={send.isPending}
              aria-label={t("Modelo aprovado")}
              className={cn(
                "h-9 min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 text-sm",
                "focus:outline-hidden focus:ring-1 focus:ring-ring",
              )}
            >
              <option value="">{t("Escolha um modelo aprovado…")}</option>
              {aprovados.map((tpl) => (
                <option key={`${tpl.name}|${tpl.language}`} value={`${tpl.name}|${tpl.language}`}>
                  {tpl.name} ({tpl.language})
                  {(tpl.slots?.length ?? 0) > 0 ? ` · ${tpl.slots!.length} ${t("parâmetro(s)")}` : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={enviar}
              disabled={!atual || send.isPending || faltando}
            >
              {send.isPending ? t("Enviando…") : t("Enviar modelo")}
            </Button>
          </div>

          {atual && slotsObrigatorios.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-100/40 p-2 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {t("Parâmetros do modelo:")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {slotsObrigatorios.map((slot) => {
                  const val = valores[slot.key] ?? valores[`header:${slot.key}`] ?? "";
                  return (
                    <div key={slot.key} className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
                        {slot.onde} ({slot.key}):
                      </label>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => {
                          const v = e.target.value;
                          setValores((prev) => ({
                            ...prev,
                            [slot.key]: v,
                            ...(slot.expects === "image" ? { [`header:${slot.key}`]: v } : {}),
                          }));
                        }}
                        placeholder={slot.expects === "image" ? "https://..." : t("Digite o valor...")}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
