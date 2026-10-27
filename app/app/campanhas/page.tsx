import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { CampanhasClient } from "./_components/CampanhasClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Campanhas & Disparos Automáticos | DeskcommCRM",
  description: "Disparos automáticos programados e reativação com ritmo e teto diário.",
};

export default async function CampanhasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeGerenciar =
    (user.is_platform_admin && !user.support) ||
    ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  return <CampanhasClient podeGerenciar={podeGerenciar} orgId={activeOrg.orgId} />;
}
