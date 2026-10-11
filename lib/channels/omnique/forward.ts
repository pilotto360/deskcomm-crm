import crypto from "node:crypto";
import { logger } from "@/lib/logger";

export interface ForwardOmniqueWebhookParams {
  rawBody: string;
  signature: string | null;
  conversationId?: string;
  messageId?: string;
  forwardUrl?: string;
  secret?: string | null;
}

export interface ForwardResult {
  forwarded: boolean;
  status?: number;
  error?: string;
}

export function resolveForwardUrl(overrideUrl?: string): string | null {
  return overrideUrl || process.env.OMNIQUE_FORWARD_WEBHOOK_URL || null;
}

function buildForwardHeaders(params: ForwardOmniqueWebhookParams): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  let sig = params.signature;
  const secret = params.secret || process.env.OMNIQUE_WEBHOOK_SECRET;
  if (!sig && secret && params.rawBody) {
    const hmac = crypto.createHmac("sha256", secret).update(params.rawBody).digest("hex");
    sig = `sha256=${hmac}`;
  }
  if (sig) {
    headers["x-omnique-signature-256"] = sig;
  }
  if (params.conversationId) {
    headers["x-deskcomm-conversation-id"] = params.conversationId;
  }
  if (params.messageId) {
    headers["x-deskcomm-message-id"] = params.messageId;
  }
  return headers;
}

export async function forwardOmniqueWebhook(
  params: ForwardOmniqueWebhookParams,
): Promise<ForwardResult> {
  const targetUrl = resolveForwardUrl(params.forwardUrl);
  if (!targetUrl) {
    logger.warn("omnique-forward: repasse ignorado — OMNIQUE_FORWARD_WEBHOOK_URL não configurada");
    return { forwarded: false };
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: buildForwardHeaders(params),
      body: params.rawBody,
      signal: AbortSignal.timeout(10000),
    });

    logger.info("omnique-forward: webhook repassado com sucesso", {
      targetUrl,
      status: response.status,
      conversationId: params.conversationId,
    });

    return { forwarded: true, status: response.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("omnique-forward: falha ao repassar webhook para agente externo", {
      targetUrl,
      error: msg,
    });
    return { forwarded: false, error: msg };
  }
}
