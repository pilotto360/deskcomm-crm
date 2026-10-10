import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const credsRef: { current: unknown } = { current: null };
vi.mock("@/lib/channels/omnique/credentials", () => ({
  resolveOmniqueCreds: async () => credsRef.current,
  omniqueBaseUrl: () => "https://test.omnique.com.br",
}));

import { omniqueAdapter } from "@/lib/channels/adapters/omnique";
import { validarAssinaturaOmnique, extrairTextoMensagem } from "@/lib/channels/omnique/webhook";
import crypto from "node:crypto";

const CREDS = {
  instanceId: "inst_123",
  apiKey: "zpk_test_key_123",
  baseUrl: "https://test.omnique.com.br",
  source: "session" as const,
};

const ORG = "00000000-0000-4000-8000-000000000236";

describe("omniqueAdapter", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    credsRef.current = CREDS;
  });

  it("envia mensagem de texto com envelope correto", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_999" }),
    });

    const res = await omniqueAdapter.send({
      organizationId: ORG,
      sessionRef: "inst_123",
      to: "+5519999998888",
      kind: "text",
      body: "Olá do DeskcommCRM!",
    });

    expect(res.externalId).toBe("msg_999");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://test.omnique.com.br/chat-send");
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer zpk_test_key_123");
    const body = JSON.parse(call[1].body as string);
    expect(body.to).toBe("5519999998888");
    expect(body.type).toBe("text");
    expect(body.text).toBe("Olá do DeskcommCRM!");
  });

  it("envia mensagem de mídia com link e legenda", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "media_888" }),
    });

    const res = await omniqueAdapter.send({
      organizationId: ORG,
      sessionRef: "inst_123",
      to: "+5519999998888",
      kind: "image",
      body: "Foto de exemplo",
      media: { url: "https://cdn.exemplo.com/foto.jpg" },
    });

    expect(res.externalId).toBe("media_888");
    const mediaCall = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(mediaCall[1].body as string);
    expect(body.type).toBe("image");
    expect(body.media.link).toBe("https://cdn.exemplo.com/foto.jpg");
    expect(body.media.caption).toBe("Foto de exemplo");
  });

  it("lança erro amigável se a API da Omnique falhar", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "recipient_invalid", detail: "Número não possui WhatsApp" }),
    });

    await expect(
      omniqueAdapter.send({
        organizationId: ORG,
        sessionRef: "inst_123",
        to: "+5519999998888",
        kind: "text",
        body: "Teste",
      }),
    ).rejects.toThrow("omnique_send_failed: Número não possui WhatsApp");
  });
});

describe("webhook Omnique", () => {
  const secret = "test_webhook_secret_32_bytes_len";

  it("valida assinatura HMAC-SHA256 válida", () => {
    const raw = JSON.stringify({ event: "message", data: {} });
    const hmac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const header = `sha256=${hmac}`;

    expect(validarAssinaturaOmnique(raw, header, secret)).toBe(true);
  });

  it("rejeita assinatura inválida", () => {
    const raw = JSON.stringify({ event: "message", data: {} });
    const fakeHeader = "sha256=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    expect(validarAssinaturaOmnique(raw, fakeHeader, secret)).toBe(false);
  });

  it("extrai texto de mensagem e de echo", () => {
    const msgData = { message: { id: "1", from: "123", type: "text", text: { body: "Texto do cliente" } } };
    expect(extrairTextoMensagem(msgData)).toBe("Texto do cliente");

    const echoData = { echo: { id: "2", from: "me", to: "123", type: "text", text: { body: "Meu eco" } } };
    expect(extrairTextoMensagem(echoData)).toBe("Meu eco");
  });
});
