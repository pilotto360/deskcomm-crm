-- Migration 0382: Suporte ao canal Omnique (WhatsApp Oficial Cloud API)
-- Permite conectar e transacionar via API Omnique (https://omnique.com.br/docs)

alter table public.channel_sessions
  add column if not exists omnique_instance_id text,
  add column if not exists omnique_api_key_encrypted text;

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'omnique'));

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha' and waha_session_name is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id is not null) or
  (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
  (provider = 'wacalls' and wacalls_session_id is not null) or
  (provider = 'omnique' and (omnique_instance_id is not null or meta_phone_number_id is not null))
);
