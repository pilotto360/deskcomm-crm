import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "meta_templates" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meta_templates")
    .select("id, name, language, status, category, components, saved_values")
    .eq("organization_id", org.orgId)
    .eq("status", "APPROVED")
    .order("name", { ascending: true });

  if (error) return fail("internal_error", "Erro ao listar meta templates.", 500, { requestId });
  return ok(data ?? [], { requestId });
}
