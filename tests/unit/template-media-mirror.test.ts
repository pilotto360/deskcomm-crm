import { describe, expect, it, vi } from "vitest";
import {
  extractHeaderMediaInfo,
  isTemporaryMediaUrl,
  mirrorTemplateMedia,
  mirrorAndResolveTemplateHeader,
  TEMPLATE_ASSETS_BUCKET,
} from "@/lib/channels/template-media-mirror";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("template-media-mirror", () => {
  describe("extractHeaderMediaInfo", () => {
    it("retorna null se não houver componente HEADER", () => {
      const res = extractHeaderMediaInfo([{ type: "BODY", text: "Olá" }]);
      expect(res).toBeNull();
    });

    it("retorna null se HEADER for de formato TEXT", () => {
      const res = extractHeaderMediaInfo([{ type: "HEADER", format: "TEXT", text: "Título" }]);
      expect(res).toBeNull();
    });

    it("extrai URL e formato para HEADER IMAGE com header_handle", () => {
      const res = extractHeaderMediaInfo([
        {
          type: "HEADER",
          format: "IMAGE",
          example: { header_handle: ["https://scontent.whatsapp.net/sample.png"] },
        },
      ]);
      expect(res).toEqual({
        url: "https://scontent.whatsapp.net/sample.png",
        format: "IMAGE",
      });
    });
  });

  describe("isTemporaryMediaUrl", () => {
    it("reconhece URLs já salvas no bucket como permanentes", () => {
      const url = `https://supabase.co/storage/v1/object/public/${TEMPLATE_ASSETS_BUCKET}/org/panetone.png`;
      expect(isTemporaryMediaUrl(url)).toBe(false);
    });

    it("reconhece URLs externas da Meta/CDN como temporárias", () => {
      const url = "https://scontent.whatsapp.net/v/sample.png";
      expect(isTemporaryMediaUrl(url)).toBe(true);
    });
  });

  describe("mirrorTemplateMedia & mirrorAndResolveTemplateHeader", () => {
    it("não refaz upload se a URL já estiver no bucket público", async () => {
      const url = `https://supabase.co/storage/v1/object/public/${TEMPLATE_ASSETS_BUCKET}/org/panetone.png`;
      const admin = {} as SupabaseClient;

      const res = await mirrorTemplateMedia(admin, {
        organizationId: "org-1",
        templateName: "panetone",
        sourceUrl: url,
      });

      expect(res).toBe(url);
    });

    it("baixa da CDN e grava no storage quando URL for temporária", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      });
      vi.stubGlobal("fetch", fetchMock);

      const uploadMock = vi.fn().mockResolvedValue({ error: null });
      const getPublicUrlMock = vi.fn().mockReturnValue({
        data: { publicUrl: `https://supabase.co/storage/v1/object/public/${TEMPLATE_ASSETS_BUCKET}/org-1/panetone.png` },
      });

      const fakeAdmin = {
        storage: {
          listBuckets: vi.fn().mockResolvedValue({ data: [{ id: TEMPLATE_ASSETS_BUCKET }] }),
          from: () => ({
            upload: uploadMock,
            getPublicUrl: getPublicUrlMock,
          }),
        },
      } as unknown as SupabaseClient;

      const { headerUrl, updatedSavedValues } = await mirrorAndResolveTemplateHeader(fakeAdmin, {
        organizationId: "org-1",
        templateName: "panetone",
        components: [
          {
            type: "HEADER",
            format: "IMAGE",
            example: { header_handle: ["https://scontent.whatsapp.net/temp.png"] },
          },
        ],
      });

      expect(uploadMock).toHaveBeenCalled();
      expect(headerUrl).toBe(`https://supabase.co/storage/v1/object/public/${TEMPLATE_ASSETS_BUCKET}/org-1/panetone.png`);
      expect(updatedSavedValues["header:1"]).toBe(headerUrl);

      vi.unstubAllGlobals();
    });
  });
});
