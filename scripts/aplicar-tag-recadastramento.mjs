import pg from 'pg';
import fs from 'fs';

let envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2]?.trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();
  const orgId = '18ccd150-b5a6-4a76-b72c-dd8d1753228e';

  try {
    console.log('=== ATUALIZANDO CONTATOS COM CELULAR VÁLIDO E TAGS DE RECADASTRAMENTO ===\n');

    await client.query('BEGIN');

    // 1. Garantir 'pronto_whatsapp' em todos os 3.046 celulares válidos
    const updatePronto = await client.query(`
      UPDATE public.contacts
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT tag 
          FROM unnest(tags || ARRAY['pronto_whatsapp']) as tag
        )
      )
      WHERE organization_id = $1
        AND phone_number IS NOT NULL
        AND phone_number ~ '^\\+?55[1-9][0-9]9[0-9]{8}$'
        AND NOT ('pronto_whatsapp' = ANY(tags));
    `, [orgId]);
    console.log(`-> Contatos que ganharam 'pronto_whatsapp': ${updatePronto.rowCount}`);

    // 2. Aplicar 'recadastramento_pendente' nos ex-doadores que têm celular válido e ainda não receberam mensagem
    // (excluindo quem já recebeu mensagem ou já está em Reativação enviada / Respondeu)
    const updateRecadastramento = await client.query(`
      WITH ja_enviados AS (
        SELECT DISTINCT contact_id 
        FROM public.crm_leads 
        WHERE organization_id = $1 
          AND stage_id IN (
            '898682d8-017b-4b05-970f-e64915cd3923', -- Reativação enviada
            'eb2f0eb5-8b59-48f8-8f7b-459fc2cc3b5c', -- Respondeu
            '52ec3c2b-b385-4b4d-8127-943750ce9c8b', -- Requalificando
            'a0347074-d3d8-4ca8-ad60-38cfa2e9e13f'  -- Reativado
          )
          AND contact_id IS NOT NULL
      )
      UPDATE public.contacts c
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT tag 
          FROM unnest(c.tags || ARRAY['recadastramento_pendente']) as tag
          WHERE tag != 'recadastramento_enviado'
        )
      )
      WHERE c.organization_id = $1
        AND 'pronto_whatsapp' = ANY(c.tags)
        AND 'ex_doador' = ANY(c.tags)
        AND c.id NOT IN (SELECT contact_id FROM ja_enviados);
    `, [orgId]);
    console.log(`-> Ex-doadores com celular aptos para recadastramento marcados com 'recadastramento_pendente': ${updateRecadastramento.rowCount}`);

    await client.query('COMMIT');

    // Estatísticas finais
    const stats = await client.query(`
      SELECT 
        count(CASE WHEN 'pronto_whatsapp' = ANY(tags) THEN 1 END) as pronto_whatsapp,
        count(CASE WHEN 'recadastramento_pendente' = ANY(tags) THEN 1 END) as recadastramento_pendente,
        count(CASE WHEN 'ex_doador' = ANY(tags) THEN 1 END) as ex_doador,
        count(CASE WHEN 'doador_ativo' = ANY(tags) THEN 1 END) as doador_ativo
      FROM public.contacts
      WHERE organization_id = $1
    `, [orgId]);
    console.log('\nEstatísticas atuais de tags:');
    console.table(stats.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na execução:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
