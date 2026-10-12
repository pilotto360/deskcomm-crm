import crypto from "node:crypto";

export interface OmniqueInboundEvent {
  event: string;
  origin?: string;
  timestamp?: string;
  org_id?: string;
  delivery_id?: string;
  instanceId?: string;
  instance_id?: string;
  data: {
    message?: {
      id: string;
      from: string;
      to?: string;
      type: string;
      timestamp?: string;
      text?: { body: string } | string;
      image?: { link?: string; caption?: string; id?: string };
      audio?: { link?: string; id?: string };
      document?: { link?: string; filename?: string; caption?: string; id?: string };
      video?: { link?: string; caption?: string; id?: string };
      button?: { text?: string; payload?: string };
      interactive?: {
        type?: string;
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string; description?: string };
      };
    };
    echo?: {
      id: string;
      from: string;
      to: string;
      type: string;
      timestamp?: string;
      text?: { body: string } | string;
      button?: { text?: string; payload?: string };
      interactive?: {
        type?: string;
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string; description?: string };
      };
    };
    channel?: {
      id?: string;
      phone_number_id?: string;
      waba_id?: string;
      display_name?: string;
      type?: string;
    };
  };
}

export function validarAssinaturaOmnique(
  corpoCru: string,
  header: string | null,
  secret: string | null | undefined,
): boolean {
  if (!header || !secret) return true;

  const esperado = header.replace(/^sha256=/i, "").trim().toLowerCase();
  const hmac = crypto.createHmac("sha256", secret).update(corpoCru).digest("hex");
  const bufHmac = Buffer.from(hmac);
  const bufEsp = Buffer.from(esperado);
  if (bufHmac.length !== bufEsp.length) return false;
  return crypto.timingSafeEqual(bufHmac, bufEsp);
}

function extrairTextoInterativo(msgObj: {
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}): string | null {
  const btn = msgObj.button?.text || msgObj.button?.payload;
  if (btn && typeof btn === "string") return btn;

  const interativo = msgObj.interactive?.button_reply?.title || msgObj.interactive?.list_reply?.title;
  if (interativo && typeof interativo === "string") return interativo;

  return null;
}

export function extrairTextoMensagem(data: OmniqueInboundEvent["data"]): string | null {
  const msgObj = data.message ?? data.echo;
  if (!msgObj) return null;

  if (typeof msgObj.text === "string") return msgObj.text;
  if (msgObj.text && typeof msgObj.text === "object" && "body" in msgObj.text && typeof msgObj.text.body === "string") {
    return msgObj.text.body;
  }

  const textoBotao = extrairTextoInterativo(msgObj);
  if (textoBotao) return textoBotao;

  return data.message?.image?.caption ?? data.message?.document?.caption ?? null;
}
