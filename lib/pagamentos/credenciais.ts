/**
 * A credencial de pagamento da organização — lida e decifrada.
 *
 * Irmã direta de `lib/plataformas-de-anuncio/credenciais.ts`: mesma tabela-
 * padrão (`payment_provider_connections`, migration 0381), mesmo motivo de
 * existir na fronteira e não dentro de `asaas/` — a tabela é agnóstica a
 * provider, e a segunda integração de pagamento copiaria a leitura se ela
 * morasse dentro da primeira.
 *
 * ⚠️ SEMPRE COM `organization_id` NO FILTRO — a mesma lição da #236 citada no
 * cabeçalho da irmã: índice único é `(organization_id, provider)`, filtro
 * repete a organização.
 *
 * ⚠️ EXIGE O ADMIN CLIENT. RLS ligada, ZERO policies, grants revogados de
 * anon/authenticated (migration 0381) — pelo client de sessão isto não
 * devolve nada, nem erro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import type { CredencialDePagamento, ProviderDePagamento } from "./types";

/** Mesmo desenho de `MotivoSemCredencial` na irmã — um nome por causa, não um "não configurado" genérico. */
export type MotivoSemCredencialDePagamento =
  | "sem_conexao"
  | "conexao_desabilitada"
  | "credencial_incompleta"
  | "cifra_indisponivel";

export type LeituraDeCredencialDePagamento =
  | { ok: true; credencial: CredencialDePagamento }
  | { ok: false; motivo: MotivoSemCredencialDePagamento };

export async function lerCredencialDePagamento(
  admin: SupabaseClient,
  organizationId: string,
  provider: ProviderDePagamento,
): Promise<LeituraDeCredencialDePagamento> {
  const { data, error } = await admin
    .from("payment_provider_connections")
    .select("api_key_encrypted, webhook_token_encrypted, enabled, environment")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    logger.error("[pagamentos.credencial] leitura falhou", {
      organizationId,
      provider,
      error: error.message,
    });
    return { ok: false, motivo: "sem_conexao" };
  }
  if (!data) return { ok: false, motivo: "sem_conexao" };

  const linha = data as {
    api_key_encrypted: string | null;
    webhook_token_encrypted: string | null;
    enabled: boolean;
    environment: "sandbox" | "production";
  };

  if (!linha.enabled) return { ok: false, motivo: "conexao_desabilitada" };
  if (!linha.api_key_encrypted) return { ok: false, motivo: "credencial_incompleta" };

  const apiKey = await decryptWebhookSecret(admin, linha.api_key_encrypted);
  if (!apiKey) return { ok: false, motivo: "cifra_indisponivel" };

  // O token de webhook é opcional na leitura: sem ele, a rota do webhook cai
  // para "não consigo validar" e recusa o POST (ver o handler do webhook) —
  // isto aqui só decide se HÁ o que ler, nunca valida sozinho.
  let webhookToken: string | null = null;
  if (linha.webhook_token_encrypted) {
    webhookToken = await decryptWebhookSecret(admin, linha.webhook_token_encrypted);
    if (!webhookToken) return { ok: false, motivo: "cifra_indisponivel" };
  }

  return {
    ok: true,
    credencial: { provider, apiKey, webhookToken, environment: linha.environment },
  };
}
