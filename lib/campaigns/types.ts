export type CampaignStatus =
  | "draft"
  | "preparing"
  | "ready"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type RecipientStatus =
  | "pending"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "failed"
  | "cancelled";

export interface CampaignAudienceFilter {
  tag?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel_session_id: string;
  message_body: string | null;
  base_legal: string;
  lia_ref: string | null;
  audience_filter: CampaignAudienceFilter;
  intervalo_segundos: number | null;
  janela_inicio_hora: number | null;
  janela_fim_hora: number | null;
  teto_diario: number | null;
  teto_horario: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  snapshot_total: number;
  snapshot_eligible: number;
  snapshot_excluded: number;
  created_at: string;
  updated_at: string;
  pipeline_id: string | null;
  stage_id: string | null;
  agent_id: string | null;
}

export interface CampaignWithStats extends Campaign {
  total_recipients: number;
  sent_total: number;
  sent_today: number;
  pending_total: number;
  failed_total: number;
  last_sent_at: string | null;
  channel_name?: string;
  pipeline_name?: string;
  stage_name?: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
  channel_session_id: string;
  message_body: string;
  tag: string;
  teto_diario?: number;
  intervalo_segundos?: number;
  janela_inicio_hora?: number;
  janela_fim_hora?: number;
  pipeline_id?: string;
  stage_id?: string;
  agent_id?: string;
  auto_start?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  message_body?: string;
  status?: CampaignStatus;
  teto_diario?: number;
  intervalo_segundos?: number;
  janela_inicio_hora?: number;
  janela_fim_hora?: number;
}
