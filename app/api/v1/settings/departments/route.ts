import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OFFICIAL_DEPARTMENTS,
  buildAgentConfigKeyPhone,
  buildAgentConfigKeyUser,
  parseConfigString,
  updateDepartmentsSchema,
  type DepartmentCode,
  type DepartmentSettingResult,
} from "@/lib/settings/departments";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "settings_departments" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const admin = createAdminClient();

  const { data: configRows, error: configError } = await admin
    .from("agent_config")
    .select("key, value");

  if (configError) {
    return fail("internal_error", configError.message, 500, { requestId });
  }

  const configMap = new Map<string, string>();
  for (const row of configRows ?? []) {
    const parsed = parseConfigString(row.value);
    if (parsed) configMap.set(row.key, parsed);
  }

  const { data: members } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", activeOrg.orgId)
    .is("revoked_at", null);

  const memberIds = new Set((members ?? []).map((m) => m.user_id));

  const userIdsToFetch = new Set<string>();
  for (const dept of OFFICIAL_DEPARTMENTS) {
    const userKey = buildAgentConfigKeyUser(dept.code);
    const userId = configMap.get(userKey);
    if (userId && memberIds.has(userId)) {
      userIdsToFetch.add(userId);
    }
  }

  const userNames = new Map<string, string>();
  for (const uId of userIdsToFetch) {
    const { data: uRes } = await admin.auth.admin.getUserById(uId);
    if (uRes?.user?.user_metadata?.full_name) {
      userNames.set(uId, String(uRes.user.user_metadata.full_name));
    }
  }

  const results: DepartmentSettingResult[] = OFFICIAL_DEPARTMENTS.map((dept) => {
    const phoneKey = buildAgentConfigKeyPhone(dept.code);
    const userKey = buildAgentConfigKeyUser(dept.code);

    const savedPhone = configMap.get(phoneKey);
    const savedUserId = configMap.get(userKey);
    const validUserId = savedUserId && memberIds.has(savedUserId) ? savedUserId : null;

    return {
      code: dept.code,
      name: dept.name,
      description: dept.description,
      defaultResponsible: dept.defaultResponsible,
      phone: savedPhone || dept.defaultPhone,
      assigned_user_id: validUserId,
      assigned_user_name: validUserId ? userNames.get(validUserId) ?? null : null,
    };
  });

  return ok({ departments: results }, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_departments" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_json", "Payload JSON inválido", 400, { requestId });
  }

  const parsed = updateDepartmentsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", parsed.error.issues[0]?.message ?? "Dados inválidos", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const upsertRows: Array<{ key: string; value: unknown; updated_at: string; description: string }> = [];
  const now = new Date().toISOString();

  for (const item of parsed.data.departments) {
    const phoneKey = buildAgentConfigKeyPhone(item.code);
    const userKey = buildAgentConfigKeyUser(item.code);
    const deptDef = OFFICIAL_DEPARTMENTS.find((d) => d.code === item.code);

    upsertRows.push({
      key: phoneKey,
      value: JSON.stringify(item.phone),
      description: `WhatsApp do departamento ${deptDef?.name ?? item.code}`,
      updated_at: now,
    });

    if (item.assigned_user_id) {
      upsertRows.push({
        key: userKey,
        value: JSON.stringify(item.assigned_user_id),
        description: `Usuário DeskcommCRM do departamento ${deptDef?.name ?? item.code}`,
        updated_at: now,
      });
    } else {
      upsertRows.push({
        key: userKey,
        value: "null",
        description: `Usuário DeskcommCRM do departamento ${deptDef?.name ?? item.code}`,
        updated_at: now,
      });
    }
  }

  const { error: upsertError } = await admin
    .from("agent_config")
    .upsert(upsertRows, { onConflict: "key" });

  if (upsertError) {
    return fail("database_error", upsertError.message, 500, { requestId });
  }

  await audit({
    action: "settings.departments_updated",
    orgId: activeOrg.orgId,
    actorUserId: authUser.id,
    metadata: {
      count: parsed.data.departments.length,
      updated_keys: upsertRows.map((r) => r.key),
    },
  });

  return ok({ success: true, count: parsed.data.departments.length }, { requestId });
}

