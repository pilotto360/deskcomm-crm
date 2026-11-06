import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, PUT } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const mockOrgId = "20000000-0000-4000-8000-000000000001";
const mockUserId = "20000000-0000-4000-8000-000000000002";

const mockAdmin = {
  from: vi.fn(),
  auth: {
    admin: {
      getUserById: vi.fn(),
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: mockUserId },
    org: { orgId: mockOrgId },
  } as never);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);
});

describe("GET /api/v1/settings/departments", () => {
  it("devolve 403 se o usuário não tiver permissão", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);

    const res = await GET(new Request("http://localhost/api/v1/settings/departments") as never);
    expect(res.status).toBe(403);
  });

  it("devolve os 8 departamentos oficiais preenchidos", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "agent_config") {
        return {
          select: vi.fn().mockResolvedValue({
            data: [
              { key: "dept_phone_social_service", value: '"+5519994815905"' },
              { key: "dept_user_social_service", value: `"${mockUserId}"` },
            ],
            error: null,
          }),
        };
      }
      if (table === "user_organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: [{ user_id: mockUserId }],
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockAdmin.auth.admin.getUserById.mockResolvedValue({
      data: { user: { user_metadata: { full_name: "Assistente Social Teste" } } },
    });

    const res = await GET(new Request("http://localhost/api/v1/settings/departments") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.departments).toHaveLength(8);

    const social = body.data.departments.find((d: { code: string }) => d.code === "social_service");
    expect(social).toBeDefined();
    expect(social.phone).toBe("+5519994815905");
    expect(social.assigned_user_id).toBe(mockUserId);
    expect(social.assigned_user_name).toBe("Assistente Social Teste");
  });
});

describe("PUT /api/v1/settings/departments", () => {
  it("recusa payload com telefone inválido (não E.164)", async () => {
    const req = new Request("http://localhost/api/v1/settings/departments", {
      method: "PUT",
      body: JSON.stringify({
        departments: [
          {
            code: "social_service",
            phone: "19994815905", // falta +55
          },
        ],
      }),
    });

    const res = await PUT(req as never);
    expect(res.status).toBe(422);
  });

  it("persiste dados com sucesso via upsert", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    mockAdmin.from.mockReturnValue({ upsert: upsertMock });

    const req = new Request("http://localhost/api/v1/settings/departments", {
      method: "PUT",
      body: JSON.stringify({
        departments: [
          {
            code: "social_service",
            phone: "+5519994815905",
            assigned_user_id: mockUserId,
          },
        ],
      }),
    });

    const res = await PUT(req as never);
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalled();
  });
});

