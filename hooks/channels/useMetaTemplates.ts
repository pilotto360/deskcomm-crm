"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface MetaTemplateItem {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: unknown[];
  saved_values: Record<string, unknown> | null;
}

export function useMetaTemplates() {
  return useQuery({
    queryKey: ["meta-templates-approved"],
    queryFn: async () =>
      apiClient.get<{ data: MetaTemplateItem[] }>("/api/v1/channels/meta-templates"),
    staleTime: 30_000,
    select: (res) => res.data,
  });
}
