import crypto from "node:crypto";

export interface OmniqueInboundEvent {
  event: string;
  origin?: string;
  timestamp?: string;
  org_id?: string;
  delivery_id?: string;
  data: {
    message?: {
      id: string;
      from: string;
      to?: string;
      type: string;
      timestamp?: string;
      text?: { body: string };
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
      text?: { body: string };
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
  if (!secret) return true;
  if (!header) return false;

  const esperado = header.replace(/^sha256=/i, "").trim().toLowerCase();
  const hmac = crypto.createHmac("sha256", secret).update(corpoCru).digest("hex");
  const bufHmac = Buffer.from(hmac);
  const bufEsp = Buffer.from(esperado);
  if (bufHmac.length !== bufEsp.length) return false;
  return crypto.timingSafeEqual(bufHmac, bufEsp);
}

export function extrairTextoMensagem(data: OmniqueInboundEvent["data"]): string | null {
  if (data.message?.text?.body) return data.message.text.body;
  if (data.echo?.text?.body) return data.echo.text.body;
  const imgCaption = data.message?.image?.caption;
  if (imgCaption) return imgCaption;
  const docCaption = data.message?.document?.caption;
  if (docCaption) return docCaption;
  return null;
}
