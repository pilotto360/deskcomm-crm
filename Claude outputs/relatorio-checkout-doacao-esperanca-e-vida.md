# Relatório de handoff — Checkout direto de doação + conversão Google Ads (Esperança e Vida)

Documento para passar ao Antigravity dar continuidade. Cobre contexto, decisões, arquivos tocados e o que falta.

## 1. Contexto e objetivo

A Esperança e Vida (ONG) tem US$ 10 mil/mês de Google Ad Grants e não conseguia gastar. Diagnóstico feito direto na conta do Google Ads: existem duas ações de conversão do tipo "Importar de cliques" já criadas ("Doação avulsa confirmada" e "Novo doador mensal confirmado"), as duas zeradas porque nunca foram conectadas a nenhuma fonte de dado. O Google reduz o gasto de contas Ad Grants sem conversão registrada — é essa a causa raiz do orçamento não sair do lugar, não falta de tráfego.

No site (esperancaevida.org.br/doacoes), o fluxo de doação hoje passa por um webhook n8n que cria um Payment Link dinâmico no Asaas a cada clique. Isso funciona, mas tem três problemas: (1) não dá pra confirmar se o `gclid` (id do clique do anúncio) está sendo gravado como `externalReference` da cobrança — sem isso não tem como saber qual anúncio gerou qual doação; (2) cada link é um objeto novo no painel do Asaas, sujando o painel; (3) sai do domínio da Esperança e Vida (redireciona pro Asaas), perdendo a sensação de doar "no site deles".

Decisão tomada com o Roberto: construir uma solução própria, dentro do DeskcommCRM (o CRM open-source multi-tenant que ele já opera, e onde a Esperança e Vida já é o primeiro tenant ativo), reaproveitando: a infraestrutura de conversão do Google Ads que já existe no CRM (`lib/plataformas-de-anuncio/`), a chave de API do Asaas já configurada no ambiente, e o padrão de checkout Pix embutido no próprio domínio que ele já usa em produção no buscajudicial.com.br (QR code + copia-e-cola gerados via API, não link estático).

**Onde queremos chegar:** doador clica no anúncio do Google → cai em `esperancaevida.org.br/doar/esperanca-e-vida?gclid=...` (dentro do próprio domínio, sem sair para o Asaas) → preenche nome/CPF/valor → recebe o QR Pix na hora → paga → o CRM recebe a confirmação do Asaas e reporta a conversão pro Google Ads automaticamente, escolhendo a ação certa (avulsa ou recorrente) → a conta de Ad Grants passa a ter dado de conversão real e o Google libera o gasto do orçamento.

## 2. Decisões de arquitetura (o "porquê" por trás do código)

- **Eixo novo, não reforma do existente.** O CRM já tem uma tabela de conversões (`ad_conversion_dispatches`) e um handler (`lib/conversoes/envio.handler.ts`), mas os dois são gated em `crm_leads.status = 'won'` — nascem do funil de venda fechado no kanban de WhatsApp. Uma doação de site não passa por lead nenhum. Forçar esse caminho exigiria inventar um "lead fantasma" só pra satisfazer uma foreign key. Em vez disso, criamos um eixo IRMÃO (`checkout_conversion_intents`), com o mesmo padrão de tabela server-side-only já usado em `ad_platform_connections`/`ad_insights_connections`, mas que chama o MESMO transporte de envio pro Google Ads (`transporteDe('google_ads')!.enviar(...)`) direto, sem passar pelo handler do funil.
- **Doação avulsa × recorrente são duas ações de conversão distintas.** O Google Ads trata isso como dois eventos diferentes na mesma conta. Por isso a coluna nova `google_conversion_action_id_recorrente` em `ad_platform_connections` — a coluna original passa a significar "avulsa".
- **Grava a intenção no banco ANTES de chamar o Asaas.** Se a chamada pro Asaas desse certo e a gravação no nosso banco falhasse depois, teria dinheiro entrando sem nenhum registro nosso sabendo. Com a ordem invertida, o pior caso é uma linha `pending` órfã e visível — nunca um pagamento invisível.
- **O webhook do Asaas separa duas responsabilidades.** Confirmar o pagamento (sempre, idempotente) é uma coisa; reportar a conversão pro Google (melhor esforço, depois) é outra. Se o reporte pro Google falhar (rede, credencial incompleta), o endpoint AINDA responde 200 pro Asaas — senão o Asaas reenviaria o mesmo webhook de pagamento por um problema que é nosso, do lado do Google, e não dele.
- **Checkout busca ou cria o cliente no Asaas por CPF antes de criar a cobrança**, pra não duplicar cadastro de doador recorrente a cada doação — é a queixa original do Roberto sobre "sujar o painel do Asaas".
- **Página de doação fora do layout de login do CRM.** O layout `(public)` existente é a marca de quem INSTALOU o CRM (pensado pra tela de login), não da organização que está recebendo a doação. Criamos rota e layout próprios em `/doar/[org]`.
- **Dinheiro sempre em `_cents` internamente**, convertido pra reais só na borda que fala com a API do Asaas (ela espera valor em unidade, não centavo).

