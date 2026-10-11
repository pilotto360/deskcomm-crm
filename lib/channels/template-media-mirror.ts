import type { SupabaseClient } from "@supabase/supabase-js";

export const TEMPLATE_ASSETS_BUCKET = "template-assets";

export interface HeaderMediaInfo {
  url: string;
  format: "IMAGE" | "DOCUMENT" | "VIDEO";
}

export function extractHeaderMediaInfo(components: unknown): HeaderMediaInfo | null {
  if (!Array.isArray(components)) return null;
  const header = components.find((c) => {
    const tipo = String(c?.type ?? "").toUpperCase();
    const formato = String(c?.format ?? "").toUpperCase();
    return tipo === "HEADER" && (formato === "IMAGE" || formato === "DOCUMENT" || formato === "VIDEO");
  });
  if (!header) return null;
  const handles = header.example?.header_handle;
  if (!Array.isArray(handles) || typeof handles[0] !== "string" || !handles[0].trim()) {
    return null;
  }
  return {
    url: handles[0].trim(),
    format: String(header.format).toUpperCase() as "IMAGE" | "DOCUMENT" | "VIDEO",
  };
}

export function isTemporaryMediaUrl(url: string): boolean {
  if (!url) return false;
  if (url.includes(`/object/public/${TEMPLATE_ASSETS_BUCKET}/`)) return false;
  return true;
}

function mediaDetails(format: string): { ext: string; contentType: string } {
  if (format === "DOCUMENT") return { ext: "pdf", contentType: "application/pdf" };
  if (format === "VIDEO") return { ext: "mp4", contentType: "video/mp4" };
  return { ext: "png", contentType: "image/png" };
}

export async function ensureTemplateAssetsBucket(admin: SupabaseClient): Promise<boolean> {
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.id === TEMPLATE_ASSETS_BUCKET);
  if (exists) return true;

  const { error } = await admin.storage.createBucket(TEMPLATE_ASSETS_BUCKET, {
    public: true,
    fileSizeLimit: 10485760,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4"],
  });
  return !error;
}

export interface MirrorMediaInput {
  organizationId: string;
  templateName: string;
  sourceUrl: string;
  format?: string;
}

export async function mirrorTemplateMedia(
  admin: SupabaseClient,
  input: MirrorMediaInput,
): Promise<string | null> {
  if (!isTemporaryMediaUrl(input.sourceUrl)) return input.sourceUrl;

  await ensureTemplateAssetsBucket(admin);

  const res = await fetch(input.sourceUrl).catch(() => null);
  if (!res || !res.ok) return null;

  const buffer = await res.arrayBuffer().catch(() => null);
  if (!buffer) return null;

  const { ext, contentType } = mediaDetails(input.format ?? "IMAGE");
  const sanitizedOrg = input.organizationId.replace(/[^a-zA-Z0-9-]/g, "");
  const sanitizedName = input.templateName.replace(/[^a-zA-Z0-9_-]/g, "");
  const path = `${sanitizedOrg}/${sanitizedName}.${ext}`;

  const { error: upErr } = await admin.storage
    .from(TEMPLATE_ASSETS_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (upErr) return null;

  const { data } = admin.storage.from(TEMPLATE_ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export interface MirrorTemplateRowInput {
  organizationId: string;
  templateName: string;
  components: unknown;
  savedValues?: Record<string, string>;
}

export async function mirrorAndResolveTemplateHeader(
  admin: SupabaseClient,
  input: MirrorTemplateRowInput,
): Promise<{ headerUrl: string | null; updatedSavedValues: Record<string, string> }> {
  const currentSaved = { ...(input.savedValues ?? {}) };
  const existingUrl = currentSaved["header:1"] || "";

  if (existingUrl && !isTemporaryMediaUrl(existingUrl)) {
    return { headerUrl: existingUrl, updatedSavedValues: currentSaved };
  }

  const mediaInfo = extractHeaderMediaInfo(input.components);
  const targetUrl = existingUrl || mediaInfo?.url;
  if (!targetUrl) {
    return { headerUrl: null, updatedSavedValues: currentSaved };
  }

  const mirrored = await mirrorTemplateMedia(admin, {
    organizationId: input.organizationId,
    templateName: input.templateName,
    sourceUrl: targetUrl,
    format: mediaInfo?.format ?? "IMAGE",
  });

  if (mirrored) {
    currentSaved["header:1"] = mirrored;
  }

  return { headerUrl: mirrored ?? targetUrl, updatedSavedValues: currentSaved };
}
