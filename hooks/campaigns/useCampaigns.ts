"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignWithStats, CreateCampaignInput, UpdateCampaignInput } from "@/lib/campaigns/types";

const BASE = "/api/v1/campaigns";
const CHAVE = ["campaigns"] as const;

async function leJson<T>(res: Response, oQueFalhou: string): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(corpo?.error?.message ?? oQueFalhou);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export function useCampaigns() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const res = await fetch(BASE);
      return leJson<{ campaigns: CampaignWithStats[] }>(res, "Não foi possível carregar as campanhas.");
    },
    staleTime: 5_000,
    refetchInterval: 15_000, // Atualiza automaticamente os contadores a cada 15 segundos
    refetchOnWindowFocus: true,
  });

  const criarMutation = useMutation({
    mutationFn: async (dados: CreateCampaignInput) => {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      return leJson<{ id: string; name: string }>(res, "Falha ao criar campanha.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE });
    },
  });

  const atualizarMutation = useMutation({
    mutationFn: async ({ id, dados }: { id: string; dados: UpdateCampaignInput }) => {
      const res = await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      return leJson(res, "Falha ao atualizar campanha.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE });
    },
  });

  const tickMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/${id}/tick`, {
        method: "POST",
      });
      return leJson<{ result: { dispatched: boolean; reason?: string; phone?: string; contactName?: string } }>(
        res,
        "Falha ao acionar disparo.",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE });
    },
  });

  return {
    campaigns: query.data?.campaigns ?? [],
    carregando: query.isLoading,
    falhou: query.isError,
    erro: query.error?.message,
    recarregar: query.refetch,
    criarCampanha: criarMutation.mutateAsync,
    atualizarCampanha: atualizarMutation.mutateAsync,
    dispararProximo: tickMutation.mutateAsync,
    emCriacao: criarMutation.isPending,
    emDisparo: tickMutation.isPending,
  };
}