## 3. O que foi executado (comandos rodados)

Todo o trabalho foi feito direto na pasta do repositório no computador do Roberto (pasta conectada `DeskcommCRM`), via shell remoto. Resumo do que rodei:

- Leitura extensiva do código existente antes de escrever qualquer coisa nova: `CLAUDE.md`, `VISION.md`, `lib/plataformas-de-anuncio/*`, `lib/conversoes/envio.handler.ts`, `lib/webhooks/secrets.ts`, `lib/api/wrappers.ts`, `lib/auth/public-paths.ts`, `lib/ai/dispatcher/rate-limit.ts`, a landing page de gclid existente (`app/api/v1/anuncios/google/[org]/route.ts`), o `supabase/baseline.sql` e o `MANIFEST.md` de migrations, pra garantir que o código novo segue exatamente os mesmos padrões (multi-tenancy + RLS, migration triple, restrição de canal, wrappers de API).
- Escrevi a migration nova e apliquei os três passos que a doutrina do projeto exige pra toda mudança de schema: arquivo em `supabase/migrations/`, apêndice idempotente em `supabase/baseline.sql`, linha em `supabase/migrations/MANIFEST.md`.
- Editei dois arquivos existentes de forma aditiva (ver seção 4).
- Criei os módulos novos de `lib/pagamentos/` e `lib/checkout/`, as três rotas de API, a página pública e dois arquivos de teste de unidade.
- Tentei rodar `tsc --noEmit`, `npx tsc`, `node_modules/.bin/vitest` e `npx vitest` pra validar o código escrito. **Todos falharam com o mesmo erro** (`Cannot find module '.../node_modules/typescript/bin/tsc'` e equivalente pro vitest) — é um problema de symlink do pnpm que não resolve através da ponte de pasta remota (Windows → Linux) usada nesta sessão. Já tinha acontecido antes nesta mesma sessão com o módulo `pg`. **Não é um problema do código novo, é do ambiente desta sessão de trabalho** — não consegui contornar.
- Revisei manualmente, arquivo por arquivo, tipos e assinaturas contra o código existente pra reduzir o risco de erro de compilação, e corrigi uma digitação que eu mesmo cometi (`z.string trim()` → `z.string().trim()`) que só encontrei nessa revisão manual, já que não rodou o compilador.

**Import ante ao Antigravity: antes de mergear, rodar localmente** `pnpm typecheck`, `pnpm lint:channels` e `pnpm vitest run` — nenhum dos três rodou nesta sessão.

## 4. Arquivos alterados/criados, com o motivo de cada um

### Schema (banco de dados)

| Arquivo | O que mudou | Por quê |
|---|---|---|
| `supabase/migrations/20260926120000_0381_checkout_direto_de_conversao.sql` | **Novo.** Cria `payment_provider_connections`, `checkout_conversion_intents`, e adiciona a coluna `google_conversion_action_id_recorrente` em `ad_platform_connections`. | A migration em si — segue o padrão de RLS ligada + zero policy + grant só pra `service_role` já usado nas tabelas irmãs (`ad_platform_connections`, `ad_insights_connections`). |
| `supabase/baseline.sql` | Apêndice idempotente com o mesmo DDL acima. | O instalador self-host do CRM roda esse arquivo do zero; sem o apêndice, uma instalação nova não teria as tabelas. |
| `supabase/migrations/MANIFEST.md` | Linha nova documentando a migration 0381. | Convenção do projeto: toda migration precisa de uma linha aqui. |

### Vocabulário de conversão (edição aditiva)

| Arquivo | O que mudou | Por quê |
|---|---|---|
| `lib/plataformas-de-anuncio/types.ts` | Campo opcional novo `conversionActionIdRecorrente` dentro de `CredencialDeConversao.google`. | Carrega o id da ação de conversão recorrente até quem decide qual usar. Não quebra nada que já existe (campo opcional). |
| `lib/plataformas-de-anuncio/credenciais.ts` | `lerCredencial` passa a selecionar e devolver também `google_conversion_action_id_recorrente`. | Doutrina do próprio projeto: não duplicar leitura de credencial em outro arquivo. |

### Pagamento (módulo novo, agnóstico a provider)

