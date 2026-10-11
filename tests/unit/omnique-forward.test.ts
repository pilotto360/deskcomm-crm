import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardOmniqueWebhook, resolveForwardUrl } from "@/lib/channels/omnique/forward";

describe("omnique forward", () => {
  const originalEnv = process.env.OMNIQUE_FORWARD_WEBHOOK_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.OMNIQUE_FORWARD_WEBHOOK_URL = originalEnv;
  });

  it("retorna null se não houver URL configurada", () => {
    delete process.env.OMNIQUE_FORWARD_WEBHOOK_URL;
    expect(resolveForwardUrl()).toBeNull();
  });

  it("retorna URL configurada no env", () => {
    process.env.OMNIQUE_FORWARD_WEBHOOK_URL = "https://agent.example.com/webhook";
    expect(resolveForwardUrl()).toBe("https://agent.example.com/webhook");
  });

  it("não faz fetch se URL não estiver configurada", async () => {
    delete process.env.OMNIQUE_FORWARD_WEBHOOK_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await forwardOmniqueWebhook({
      rawBody: JSON.stringify({ event: "message" }),
      signature: "sha256=test",
    });

    expect(result.forwarded).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("repassa com headers esperados quando URL estiver configurada", async () => {
    process.env.OMNIQUE_FORWARD_WEBHOOK_URL = "https://agent.example.com/webhook";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
    } as Response);

    const result = await forwardOmniqueWebhook({
      rawBody: JSON.stringify({ event: "message" }),
      signature: "sha256=abc",
      conversationId: "conv-123",
      messageId: "msg-456",
    });

    expect(result.forwarded).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agent.example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-omnique-signature-256": "sha256=abc",
          "x-deskcomm-conversation-id": "conv-123",
          "x-deskcomm-message-id": "msg-456",
        },
      }),
    );
  });

  it("trata erro de rede sem lançar exceção", async () => {
    process.env.OMNIQUE_FORWARD_WEBHOOK_URL = "https://agent.example.com/webhook";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const result = await forwardOmniqueWebhook({
      rawBody: JSON.stringify({ event: "message" }),
      signature: null,
    });

    expect(result.forwarded).toBe(false);
    expect(result.error).toBe("network error");
  });
});
