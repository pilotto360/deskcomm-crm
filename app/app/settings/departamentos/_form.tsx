"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import {
  useAssignableTeam,
  useDepartments,
  useUpdateDepartments,
} from "@/hooks/settings/useDepartments";
import type { DepartmentCode, DepartmentItem } from "@/lib/settings/departments";
import { FloppyDisk, Phone, User, WarningOctagon } from "@/lib/ui/icons";

interface DeptState {
  phone: string;
  assigned_user_id: string | null;
}

export function DepartamentosForm() {
  const t = useT();
  const { data: departments, isLoading: loadingDepts, error: deptsError } = useDepartments();
  const { data: teamMembers, isLoading: loadingTeam } = useAssignableTeam();
  const updateMutation = useUpdateDepartments();

  const [formState, setFormState] = useState<Record<DepartmentCode, DeptState>>({} as never);

  useEffect(() => {
    if (departments && departments.length > 0) {
      const initial: Record<string, DeptState> = {};
      for (const d of departments) {
        initial[d.code] = {
          phone: d.phone,
          assigned_user_id: d.assigned_user_id ?? null,
        };
      }
      setFormState(initial as Record<DepartmentCode, DeptState>);
    }
  }, [departments]);

  if (loadingDepts || loadingTeam) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (deptsError || !departments) {
    return (
      <Card className="flex items-start gap-3 p-4">
        <WarningOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" weight="duotone" />
        <p className="text-sm">
          {t("Não foi possível carregar os departamentos. Tente recarregar a página.")}
        </p>
      </Card>
    );
  }

  function handlePhoneChange(code: DepartmentCode, phone: string) {
    setFormState((prev) => ({
      ...prev,
      [code]: {
        ...prev[code],
        phone,
      },
    }));
  }

  function handleUserChange(code: DepartmentCode, val: string) {
    setFormState((prev) => ({
      ...prev,
      [code]: {
        ...prev[code],
        assigned_user_id: val === "unassigned" ? null : val,
      },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload: DepartmentItem[] = [];
    const phoneRegex = /^\+[1-9]\d{9,14}$/;

    for (const dept of departments || []) {
      const current = formState[dept.code];
      const phone = (current?.phone || dept.phone).trim();

      if (!phoneRegex.test(phone)) {
        toast.error(
          t("Telefone inválido para {{dept}}: use o formato internacional E.164 (ex: +5519999999999)", {
            dept: dept.name,
          }),
        );
        return;
      }

      payload.push({
        code: dept.code,
        phone,
        assigned_user_id: current?.assigned_user_id ?? dept.assigned_user_id,
      });
    }

    updateMutation.mutate({ departments: payload });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        {departments.map((dept) => {
          const current = formState[dept.code] || {
            phone: dept.phone,
            assigned_user_id: dept.assigned_user_id,
          };

          return (
            <Card key={dept.code} className="border border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold">{dept.name}</CardTitle>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    {dept.code}
                  </span>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  {dept.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-medium">
                    <User size={14} className="text-muted-foreground" />
                    {t("Operador Responsável no DeskcommCRM")}
                  </Label>
                  <Select
                    value={current.assigned_user_id ?? "unassigned"}
                    onValueChange={(val) => handleUserChange(dept.code, val)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder={t("Selecione um atendente...")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned" className="text-xs text-muted-foreground">
                        {t("Nenhum (cai na Fila geral)")}
                      </SelectItem>
                      {(teamMembers ?? []).map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id} className="text-xs">
                          {m.full_name || m.user_id} ({m.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Padrão: <span className="font-medium">{dept.defaultResponsible}</span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-medium">
                    <Phone size={14} className="text-muted-foreground" />
                    {t("WhatsApp de Alerta Direto (E.164)")}
                  </Label>
                  <Input
                    type="text"
                    className="h-9 font-mono text-xs"
                    value={current.phone}
                    onChange={(e) => handlePhoneChange(dept.code, e.target.value)}
                    placeholder="+5519999999999"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("Número que receberá a mensagem instantânea do robô.")}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={updateMutation.isPending}
          className="flex items-center gap-2"
        >
          <FloppyDisk size={16} />
          {updateMutation.isPending ? t("Salvando alterações...") : t("Salvar Alterações")}
        </Button>
      </div>
    </form>
  );
}

