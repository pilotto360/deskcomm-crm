import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhoneBR } from "../phone-variants";
import { encontrarContatoPorTelefone } from "../contato-por-telefone";
import { marcarConversaComMensagem } from "../marcar-conversa";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { pausarIaPorAtendimentoManual } from "@/lib/escalacao/atendimento-manual";
import { extrairTextoMensagem, type OmniqueInboundEvent, type OmniqueStatusData } from "./webhook";

type Admin = SupabaseClient;

export interface IngestOmniqueResult {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

interface IngestContext {
  organizationId: string;
  channelSessionId: string;
}

interface TargetIdentity {
  contactId: string;
  conversationId: string;
}

export async function ingestOmniqueEvent(
  admin: Admin,
  event: OmniqueInboundEvent,
  session: { id: string; organization_id: string },
): Promise<IngestOmniqueResult> {
  if (event.event === "status" && event.data.status) {
    return handleOmniqueStatusEvent(admin, event.data.status, session);
  }

  const isEcho = Boolean(event.data.echo);
  const msgObj = event.data.message ?? event.data.echo;
  if (!msgObj) return { status: "ignored", reason: "sem_mensagem" };

  const ctx: IngestContext = { organizationId: session.organization_id, channelSessionId: session.id };
  if (await verificarMensagemDuplicada(admin, ctx.organizationId, msgObj.id)) {
    return { status: "duplicate" };
  }

  const rawPhone = isEcho ? msgObj.to : msgObj.from;
  if (!rawPhone) return { status: "ignored", reason: "sem_telefone" };

  const identity = await resolverContatoEConversa(admin, ctx, rawPhone);
  if (!identity) return { status: "failed", reason: "falha_upsert_contato_ou_conversa" };

  const bodyText = extrairTextoMensagem(event.data) ?? "";
  const direction = isEcho ? "outbound" : "inbound";
  const insercao = await inserirLinhaDaMensagem(admin, {
    ctx, identity, externalId: msgObj.id, direction, bodyText, eventName: event.event,
  });

  if (insercao.duplicate) return { status: "duplicate" };
  if (insercao.error || !insercao.id) return { status: "failed", reason: insercao.error };

  await despacharEfeitosDaMensagem(admin, {
    ctx, identity, messageId: insercao.id, bodyText, isEcho,
  });

  return { status: "ingested", conversationId: identity.conversationId, messageId: insercao.id };
}

async function verificarMensagemDuplicada(
  admin: Admin,
  orgId: string,
  externalId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("external_id", externalId)
    .maybeSingle();
  return Boolean(data);
}

async function resolverContatoEConversa(
  admin: Admin,
  ctx: IngestContext,
  rawPhone: string,
): Promise<TargetIdentity | null> {
  const phone = canonicalPhoneBR(`+${rawPhone.replace(/\D/g, "")}`);
  const contactId = await upsertContact(admin, ctx.organizationId, phone, rawPhone);
  if (!contactId) return null;
  const conversationId = await upsertConversation(admin, ctx.organizationId, contactId, ctx.channelSessionId);
  if (!conversationId) return null;
  return { contactId, conversationId };
}

async function inserirLinhaDaMensagem(
  admin: Admin,
  params: {
    ctx: IngestContext;
    identity: TargetIdentity;
    externalId: string;
    direction: "inbound" | "outbound";
    bodyText: string;
    eventName: string;
  },
): Promise<{ id?: string; duplicate?: boolean; error?: string }> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: params.ctx.organizationId,
      conversation_id: params.identity.conversationId,
      channel_session_id: params.ctx.channelSessionId,
      contact_id: params.identity.contactId,
      direction: params.direction,
      sent_via: "external_device",
      type: "text",
      body: params.bodyText,
      external_id: params.externalId,
      status: "delivered",
      metadata: { provider: "omnique", omnique_event: params.eventName },
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { duplicate: true };
    return { error: error.message };
  }
  return { id: data?.id };
}

