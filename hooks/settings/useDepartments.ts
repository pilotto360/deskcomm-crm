"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import type { DepartmentSettingResult, UpdateDepartmentsInput } from "@/lib/settings/departments";

export interface AssignableMember {
  user_id: string;
  role: string;
  full_name: string | null;
}

export const DEPARTMENTS_KEY = ["settings", "departments"] as const;
export const ASSIGNABLE_TEAM_KEY = ["team", "assignable"] as const;

export function useDepartments() {
  return useQuery({
    queryKey: DEPARTMENTS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{ data: { departments: DepartmentSettingResult[] } }>(
        "/api/v1/settings/departments",
      );
      return res.data.departments;
    },
    staleTime: 30_000,
  });
}

export function useAssignableTeam() {
  return useQuery({
    queryKey: ASSIGNABLE_TEAM_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{ data: AssignableMember[] }>("/api/v1/team/assignable");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateDepartments() {
  const queryClient = useQueryClient();
  const t = useT();

  return useMutation({
    mutationFn: async (payload: UpdateDepartmentsInput) =>
      apiClient.put<{ data: { success: boolean; count: number } }>(
        "/api/v1/settings/departments",
        payload,
      ),
    onSuccess: () => {
      toast.success(t("Configurações dos departamentos salvas com sucesso!"));
      queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
    },
    onError: (err) => {
      showApiError(err, t("Não foi possível salvar os departamentos. Tente novamente."));
    },
  });
}

