import pg from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Erro: SUPABASE_DB_URL não configurada no .env.local');
  process.exit(1);
}

async function main() {
  console.log('=== ATUALIZAÇÃO E SEGMENTAÇÃO DE public.contatos ===\n');

  const pool = new pg.Pool({ connectionString: SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    // 0. Backup de segurança prévio
    console.log('-> Criando backup de segurança da tabela public.contatos...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.contatos_backup_20260923 AS 
      SELECT * FROM public.contatos;
    `);
    const countBkp = await client.query('SELECT count(*) as total FROM public.contatos_backup_20260923;');
    console.log(`   Backup garantido: ${countBkp.rows[0].total} registros salvos em public.contatos_backup_20260923.\n`);

    // Inicia transação
    await client.query('BEGIN');

    // 1. Atualizar os contatos existentes que deram MATCH com o Asaas
    console.log('-> Atualizando os contatos existentes com dados do Asaas (Doador Ativo)...');
    const updateMatchQ = await client.query(`
      WITH matches AS (
        SELECT 
          c.id as contato_id,
          a.asaas_customer_id,
          a.total_pago,
          a.qtd_cobrancas_pagas,
          a.valor_assinatura_ativa,
          a.periodicidade_assinatura,
          a.data_ultima_cobranca,
          a.telefone_e164 as asaas_tel_e164,
          a.nome as asaas_nome,
          a.email as asaas_email
        FROM public.contatos c
        JOIN public.asaas_contatos a
          ON (a.cpf_limpo IS NOT NULL AND a.cpf_limpo != '' AND a.cpf_limpo = regexp_replace(c.cpf, '\\D', '', 'g'))
          OR (a.asaas_customer_id IS NOT NULL AND a.asaas_customer_id = c.asaas_customer_id)
      )
      UPDATE public.contatos c
      SET
        asaas_customer_id = m.asaas_customer_id,
        tipo_contato = 'doador',
        status_relacionamento = 'ativo',
        total_doado = GREATEST(COALESCE(c.total_doado, 0), COALESCE(m.total_pago, 0)),
        qtd_doacoes = GREATEST(COALESCE(c.qtd_doacoes, 0), COALESCE(m.qtd_cobrancas_pagas, 0)),
        valor = COALESCE(NULLIF(m.valor_assinatura_ativa::text, ''), c.valor),
        periodicidade = COALESCE(m.periodicidade_assinatura, c.periodicidade),
        ultima_doacao = GREATEST(c.ultima_doacao, m.data_ultima_cobranca),
        telefone_e164 = COALESCE(c.telefone_e164, m.asaas_tel_e164),
        nome = COALESCE(c.nome, m.asaas_nome),
        email = COALESCE(c.email, m.asaas_email),
        tags = (
          SELECT ARRAY(
            SELECT DISTINCT tag 
            FROM unnest(c.tags || ARRAY['asaas', 'doador_ativo']) as tag
            WHERE tag NOT IN ('ex_doador', 'fila_enriquecimento_cpf')
          )
        )
      FROM matches m
      WHERE c.id = m.contato_id;
    `);
    console.log(`   Contatos existentes promovidos para Doadores Ativos: ${updateMatchQ.rowCount}\n`);

    // 2. Inserir os clientes do Asaas que são 100% NOVOS
    console.log('-> Inserindo clientes novos do Asaas em public.contatos...');
    const novosAsaasQ = await client.query(`
      SELECT a.*
      FROM public.asaas_contatos a
      WHERE NOT EXISTS (
        SELECT 1 FROM public.contatos c
        WHERE (a.cpf_limpo IS NOT NULL AND a.cpf_limpo != '' AND a.cpf_limpo = regexp_replace(c.cpf, '\\D', '', 'g'))
           OR (a.asaas_customer_id IS NOT NULL AND a.asaas_customer_id = c.asaas_customer_id)
      )
    `);

    let inseridosNovos = 0;
    let atualizadosPorTelefone = 0;

    for (const a of novosAsaasQ.rows) {
      const tel = a.celular || a.telefone;
      let existingId = null;
      if (tel) {
        const checkTel = await client.query('SELECT id FROM public.contatos WHERE telefone = $1 LIMIT 1', [tel]);
        if (checkTel.rows.length > 0) {
          existingId = checkTel.rows[0].id;
        }
      }

      if (existingId) {
        await client.query(`
          UPDATE public.contatos
          SET 
            asaas_customer_id = $1,
            tipo_contato = 'doador',
            status_relacionamento = 'ativo',
            total_doado = GREATEST(COALESCE(total_doado, 0), $2),
            qtd_doacoes = GREATEST(COALESCE(qtd_doacoes, 0), $3),
            cpf = COALESCE(cpf, $4),
            tags = (
              SELECT ARRAY(
                SELECT DISTINCT tag 
                FROM unnest(tags || ARRAY['asaas', 'doador_ativo']) as tag
                WHERE tag NOT IN ('ex_doador', 'fila_enriquecimento_cpf')
              )
            )
          WHERE id = $5
        `, [a.asaas_customer_id, a.total_pago || 0, a.qtd_cobrancas_pagas || 0, a.cpf_cnpj, existingId]);
        atualizadosPorTelefone++;
      } else {
        await client.query(`
          INSERT INTO public.contatos (
            nome,
            telefone,
            telefone_e164,
            cpf,
            email,
            endereco_rua,
            endereco_numero,
            endereco_bairro,
            endereco_complemento,
            endereco_cep,
            cidade,
            total_doado,
            qtd_doacoes,
            valor,
            periodicidade,
            ultima_doacao,
            tipo_contato,
            status_relacionamento,
            asaas_customer_id,
            tags,
            metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
          )
        `, [
          a.nome || null,
          tel || null,
          a.telefone_e164 || null,
          a.cpf_cnpj || null,
          a.email || null,
          a.endereco_rua || null,
          a.endereco_numero || null,
          a.endereco_bairro || null,
          a.endereco_complemento || null,
          a.endereco_cep || null,
          a.cidade || null,
          a.total_pago || 0,
          a.qtd_cobrancas_pagas || 0,
          a.valor_assinatura_ativa ? String(a.valor_assinatura_ativa) : null,
          a.periodicidade_assinatura || null,
          a.data_ultima_cobranca || null,
          'doador',
          'ativo',
          a.asaas_customer_id,
          ['asaas', 'doador_ativo'],
          JSON.stringify({ origem: 'asaas_import', asaas_customer_id: a.asaas_customer_id })
        ]);
        inseridosNovos++;
      }
    }
    console.log(`   Novos do Asaas inseridos: ${inseridosNovos} (unificados por telefone: ${atualizadosPorTelefone})\n`);

    // 3. Segmentar os Ex-Doadores Reais
    console.log('-> Segmentando e aplicando tags nos ex-doadores reais...');
    
    // 3.1. Quem já tem celular válido com 9 dígitos
    const celularQ = await client.query(`
      WITH ex AS (
        SELECT id, regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') as tel_digitos
        FROM public.contatos
        WHERE status_relacionamento != 'ativo' OR status_relacionamento IS NULL
      )
      UPDATE public.contatos c
      SET 
        tipo_contato = 'ex_doador',
        status_relacionamento = 'inativo',
        tags = (
          SELECT ARRAY(
            SELECT DISTINCT tag 
            FROM unnest(c.tags || ARRAY['ex_doador', 'pronto_whatsapp']) as tag
            WHERE tag NOT IN ('doador_ativo', 'fila_enriquecimento_cpf')
          )
        )
      FROM ex
      WHERE c.id = ex.id
        AND (
          (length(ex.tel_digitos) = 11 AND substring(ex.tel_digitos from 3 for 1) = '9')
          OR (length(ex.tel_digitos) = 13 AND substring(ex.tel_digitos from 5 for 1) = '9')
        );
    `);
    console.log(`   Ex-doadores com celular prontos para WhatsApp: ${celularQ.rowCount}`);

    // 3.2. Quem NÃO tem celular válido (fixo ou sem tel), MAS TEM CPF de 11 dígitos
    const enriquecerQ = await client.query(`
      WITH ex AS (
        SELECT id, 
               regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') as tel_digitos,
               regexp_replace(cpf, '\\D', '', 'g') as cpf_digitos
        FROM public.contatos
        WHERE (status_relacionamento != 'ativo' OR status_relacionamento IS NULL)
          AND NOT (
            (length(regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g')) = 11 AND substring(regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') from 3 for 1) = '9')
            OR (length(regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g')) = 13 AND substring(regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') from 5 for 1) = '9')
          )
      )
      UPDATE public.contatos c
      SET 
        tipo_contato = 'ex_doador',
        status_relacionamento = 'inativo',
        tags = (
          SELECT ARRAY(
            SELECT DISTINCT tag 
            FROM unnest(
              c.tags || 
              ARRAY['ex_doador', 'fila_enriquecimento_cpf'] || 
              CASE WHEN length(ex.tel_digitos) = 10 OR length(ex.tel_digitos) = 12 THEN ARRAY['telefone_fixo'] ELSE ARRAY[]::text[] END
            ) as tag
            WHERE tag NOT IN ('doador_ativo', 'pronto_whatsapp')
          )
        )
      FROM ex
      WHERE c.id = ex.id AND length(ex.cpf_digitos) = 11;
    `);
    console.log(`   Ex-doadores na fila de enriquecimento por CPF: ${enriquecerQ.rowCount}`);

    // 3.3. Restante com telefone fixo (sem CPF)
    const fixoSemCpfQ = await client.query(`
      WITH ex AS (
        SELECT id, 
               regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') as tel_digitos,
               regexp_replace(cpf, '\\D', '', 'g') as cpf_digitos
        FROM public.contatos
        WHERE (status_relacionamento != 'ativo' OR status_relacionamento IS NULL)
          AND NOT ('pronto_whatsapp' = ANY(tags))
          AND NOT ('fila_enriquecimento_cpf' = ANY(tags))
      )
      UPDATE public.contatos c
      SET 
        tipo_contato = 'ex_doador',
        status_relacionamento = 'inativo',
        tags = (
          SELECT ARRAY(
            SELECT DISTINCT tag 
            FROM unnest(c.tags || ARRAY['ex_doador', 'telefone_fixo']) as tag
            WHERE tag NOT IN ('doador_ativo', 'pronto_whatsapp', 'fila_enriquecimento_cpf')
          )
        )
      FROM ex
      WHERE c.id = ex.id 
        AND (length(ex.tel_digitos) = 10 OR length(ex.tel_digitos) = 12);
    `);
    console.log(`   Ex-doadores só com fixo (sem CPF): ${fixoSemCpfQ.rowCount}`);

    // Commit da transação
    await client.query('COMMIT');
    console.log('\n-> Transação confirmada (COMMIT)!');

    // 4. Balanço Final da Tabela public.contatos
    console.log('\n================================================================');
    console.log('             BALANÇO FINAL DA TABELA public.contatos            ');
    console.log('================================================================');

    const balancoQ = await client.query(`
      SELECT 
        count(*) as total_contatos,
        count(CASE WHEN 'doador_ativo' = ANY(tags) THEN 1 END) as doadores_ativos,
        count(CASE WHEN 'ex_doador' = ANY(tags) THEN 1 END) as ex_doadores_total,
        count(CASE WHEN 'pronto_whatsapp' = ANY(tags) THEN 1 END) as ex_doadores_pronto_whatsapp,
        count(CASE WHEN 'fila_enriquecimento_cpf' = ANY(tags) THEN 1 END) as ex_doadores_enriquecimento_cpf,
        count(CASE WHEN 'telefone_fixo' = ANY(tags) THEN 1 END) as contatos_telefone_fixo
      FROM public.contatos;
    `);

    const b = balancoQ.rows[0];
    console.log(`• Total geral de contatos na tabela:       ${b.total_contatos}`);
    console.log(`• Doadores Ativos (Asaas):                 ${b.doadores_ativos}`);
    console.log(`• Ex-doadores Total:                       ${b.ex_doadores_total}`);
    console.log(`  ├─ Prontos para WhatsApp:                ${b.ex_doadores_pronto_whatsapp}`);
    console.log(`  ├─ Fila de enriquecimento por CPF:       ${b.ex_doadores_enriquecimento_cpf}`);
    console.log(`  └─ Contatos marcados com Telefone Fixo:  ${b.contatos_telefone_fixo}`);
    console.log('================================================================\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErro na transação, feito ROLLBACK:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nFalha fatal:', err);
  process.exit(1);
});