async function despacharEfeitosDaMensagem(
  admin: Admin,
  params: {
    ctx: IngestContext;
    identity: TargetIdentity;
    messageId: string;
    bodyText: string;
    isEcho: boolean;
  },
): Promise<void> {
  await marcarConversaComMensagem(admin, {
    organizationId: params.ctx.organizationId,
    conversationId: params.identity.conversationId,
    direction: params.isEcho ? "outbound" : "inbound",
    preview: params.bodyText.slice(0, 120),
    at: new Date().toISOString(),
    canal: "omnique",
  });

  if (!params.isEcho) {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: params.ctx.organizationId,
      conversationId: params.identity.conversationId,
      contactId: params.identity.contactId,
      messageId: params.messageId,
      channelSessionId: params.ctx.channelSessionId,
      texto: params.bodyText,
      nomeDoContato: null,
      origem: "omnique",
    });
  } else {
    await pausarIaPorAtendimentoManual(admin, {
      organizationId: params.ctx.organizationId,
      conversationId: params.identity.conversationId,
      canal: "omnique",
    });
  }
}

async function upsertContact(
  admin: Admin,
  orgId: string,
  phone: string,
  chatId: string,
): Promise<string | null> {
  const existing = await encontrarContatoPorTelefone(admin as never, orgId, chatId);
  const targetPhone = existing?.phone_number ? canonicalPhoneBR(existing.phone_number) : phone;

  const { data: contactId } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: "phone",
    p_phone: targetPhone,
    p_lid: null,
    p_chat_id: chatId,
    p_notify: null,
  } as never);

  return (contactId as string) || null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data: convId } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);

  return (convId as string) || null;
}

function buildMessageStatusUpdate(
  statusObj: OmniqueStatusData,
  rawStatus: string,
): Record<string, unknown> {
  const ts = statusObj.timestamp
    ? new Date(parseInt(statusObj.timestamp, 10) * 1000).toISOString()
    : new Date().toISOString();

  if (rawStatus === "delivered") {
    return { status: "delivered", ack: 2, delivered_at: ts };
  }
  if (rawStatus === "read") {
    return { status: "read", ack: 3, read_at: ts };
  }
  if (rawStatus === "failed") {
    const firstErr = statusObj.errors?.[0];
    const errCode = firstErr ? String(firstErr.code) : "omnique_delivery_failed";
    const errDetail = firstErr?.error_data?.details || firstErr?.message || firstErr?.title || "Meta delivery failed";
    return { status: "failed", error_code: errCode, error_message: errDetail };
  }
  return { status: "sent", ack: 1 };
}

async function sincronizarStatusDestinatarioCampanha(
  admin: Admin,
  messageId: string,
  statusObj: OmniqueStatusData,
): Promise<void> {
  const rawStatus = (statusObj.status || "").toLowerCase();
  if (rawStatus === "failed") {
    const firstErr = statusObj.errors?.[0];
    const errCode = firstErr ? String(firstErr.code) : "DELIVERY_FAILED";
    const errDetail = firstErr?.error_data?.details || firstErr?.message || "Falha na entrega";
    await admin
      .from("campaign_recipients")
      .update({ status: "failed", last_error_code: errCode, last_error_detail: errDetail })
      .eq("message_id", messageId);
  } else if (rawStatus === "delivered") {
    await admin
      .from("campaign_recipients")
      .update({ delivered_at: new Date().toISOString() })
      .eq("message_id", messageId);
  } else if (rawStatus === "read") {
    await admin
      .from("campaign_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("message_id", messageId);
  }
}

export async function handleOmniqueStatusEvent(
  admin: Admin,
  statusObj: OmniqueStatusData,
  session: { id: string; organization_id: string },
): Promise<IngestOmniqueResult> {
  const externalId = statusObj.id;
  if (!externalId) return { status: "ignored", reason: "status_sem_id" };

  const rawStatus = (statusObj.status || "").toLowerCase();
  const updateData = buildMessageStatusUpdate(statusObj, rawStatus);

  const { data: updatedMessages } = await admin
    .from("messages")
    .update(updateData)
    .eq("organization_id", session.organization_id)
    .eq("channel_session_id", session.id)
    .eq("external_id", externalId)
    .select("id");

  const msgId = updatedMessages?.[0]?.id;
  if (msgId) {
    await sincronizarStatusDestinatarioCampanha(admin, msgId, statusObj);
  }

  return { status: "ingested", reason: `status_${rawStatus}` };
}

