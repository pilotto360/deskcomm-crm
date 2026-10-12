import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhoneBR } from "../phone-variants";
import { logger } from "@/lib/logger";

export interface SyncOutboundParams {
  admin: SupabaseClient;
  forwardUrl?: string | null;
  phoneNumber?: string | null;
  body?: string | null;
  externalId?: string | null;
  templateName?: string | null;
  messageType?: string;
}

interface OutboundRecordParams {
  admin: SupabaseClient;
  conversationId: string;
  contactId: number;
  body: string;
  externalId?: string | null;
  templateName?: string | null;
  messageType?: string;
}

async function resolveLangGraphContact(
  admin: SupabaseClient,
  rawPhone: string,
): Promise<number | null> {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return null;
  const canonical = canonicalPhoneBR(`+${digits}`);
  const candidates = [canonical, `+${digits}`, digits];

  const { data } = await admin
    .from("contatos")
    .select("id")
    .or(candidates.map((p) => `telefone_e164.eq.${p}`).join(","))
    .limit(1);

  return (data?.[0]?.id as number) ?? null;
}

async function resolveOrCreateConversation(
  admin: SupabaseClient,
  contactId: number,
): Promise<string | null> {
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("contato_id", contactId)
    .eq("status", "open")
    .limit(1);

  if (existing?.[0]?.id) return existing[0].id as string;

  const nowIso = new Date().toISOString();
  const { data: created } = await admin
    .from("whatsapp_conversations")
    .insert({
      contato_id: contactId,
      status: "open",
      channel: "whatsapp",
      agent_enabled: true,
      human_required: false,
      metadata: {},
      last_message_at: nowIso,
      opened_at: nowIso,
    })
    .select("id")
    .single();

  return (created?.id as string) ?? null;
}

async function insertLangGraphMessage(
  params: OutboundRecordParams,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await params.admin.from("whatsapp_messages").insert({
    conversation_id: params.conversationId,
    contato_id: params.contactId,
    direction: "outbound",
    message_type: params.messageType === "template" ? "template" : "text",
    body: params.body,
    provider: "omnique",
    provider_message_id: params.externalId ?? null,
    status: "sent",
    template_name: params.templateName ?? null,
    sent_at: nowIso,
    created_at: nowIso,
  });

  await params.admin
    .from("whatsapp_conversations")
    .update({ last_message_at: nowIso })
    .eq("id", params.conversationId);
}

export async function syncOutboundToLangGraph(
  params: SyncOutboundParams,
): Promise<void> {
  if (!params.forwardUrl || !params.phoneNumber || !params.body) return;

  try {
    const contactId = await resolveLangGraphContact(params.admin, params.phoneNumber);
    if (!contactId) return;

    const convId = await resolveOrCreateConversation(params.admin, contactId);
    if (!convId) return;

    await insertLangGraphMessage({
      admin: params.admin,
      conversationId: convId,
      contactId,
      body: params.body,
      externalId: params.externalId,
      templateName: params.templateName,
      messageType: params.messageType,
    });

    logger.info("sync-langgraph: template/outbound sincronizado com sucesso", {
      contactId,
      conversationId: convId,
      templateName: params.templateName,
    });
  } catch (err) {
    logger.warn("sync-langgraph: falha não-bloqueante na sincronização", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
