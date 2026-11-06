import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { DepartamentosForm } from "./_form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Departamentos & IA" };

export default async function DepartamentosSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Departamentos & Encaminhamento por IA", idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Configure os números de WhatsApp de plantão e os operadores do DeskcommCRM responsáveis por cada setor. O agente de IA consulta estes parâmetros para direcionar as demandas automaticamente.",
            idioma,
          )}
        </p>
      </header>
      <DepartamentosForm />
    </div>
  );
}

