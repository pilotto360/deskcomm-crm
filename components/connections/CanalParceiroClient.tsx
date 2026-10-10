"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";
import { ChannelAiAccess } from "./ChannelAiAccess";
import { ParaIntegrar } from "./ParaIntegrar";

interface PartnerOption {
  id: string;
  label: string;
  requiresAccountId: boolean;
  keyPlaceholder: string;
  description: string;
  supportsBaseUrl?: boolean;
  supportsPhoneNumberId?: boolean;
  defaultBaseUrl?: string;
}

interface Estado {
  channel_session_id?: string | null;
  label: string;
  connected: boolean;
  provider?: string;
  options?: PartnerOption[];
  account_id: string | null;
  phone_number: string | null;
  display_name: string | null;
  status: string | null;
  has_api_key: boolean;
  webhook_url: string | null;
  endpoint: string | null;
  base_url?: string | null;
  phone_number_id?: string | null;
}

interface Conectado {
  webhook_url: string;
  webhook_secret: string;
  phone_number: string | null;
  quality_rating: string | null;
}

function ParaColar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">{valor}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await copyToClipboard(valor);
            toast.success(t("Copiado."));
          }}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

export function CanalParceiroClient() {
  const t = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [accountId, setAccountId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [recemConectado, setRecemConectado] = useState<Conectado | null>(null);

  const carregar = async () => {
    try {
      const r = await apiClient.get<{ data: Estado }>("/api/v1/channels/partner");
      setEstado(r.data);
      const prov = r.data.provider || r.data.options?.[0]?.id || "";
      setSelectedProvider(prov);
      if (r.data.account_id) setAccountId(r.data.account_id);
      if (r.data.phone_number_id) setPhoneNumberId(r.data.phone_number_id);
      if (r.data.base_url || r.data.endpoint) {
        setBaseUrl(r.data.base_url || r.data.endpoint || "");
      }
    } catch {
      setEstado(null);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const conectar = async () => {
    setSalvando(true);
    try {
      const payload: Record<string, string> = { api_key: apiKey };
      if (selectedProvider) payload.provider = selectedProvider;
      if (requiresAccount && accountId) payload.account_id = accountId;
      if (supportsPhoneNumberId && phoneNumberId.trim()) {
        payload.phone_number_id = phoneNumberId.trim();
      }
      if (supportsBaseUrl && baseUrl.trim()) {
        payload.base_url = baseUrl.trim();
      }
      const r = await apiClient.post<{ data: Conectado }>("/api/v1/channels/partner", payload);
      setRecemConectado(r.data);
      setApiKey("");
      toast.success(t("Canal conectado."));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível conectar."));
    } finally {
      setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (!confirm(t("Deseja realmente desconectar este canal?"))) return;
    setSalvando(true);
    try {
      await apiClient.delete("/api/v1/channels/partner");
      setRecemConectado(null);
      toast.success(t("Canal desconectado."));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Falha ao desconectar."));
    } finally {
      setSalvando(false);
    }
  };

  const currentOption = estado?.options?.find((o) => o.id === selectedProvider) ?? estado?.options?.[0];
  const supportsBaseUrl = currentOption?.supportsBaseUrl ?? false;
  const supportsPhoneNumberId = currentOption?.supportsPhoneNumberId ?? false;
  const requiresAccount = currentOption?.requiresAccountId ?? !estado?.options;
  const conectado = estado?.connected ?? false;
  const rotulo = estado?.label ?? currentOption?.label ?? t("provedor parceiro");
  const podeSalvar = salvando || !apiKey || (requiresAccount && !accountId);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t("Conectar por")} {rotulo}
            </h3>
            <p className="text-xs text-muted-foreground">
              {currentOption?.description ??
                t("Um número oficial conectado através do provedor. As mensagens entram e saem pelo CRM.")}
            </p>
          </div>
          {conectado ? (
            <Badge variant="secondary">{t("Conectado")}</Badge>
          ) : (
            <Badge variant="outline">{t("Não conectado")}</Badge>
          )}
        </div>

        {estado?.options && estado.options.length > 1 && !conectado && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Provedor:")}</span>
            {estado.options.map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={selectedProvider === opt.id ? "default" : "outline"}
                onClick={() => setSelectedProvider(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}

        {conectado && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium">{estado?.display_name ?? t("Número conectado")}</p>
              <p className="text-xs text-muted-foreground">
                {estado?.phone_number ?? t("sem número informado")} · {estado?.status ?? "—"}
                {estado?.account_id && ` · ID: ${estado.account_id}`}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={desconectar} disabled={salvando}>
              {t("Desconectar")}
            </Button>
          </div>
        )}

        {estado?.channel_session_id && <ChannelAiAccess channelId={estado.channel_session_id} />}

        <div className="flex flex-col gap-3">
          {supportsBaseUrl && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="parceiro-base-url">{t("URL Base do Provedor")}</Label>
              <Input
                id="parceiro-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={currentOption?.defaultBaseUrl || estado?.endpoint || "https://..."}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t("Endpoint das Cloud Functions da API parceira.")}
              </p>
            </div>
          )}

          {supportsPhoneNumberId && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="parceiro-phone-id">{t("Phone Number ID")}</Label>
              <Input
                id="parceiro-phone-id"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder={t("ex: 104829104810293 (opcional se houver 1 número)")}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t("ID do número na Meta. Se vazio, o sistema detecta automaticamente na conta.")}
              </p>
            </div>
          )}

          {requiresAccount && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="parceiro-conta">{t("Conta / Account ID")}</Label>
              <Input
                id="parceiro-conta"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={t("id da conta conectada no provedor")}
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="parceiro-chave">{t("Chave de API")}</Label>
            <Input
              id="parceiro-chave"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                estado?.has_api_key
                  ? t("gravada — preencha para trocar")
                  : currentOption?.keyPlaceholder || t("cole a chave")
              }
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t("Guardada cifrada. A credencial é testada antes de ser gravada.")}
            </p>
          </div>

          <div>
            <Button onClick={conectar} disabled={podeSalvar}>
              {salvando ? t("Verificando…") : conectado ? t("Reconectar") : t("Conectar")}
            </Button>
          </div>
        </div>
      </Card>

      {recemConectado && (
        <Card className="flex flex-col gap-4 border-warning/40 bg-warning-bg p-4">
          <div>
            <h3 className="text-sm font-semibold">{t("Configurar Webhook no provedor")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("Cole a URL abaixo nas configurações de webhook do seu provedor para receber as mensagens.")}
            </p>
          </div>
          <ParaColar rotulo={t("URL do webhook")} valor={recemConectado.webhook_url} />
          {recemConectado.webhook_secret && (
            <ParaColar rotulo={t("Segredo (assinatura)")} valor={recemConectado.webhook_secret} />
          )}
        </Card>
      )}

      {conectado && !recemConectado && estado?.webhook_url && (
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">Webhook</h3>
            <p className="text-xs text-muted-foreground">
              {t("Endereço configurado no seu provedor para entregar as mensagens.")}
            </p>
          </div>
          <ParaColar rotulo={t("URL do webhook")} valor={estado.webhook_url} />
        </Card>
      )}

      {conectado && estado?.endpoint && (
        <ParaIntegrar
          campos={[
            { rotulo: t("Endpoint da API"), valor: estado.endpoint },
            { rotulo: t("Identificador"), valor: estado.account_id ?? estado.phone_number },
          ]}
          ajuda={
            <p className="text-xs text-muted-foreground">
              {t("Utilize os dados acima para integrar outros serviços, se necessário.")}
            </p>
          }
        />
      )}
    </div>
  );
}
