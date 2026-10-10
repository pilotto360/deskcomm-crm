import pg from 'pg';

const ASAAS_API_KEY = (process.env.ASAAS_API_KEY || '').trim();
const ASAAS_BASE_URL = (process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').trim();
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!ASAAS_API_KEY) {
  console.error('Erro: ASAAS_API_KEY não configurada no .env.local');
  process.exit(1);
}

if (!SUPABASE_DB_URL) {
  console.error('Erro: SUPABASE_DB_URL não configurada no .env.local');
  process.exit(1);
}

function normalizarTelefone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('55') && digits.length >= 12) {
    return '+' + digits;
  }
  return '+55' + digits;
}

function normalizarCpfCnpj(raw) {
  if (!raw) return null;
  return raw.replace(/\D/g, '');
}

async function fetchAsaas(endpoint) {
  const url = `${ASAAS_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'access_token': ASAAS_API_KEY,
      'User-Agent': 'DeskcommCRM-Sync'
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha na API Asaas [${res.status}]: ${errText}`);
  }
  return await res.json();
}

async function carregarTodasAssinaturas() {
  console.log('-> Buscando assinaturas no Asaas...');
  const map = new Map();
  let offset = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const data = await fetchAsaas(`/subscriptions?limit=${limit}&offset=${offset}`);
    total = data.totalCount;
    for (const sub of data.data) {
      // Prioriza assinatura ativa se o cliente tiver mais de uma
      const atual = map.get(sub.customer);
      if (!atual || (sub.status === 'ACTIVE' && atual.status !== 'ACTIVE')) {
        map.set(sub.customer, {
          valor: sub.value,
          ciclo: sub.cycle,
          status: sub.status,
          proxima_cobranca: sub.nextDueDate
        });
      }
    }
    offset += limit;
    if (!data.hasMore || offset >= total) break;
  }

  console.log(`   Assinaturas mapeadas: ${map.size} de ${total}`);
  return map;
}

async function carregarTodosPagamentos() {
  console.log('-> Buscando pagamentos confirmados/recebidos no Asaas...');
  const map = new Map();
  let offset = 0;
  const limit = 100;
  let total = 0;
  let processados = 0;

  while (true) {
    const data = await fetchAsaas(`/payments?status=RECEIVED,CONFIRMED&limit=${limit}&offset=${offset}`);
    total = data.totalCount;
    for (const p of data.data) {
      processados++;
      const cid = p.customer;
      const v = Number(p.value || 0);
      const dataPagto = p.paymentDate || p.confirmedDate || p.dueDate;

      let item = map.get(cid);
      if (!item) {
        item = {
          totalPago: 0,
          qtd: 0,
          primeiraData: dataPagto,
          ultimaData: dataPagto
        };
        map.set(cid, item);
      }
      item.totalPago += v;
      item.qtd += 1;
      if (dataPagto && (!item.primeiraData || dataPagto < item.primeiraData)) {
        item.primeiraData = dataPagto;
      }
      if (dataPagto && (!item.ultimaData || dataPagto > item.ultimaData)) {
        item.ultimaData = dataPagto;
      }
    }
    offset += limit;
    if (offset % 500 === 0 || offset >= total) {
      console.log(`   Pagamentos processados: ${processados} de ${total}...`);
    }
    if (!data.hasMore || offset >= total) break;
  }

  console.log(`   Pagamentos agrupados por ${map.size} clientes.`);
  return map;
}

async function carregarTodosClientes() {
  console.log('-> Buscando clientes no Asaas...');
  const clientes = [];
  let offset = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const data = await fetchAsaas(`/customers?limit=${limit}&offset=${offset}`);
    total = data.totalCount;
    clientes.push(...data.data);
    offset += limit;
    console.log(`   Clientes baixados: ${clientes.length} de ${total}...`);
    if (!data.hasMore || offset >= total) break;
  }

  console.log(`   Total final de clientes baixados: ${clientes.length}`);
  return clientes;
}

