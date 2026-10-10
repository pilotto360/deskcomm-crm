import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhoneBR } from "../phone-variants";
import { encontrarContatoPorTelefone } from "../contato-por-telefone";
import { marcarConversaComMensagem } from "../marcar-conversa";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { extrairTextoMensagem, type OmniqueInboundEvent } from "./webhook";

type Admin = SupabaseClient;

export interface IngestOmniqueResult {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

export async function ingestOmniqueEvent(
  admin: Admin,
  event: OmniqueInboundEvent,
  session: { id: string; organization_id: string },
): Promise<IngestOmniqueResult> {
  const isEcho = Boolean(event.data.echo);
  const msgObj = event.data.message ?? event.data.echo;
  if (!msgObj) return { status: "ignored", reason: "sem_mensagem" };

  const externalId = msgObj.id;
  const orgId = session.organization_id;

  const { data: existente } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existente) return { status: "duplicate" };

  const rawPhone = isEcho ? msgObj.to : msgObj.from;
  if (!rawPhone) return { status: "ignored", reason: "sem_telefone" };

  const phone = canonicalPhoneBR(`+${rawPhone.replace(/\D/g, "")}`);
  const contactId = await upsertContact(admin, orgId, phone, rawPhone);
  if (!contactId) return { status: "failed", reason: "falha_upsert_contato" };

  const conversationId = await upsertConversation(admin, orgId, contactId, session.id);
  if (!conversationId) return { status: "failed", reason: "falha_upsert_conversa" };

  const bodyText = extrairTextoMensagem(event.data) ?? "";
  const direction = isEcho ? "outbound" : "inbound";

  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: orgId,
      conversation_id: conversationId,
      direction,
      body: bodyText,
      external_id: externalId,
      status: "delivered",
      metadata: { provider: "omnique", omnique_event: event.event },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    if (insertErr?.code === "23505") return { status: "duplicate" };
    return { status: "failed", reason: insertErr?.message };
  }

  await marcarConversaComMensagem(admin, {
    organizationId: orgId,
    conversationId,
    direction,
    preview: bodyText.slice(0, 120),
    at: new Date().toISOString(),
    canal: "omnique",
  });

  if (!isEcho) {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: orgId,
      conversationId,
      contactId,
      messageId: inserted.id,
      channelSessionId: session.id,
      texto: bodyText,
      nomeDoContato: null,
      origem: "omnique",
    });
  }

  return { status: "ingested", conversationId, messageId: inserted.id };
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