| Arquivo | Conteúdo |
|---|---|
| `lib/pagamentos/types.ts` | Vocabulário: `PedidoDeCobranca`, `CobrancaPixCriada`, `CredencialDePagamento`. |
| `lib/pagamentos/credenciais.ts` | Lê e decifra a credencial de `payment_provider_connections`, sempre filtrando por `organization_id`. |
| `lib/pagamentos/asaas/cobranca.ts` | Client do Asaas: busca/cria cliente por CPF, cria a cobrança Pix, busca o QR code. Só aqui o nome "Asaas" aparece de fato. |
| `lib/pagamentos/asaas/cobranca.test.ts` | Testes de unidade da leitura de erro do Asaas e do formato de data — sem rede. |
| `lib/pagamentos/registry.ts` | Despacha pro client certo pelo nome do provider (hoje só `asaas`). |

### Checkout (módulo novo, orquestra pagamento + conversão)

| Arquivo | Conteúdo |
|---|---|
| `lib/checkout/tipos.ts` | Vocabulário de entrada/saída do checkout. |
| `lib/checkout/intencao.ts` | `criarIntencaoDeCheckout`: grava a intenção, chama o Asaas, atualiza com o id da cobrança. |
| `lib/checkout/conversao-de-doacao.ts` | `reportarConversaoDaIntencao`: pega uma intenção paga e chama o transporte do Google Ads existente, escolhendo a ação de conversão certa (avulsa/recorrente). |
| `lib/checkout/conversao-de-doacao.test.ts` | Testes de unidade da escolha avulsa/recorrente — sem rede, sem banco. |

### Rotas de API (públicas, sem sessão)

| Arquivo | Conteúdo |
|---|---|
| `app/api/v1/checkout/[org]/intents/route.ts` | `POST` — cria a intenção de checkout, com rate limit por IP e validação Zod. |
| `app/api/v1/checkout/[org]/intents/[id]/route.ts` | `GET` — consulta status, usado pelo polling da página enquanto o QR está na tela. |
| `app/api/v1/webhooks/asaas/[org]/route.ts` | `POST` — recebe a confirmação de pagamento do Asaas, valida o token do webhook, confirma o pagamento e dispara o reporte de conversão. |

### Autenticação

| Arquivo | O que mudou | Por quê |
|---|---|---|
| `lib/auth/public-paths.ts` | 3 regex novos: `/doar/[org]`, `POST intents`, `GET intents/[id]`. | Sem isso o middleware global do CRM barra qualquer chamada com 401 antes do handler rodar — essas rotas são chamadas pelo navegador do doador, que não tem sessão nossa. |

### Página pública

| Arquivo | Conteúdo |
|---|---|
| `app/doar/[org]/page.tsx` | Server component: lê `gclid` e UTMs da query string, monta o layout. |
| `app/doar/[org]/checkout-doacao.tsx` | Client component: formulário, chamada de API, exibição do QR/copia-e-cola, polling de status. |

### Limpeza

`_to_delete/_tmp_check_org.mjs` — arquivo temporário de uma tentativa anterior (não relacionado a esta feature), movido pra essa pasta porque a exclusão direta na pasta conectada exige permissão que ainda não foi concedida. Precisa ser apagado manualmente.

## 5. O que falta pra isso funcionar de verdade (pendências)

1. **Rodar a validação local** — `pnpm typecheck`, `pnpm lint:channels`, `pnpm vitest run`. Nada disso rodou nesta sessão por causa do bug de ambiente descrito acima.
2. **Aplicar a migration** no banco (staging e depois produção) e conferir que o `baseline.sql` aplica limpo numa instalação nova.
3. **Não existe tela de configuração** para `payment_provider_connections` — hoje a chave de API do Asaas e o token do webhook da Esperança e Vida têm que entrar via SQL direto (cifrados com `fn_encrypt_oauth`, mesma RPC já usada pra outras credenciais). Construir essa tela é o próximo passo natural.
4. **Preencher os dois `google_conversion_action_id` / `google_conversion_action_id_recorrente`** em `ad_platform_connections` com os ids reais das duas ações que já existem na conta do Google Ads da Esperança e Vida ("Doação avulsa confirmada" / "Novo doador mensal confirmado").
5. **Configurar no painel do Asaas** o webhook apontando para `/api/v1/webhooks/asaas/esperanca-e-vida` com o mesmo token gravado cifrado no banco.
6. **Trocar o anúncio do Google Ads** pra apontar pra `/doar/esperanca-e-vida` em vez do fluxo n8n atual, só depois dos itens acima estarem testados de ponta a ponta em sandbox do Asaas.
7. Teste manual de ponta a ponta com o CPF de teste que o Roberto já usa (`10216870810`), em ambiente sandbox do Asaas antes de qualquer teste com dinheiro real.
