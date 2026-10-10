-- 0381 · Checkout direto de conversao (doacao/venda fora do funil de leads)
--
-- Contexto: a Esperanca e Vida (primeiro tenant ativo) recebe doacao via Pix
-- pelo Asaas, direto no site, sem passar por conversa de WhatsApp. O eixo de
-- conversoes ja existente (`ad_conversion_dispatches`, migration 0213) exige
-- `lead_id not null references crm_leads` porque nasceu do funil de venda
-- fechada no kanban. Uma doacao de checkout nao tem lead: forcar a mesma
-- tabela exigiria um `crm_leads` fantasma so para satisfazer a FK, inventando
-- um funil que ninguem abre para inflar metrica de lead.
--
-- Por isso um eixo IRMAO, nao uma reforma do existente: `checkout_conversion_intents`
-- e o livro-razao de uma cobranca criada fora do funil, do pedido ate o
-- reporte (ou falha) da conversao na plataforma de anuncio. Mesmo padrao de
-- `ad_platform_connections`: RLS ligada, zero policy, grant so para
-- service_role — quem cria a cobranca e quem confirma o pagamento sao rotas
-- publicas (checkout do doador, webhook do Asaas), nunca a sessao do tenant.
--
-- `payment_provider_connections` e o irmao de `ad_platform_connections` do
-- lado do PAGAMENTO: a chave do gateway (hoje so Asaas) cifrada por
-- `fn_encrypt_oauth`, e o token que valida que um webhook recebido realmente
-- veio do gateway e nao de qualquer POST na rota.
--
-- `google_conversion_action_id_recorrente` e coluna nova em
-- `ad_platform_connections` (nao tabela nova): uma doacao avulsa e uma
-- assinatura mensal sao dois EVENTOS de conversao diferentes dentro da MESMA
-- conta do Google Ads, cada um com sua propria acao de conversao configurada
-- no Google. A coluna original (`google_conversion_action_id`, migration
-- 0307) passa a significar "avulsa/padrao"; esta e "recorrente", nullable
-- porque nem toda organizacao vende assinatura.

alter table public.ad_platform_connections
  add column if not exists google_conversion_action_id_recorrente text;

comment on column public.ad_platform_connections.google_conversion_action_id_recorrente is
  'Acao de conversao do Google Ads para venda RECORRENTE (assinatura/doacao mensal), quando diferente da acao avulsa em google_conversion_action_id. NULL = organizacao nao distingue, usa a mesma acao para os dois.';

create table if not exists public.payment_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  environment text not null default 'production',
  api_key_encrypted bytea,
  webhook_token_encrypted bytea,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint payment_provider_connections_provider_conhecido
    check (provider in ('asaas')),
  constraint payment_provider_connections_environment_conhecido
    check (environment in ('sandbox', 'production'))
);

create unique index if not exists payment_provider_connections_org_provider_uk
  on public.payment_provider_connections (organization_id, provider);

alter table public.payment_provider_connections enable row level security;
revoke all on public.payment_provider_connections from anon, authenticated;
grant select, insert, update, delete on public.payment_provider_connections to service_role;

drop trigger if exists trg_payment_provider_connections_updated_at on public.payment_provider_connections;
create trigger trg_payment_provider_connections_updated_at
  before update on public.payment_provider_connections
  for each row execute function public.fn_set_updated_at();

create table if not exists public.checkout_conversion_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_platform text not null,
  ad_click_id text,
  conversion_kind text not null,
  provider text not null,
  external_reference text not null,
  provider_charge_id text,
  value_cents bigint not null,
  currency text not null default 'BRL',
  payer_name text,
  payer_email text,
  payer_phone text,
  utm jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  report_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  reported_at timestamptz,
  constraint checkout_conversion_intents_ad_platform_conhecida
    check (ad_platform in ('meta_ads', 'google_ads')),
  constraint checkout_conversion_intents_conversion_kind_conhecido
    check (conversion_kind in ('avulsa', 'recorrente')),
  constraint checkout_conversion_intents_provider_conhecido
    check (provider in ('asaas')),
  constraint checkout_conversion_intents_status_conhecido
    check (status in ('pending', 'paid', 'reported', 'failed', 'expired')),
  constraint checkout_conversion_intents_value_cents_positivo
    check (value_cents > 0)
);

-- Correlaciona a resposta do webhook (que so traz `externalReference` e o id
-- da cobranca no provedor) de volta para a intencao que a criou, sem vazar
-- entre organizacoes: o filtro de organizacao acompanha o indice, nao so o
-- valor — a mesma licao de `ad_platform_connections` (#236, ver credenciais.ts).
create unique index if not exists checkout_conversion_intents_org_ref_uk
  on public.checkout_conversion_intents (organization_id, external_reference);

create unique index if not exists checkout_conversion_intents_org_provider_charge_uk
  on public.checkout_conversion_intents (organization_id, provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists checkout_conversion_intents_status_idx
  on public.checkout_conversion_intents (organization_id, status);

alter table public.checkout_conversion_intents enable row level security;
revoke all on public.checkout_conversion_intents from anon, authenticated;
grant select, insert, update, delete on public.checkout_conversion_intents to service_role;

drop trigger if exists trg_checkout_conversion_intents_updated_at on public.checkout_conversion_intents;
create trigger trg_checkout_conversion_intents_updated_at
  before update on public.checkout_conversion_intents
  for each row execute function public.fn_set_updated_at();
