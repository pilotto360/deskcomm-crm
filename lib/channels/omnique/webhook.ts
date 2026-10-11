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
    };
    echo?: {
      id: string;
      from: string;
      to: string;
      type: string;
      timestamp?: string;
      text?: { body: string } | string;
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

export function extrairTextoMensagem(data: OmniqueInboundEvent["data"]): string | null {
  const msgObj = data.message ?? data.echo;
  if (!msgObj) return null;

  if (typeof msgObj.text === "string") return msgObj.text;
  if (msgObj.text && typeof msgObj.text === "object" && "body" in msgObj.text && typeof msgObj.text.body === "string") {
    return msgObj.text.body;
  }

  const imgCaption = data.message?.image?.caption;
  if (imgCaption) return imgCaption;
  const docCaption = data.message?.document?.caption;
  if (docCaption) return docCaption;
  return null;
}
