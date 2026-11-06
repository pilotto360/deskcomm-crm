import { z } from "zod";

export const DEPARTMENT_CODES = [
  "social_service",
  "rosi_sales",
  "robertinho_talks",
  "hr_jobs",
  "hr_volunteers",
  "physical_donations",
  "finance",
  "general_secretary",
] as const;

export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

export interface DepartmentDefinition {
  code: DepartmentCode;
  name: string;
  defaultResponsible: string;
  defaultPhone: string;
  description: string;
}

export const OFFICIAL_DEPARTMENTS: readonly DepartmentDefinition[] = [
  {
    code: "social_service",
    name: "Serviço Social (Triagem e Vagas)",
    defaultResponsible: "Assistente Social",
    defaultPhone: "+5519994815905",
    description: "Triagem para acolhimento e vagas assistenciais",
  },
  {
    code: "rosi_sales",
    name: "Vendas Corporativas e Visitas",
    defaultResponsible: "Rosi",
    defaultPhone: "+5519987482979",
    description: "Parcerias empresariais, compras corporativas e visitas",
  },
  {
    code: "robertinho_talks",
    name: "Palestras do Robertinho (SIPAT)",
    defaultResponsible: "Coordenação de Palestras",
    defaultPhone: "+5519974081679",
    description: "Agendamento de palestras SIPAT e eventos externos",
  },
  {
    code: "hr_jobs",
    name: "Recursos Humanos (Empregos/Vagas)",
    defaultResponsible: "Gestão de Pessoas / RH",
    defaultPhone: "+5519995339476",
    description: "Processos seletivos, envio de currículos e contratações",
  },
  {
    code: "hr_volunteers",
    name: "Coordenação de Voluntariado",
    defaultResponsible: "Equipe de Voluntariado",
    defaultPhone: "+5519995339476",
    description: "Acolhimento, escalas e gestão de voluntários",
  },
  {
    code: "physical_donations",
    name: "Doações de Materiais e Bazar",
    defaultResponsible: "Almoxarifado e Bazar",
    defaultPhone: "+5519974081679",
    description: "Recebimento e triagem de doações físicas e bazar",
  },
  {
    code: "finance",
    name: "Setor Financeiro e Captação",
    defaultResponsible: "Setor Financeiro",
    defaultPhone: "+5519974081679",
    description: "Doações financeiras, notas, recibos e captação",
  },
  {
    code: "general_secretary",
    name: "Secretaria Geral e Recepção",
    defaultResponsible: "Recepção Geral",
    defaultPhone: "+5519974081679",
    description: "Informações gerais, localização e atendimento inicial",
  },
] as const;

export const departmentItemSchema = z.object({
  code: z.enum(DEPARTMENT_CODES),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{9,14}$/, "Telefone deve estar no formato internacional E.164 (ex: +5519994815905)"),
  assigned_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(300).optional(),
});

export const updateDepartmentsSchema = z.object({
  departments: z.array(departmentItemSchema).min(1),
});

export type DepartmentItem = z.infer<typeof departmentItemSchema>;
export type UpdateDepartmentsInput = z.infer<typeof updateDepartmentsSchema>;

export interface DepartmentSettingResult {
  code: DepartmentCode;
  name: string;
  description: string;
  defaultResponsible: string;
  phone: string;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
  notes?: string;
}

export function buildAgentConfigKeyUser(code: DepartmentCode): string {
  return `dept_user_${code}`;
}

export function buildAgentConfigKeyPhone(code: DepartmentCode): string {
  return `dept_phone_${code}`;
}

export function parseConfigString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
  return String(val);
}

