-- ═══════════════════════════════════════════════════════════════════════════
-- 0371 — Tabela de configuração dinâmica do agente de IA (agent_config)
-- e parâmetros de encaminhamento departamental inteligente.
--
-- Alinha o DeskcommCRM com o robô de IA do WhatsApp (Associação Esperança e Vida).
-- O robô consulta agent_config a cada 60s em cache em memória.
-- A interface do CRM persiste aqui os números de WhatsApp e IDs de operadores
-- de cada departamento.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agent_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- RLS habilitada
alter table public.agent_config enable row level security;

-- Política de leitura: autenticados e service_role podem ler configurações
drop policy if exists "agent_config_select" on public.agent_config;
create policy "agent_config_select"
  on public.agent_config
  for select
  to authenticated, service_role
  using (true);

-- Política de escrita: restrita a service_role e administradores/gerentes
drop policy if exists "agent_config_write" on public.agent_config;
create policy "agent_config_write"
  on public.agent_config
  for all
  to authenticated, service_role
  using (
    exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.role in ('admin', 'manager')
        and uo.revoked_at is null
    ) or auth.role() = 'service_role'
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.role in ('admin', 'manager')
        and uo.revoked_at is null
    ) or auth.role() = 'service_role'
  );

-- Garantir índices e permissões
grant select on public.agent_config to authenticated;
grant all on public.agent_config to service_role;

-- Inserção de chaves padrão dos departamentos (se não existirem)
insert into public.agent_config (key, value, description)
values
  ('dept_phone_social_service',   '"+5519994815905"'::jsonb, 'WhatsApp do Serviço Social (Triagem e Vagas)'),
  ('dept_phone_rosi_sales',       '"+5519987482979"'::jsonb, 'WhatsApp de Vendas Corporativas e Visitas (Rosi)'),
  ('dept_phone_robertinho_talks', '"+5519974081679"'::jsonb, 'WhatsApp de Palestras Robertinho (SIPAT)'),
  ('dept_phone_hr_jobs',          '"+5519995339476"'::jsonb, 'WhatsApp de Recursos Humanos (Empregos/Vagas)'),
  ('dept_phone_hr_volunteers',    '"+5519995339476"'::jsonb, 'WhatsApp de Coordenação de Voluntariado'),
  ('dept_phone_physical_donations','"+5519974081679"'::jsonb, 'WhatsApp de Doações de Materiais e Bazar'),
  ('dept_phone_finance',          '"+5519974081679"'::jsonb, 'WhatsApp de Setor Financeiro e Captação'),
  ('dept_phone_general_secretary', '"+5519974081679"'::jsonb, 'WhatsApp de Secretaria Geral e Recepção')
on conflict (key) do nothing;

