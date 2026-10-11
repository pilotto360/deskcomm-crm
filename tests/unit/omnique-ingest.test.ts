import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/escalacao/atendimento-manual", () => ({
  pausarIaPorAtendimentoManual: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/channels/marcar-conversa", () => ({
  marcarConversaComMensagem: vi.fn().mockResolvedValue(undefined),
}));

import { ingestOmniqueEvent } from "@/lib/channels/omnique/ingest";
import type { OmniqueInboundEvent } from "@/lib/channels/omnique/webhook";

describe("ingestOmniqueEvent", () => {
  it("grava mensagem inbound incluindo channel_session_id e contact_id", async () => {
    const insertedRows: unknown[] = [];
    const chainMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      insert: vi.fn((payload: unknown) => {
        insertedRows.push(payload);
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "msg_uuid_123" },
              error: null,
            }),
          }),
        };
      }),
    };

    const mockAdmin = {
      from: vi.fn(() => chainMock),
      rpc: vi.fn((rpcName: string) => {
        if (rpcName === "fn_upsert_wa_contact") {
          return Promise.resolve({ data: "contact_uuid_456", error: null });
        }
        if (rpcName === "fn_upsert_wa_conversation") {
          return Promise.resolve({ data: "conv_uuid_789", error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const event: OmniqueInboundEvent = {
      event: "chat.message",
      instanceId: "inst_123",
      data: {
        message: {
          id: "omnique_msg_001",
          from: "5519994269101",
          to: "5519974176435",
          type: "text",
          text: "Olá, gostaria de saber mais",
        },
      },
    };

    const result = await ingestOmniqueEvent(
      mockAdmin as never,
      event,
      { id: "sess_uuid_abc", organization_id: "org_uuid_xyz" },
    );

    expect(result.status).toBe("ingested");
    expect(result.conversationId).toBe("conv_uuid_789");
    expect(result.messageId).toBe("msg_uuid_123");

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as Record<string, unknown>;
    expect(row.channel_session_id).toBe("sess_uuid_abc");
    expect(row.contact_id).toBe("contact_uuid_456");
    expect(row.conversation_id).toBe("conv_uuid_789");
    expect(row.organization_id).toBe("org_uuid_xyz");
    expect(row.direction).toBe("inbound");
    expect(row.body).toBe("Olá, gostaria de saber mais");
  });
});
