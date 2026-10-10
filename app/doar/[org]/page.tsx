/**
 * `/doar/[org]` — a página de checkout pública (migration 0381).
 *
 * DELIBERADAMENTE fora de `app/(public)/layout.tsx`: aquele shell é a
 * identidade do INSTALADOR (`marcaDaSaida(null)`, pensado para telas de
 * login/signup pré-sessão). Um doador chegando de um anúncio precisa ver a
 * organização (aqui, a Esperança e Vida), não o app que hospeda o CRM por
 * trás — a mesma razão pela qual `app/api/v1/anuncios/google/[org]/route.ts`
 * devolve uma página neutra, sem marca do produto. Layout próprio,
 * minimalista, sem chrome do CRM.
 */
import type { Metadata } from "next";
import { CheckoutDoacao } from "./checkout-doacao";

export const metadata: Metadata = { title: "Doação" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PaginaDeDoacao({ params, searchParams }: PageProps) {
  const { org } = await params;
  const sp = await searchParams;

  const gclid = typeof sp.gclid === "string" ? sp.gclid : null;
  const utm: Record<string, string> = {};
  for (const chave of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const valor = sp[chave];
    if (typeof valor === "string") utm[chave] = valor;
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f7f8",
        padding: "1.5rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <CheckoutDoacao org={org} gclid={gclid} utm={utm} />
    </main>
  );
}
