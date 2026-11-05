-- Migration 0383: Suporte a templates oficiais da Meta nas campanhas
-- Permite que campanhas disparem usando templates oficiais aprovados para alcançar
-- contatos com janela de 24h fechada (política oficial WhatsApp Cloud API).

alter table public.campaigns
  add column if not exists send_type text not null default 'text',
  add column if not exists template_name text,
  add column if not exists template_language text default 'pt_BR',
  add column if not exists template_variables jsonb default '{}'::jsonb;