async function main() {
  console.log('=== SINCRONIZAÇÃO ASAAS -> TABELA ESPELHO (public.asaas_contatos) ===\n');

  const pool = new pg.Pool({ connectionString: SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    // 1. Cria tabela espelho se não existir
    console.log('-> Criando/garantindo tabela public.asaas_contatos...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.asaas_contatos (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        asaas_customer_id text UNIQUE NOT NULL,
        nome text,
        cpf_cnpj text,
        cpf_limpo text,
        email text,
        telefone text,
        celular text,
        telefone_e164 text,
        endereco_rua text,
        endereco_numero text,
        endereco_bairro text,
        endereco_complemento text,
        endereco_cep text,
        cidade text,
        estado text,
        total_pago numeric(14,2) DEFAULT 0,
        qtd_cobrancas_pagas integer DEFAULT 0,
        valor_assinatura_ativa numeric(14,2),
        periodicidade_assinatura text,
        status_assinatura text,
        data_primeira_cobranca timestamp with time zone,
        data_ultima_cobranca timestamp with time zone,
        raw_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamp with time zone DEFAULT now(),
        updated_at timestamp with time zone DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_asaas_contatos_cpf_limpo ON public.asaas_contatos (cpf_limpo);
      CREATE INDEX IF NOT EXISTS idx_asaas_contatos_telefone_e164 ON public.asaas_contatos (telefone_e164);
      CREATE INDEX IF NOT EXISTS idx_asaas_contatos_asaas_id ON public.asaas_contatos (asaas_customer_id);
    `);
    console.log('   Tabela public.asaas_contatos pronta.\n');

    // 2. Coletar dados da API
    const assinaturasMap = await carregarTodasAssinaturas();
    const pagamentosMap = await carregarTodosPagamentos();
    const clientes = await carregarTodosClientes();

    // 3. Gravar na tabela public.asaas_contatos
    console.log('\n-> Gravando registros na tabela public.asaas_contatos...');
    let inseridosOuAtualizados = 0;

    for (const c of clientes) {
      const sub = assinaturasMap.get(c.id);
      const pag = pagamentosMap.get(c.id);

      const cpfLimpo = normalizarCpfCnpj(c.cpfCnpj);
      const telE164 = normalizarTelefone(c.mobilePhone || c.phone);

      const query = `
        INSERT INTO public.asaas_contatos (
          asaas_customer_id,
          nome,
          cpf_cnpj,
          cpf_limpo,
          email,
          telefone,
          celular,
          telefone_e164,
          endereco_rua,
          endereco_numero,
          endereco_bairro,
          endereco_complemento,
          endereco_cep,
          cidade,
          estado,
          total_pago,
          qtd_cobrancas_pagas,
          valor_assinatura_ativa,
          periodicidade_assinatura,
          status_assinatura,
          data_primeira_cobranca,
          data_ultima_cobranca,
          raw_data,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, now()
        )
        ON CONFLICT (asaas_customer_id) DO UPDATE SET
          nome = EXCLUDED.nome,
          cpf_cnpj = EXCLUDED.cpf_cnpj,
          cpf_limpo = EXCLUDED.cpf_limpo,
          email = EXCLUDED.email,
          telefone = EXCLUDED.telefone,
          celular = EXCLUDED.celular,
          telefone_e164 = EXCLUDED.telefone_e164,
          endereco_rua = EXCLUDED.endereco_rua,
          endereco_numero = EXCLUDED.endereco_numero,
          endereco_bairro = EXCLUDED.endereco_bairro,
          endereco_complemento = EXCLUDED.endereco_complemento,
          endereco_cep = EXCLUDED.endereco_cep,
          cidade = EXCLUDED.cidade,
          estado = EXCLUDED.estado,
          total_pago = EXCLUDED.total_pago,
          qtd_cobrancas_pagas = EXCLUDED.qtd_cobrancas_pagas,
          valor_assinatura_ativa = EXCLUDED.valor_assinatura_ativa,
          periodicidade_assinatura = EXCLUDED.periodicidade_assinatura,
          status_assinatura = EXCLUDED.status_assinatura,
          data_primeira_cobranca = EXCLUDED.data_primeira_cobranca,
          data_ultima_cobranca = EXCLUDED.data_ultima_cobranca,
          raw_data = EXCLUDED.raw_data,
          updated_at = now();
      `;

      const values = [
        c.id,
        c.name || null,
        c.cpfCnpj || null,
        cpfLimpo,
        c.email ? c.email.toLowerCase().trim() : null,
        c.phone || null,
        c.mobilePhone || null,
        telE164,
        c.address || null,
        c.addressNumber || null,
        c.province || null,
        c.complement || null,
        c.postalCode || null,
        c.cityName || null,
        c.state || null,
        pag ? pag.totalPago : 0,
        pag ? pag.qtd : 0,
        sub ? sub.valor : null,
        sub ? sub.ciclo : null,
        sub ? sub.status : null,
        pag?.primeiraData ? new Date(pag.primeiraData) : null,
        pag?.ultimaData ? new Date(pag.ultimaData) : null,
        JSON.stringify(c)
      ];

      await client.query(query, values);
      inseridosOuAtualizados++;
    }

    console.log(`   Sucesso! ${inseridosOuAtualizados} clientes gravados em public.asaas_contatos.\n`);

    // 4. Executar Cruzamento Analítico com a tabela public.contatos
    console.log('================================================================');
    console.log('             RELATÓRIO DE CRUZAMENTO COM public.contatos        ');
    console.log('================================================================');

    const cruzamentoQ = await client.query(`
      WITH asaas_stats AS (
        SELECT count(*) as total_asaas FROM public.asaas_contatos
      ),
      contatos_stats AS (
        SELECT count(*) as total_contatos FROM public.contatos
      ),
      match_cpf AS (
        SELECT count(DISTINCT a.id) as qtd
        FROM public.asaas_contatos a
        JOIN public.contatos c 
          ON regexp_replace(c.cpf, '\\D', '', 'g') = a.cpf_limpo
        WHERE a.cpf_limpo IS NOT NULL AND a.cpf_limpo != ''
      ),
      match_telefone AS (
        SELECT count(DISTINCT a.id) as qtd
        FROM public.asaas_contatos a
        JOIN public.contatos c 
          ON (c.telefone_e164 = a.telefone_e164 OR regexp_replace(c.telefone, '\\D', '', 'g') = regexp_replace(a.celular, '\\D', '', 'g'))
        WHERE a.telefone_e164 IS NOT NULL
      ),
      match_qualquer AS (
        SELECT count(DISTINCT a.id) as qtd
        FROM public.asaas_contatos a
        JOIN public.contatos c 
          ON (
            (a.cpf_limpo IS NOT NULL AND a.cpf_limpo != '' AND regexp_replace(c.cpf, '\\D', '', 'g') = a.cpf_limpo)
            OR (a.asaas_customer_id IS NOT NULL AND c.asaas_customer_id = a.asaas_customer_id)
            OR (a.telefone_e164 IS NOT NULL AND c.telefone_e164 = a.telefone_e164)
          )
      )
      SELECT 
        (SELECT total_asaas FROM asaas_stats) as total_asaas,
        (SELECT total_contatos FROM contatos_stats) as total_contatos,
        (SELECT qtd FROM match_cpf) as match_por_cpf,
        (SELECT qtd FROM match_telefone) as match_por_telefone,
        (SELECT qtd FROM match_qualquer) as match_total_cruzados;
    `);

    const r = cruzamentoQ.rows[0];
    const totalAsaas = Number(r.total_asaas);
    const totalContatos = Number(r.total_contatos);
    const matchCpf = Number(r.match_por_cpf);
    const matchTel = Number(r.match_por_telefone);
    const matchTotal = Number(r.match_total_cruzados);
    const asaasNovos = totalAsaas - matchTotal;
    const exDoadoresReais = totalContatos - matchTotal;

    console.log(`• Total importado do Asaas:                  ${totalAsaas}`);
    console.log(`• Total existente em public.contatos:        ${totalContatos}`);
    console.log(`----------------------------------------------------------------`);
    console.log(`• Clientes do Asaas que deram match por CPF: ${matchCpf}`);
    console.log(`• Clientes do Asaas que deram match por TEL: ${matchTel}`);
    console.log(`• Total de clientes do Asaas já existentes:  ${matchTotal}`);
    console.log(`• Clientes do Asaas que são 100% NOVOS:      ${asaasNovos}`);
    console.log(`• Ex-doadores reais (base antiga sem Asaas): ${exDoadoresReais}`);
    console.log('================================================================\n');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nErro durante a execução:', err);
  process.exit(1);
});
