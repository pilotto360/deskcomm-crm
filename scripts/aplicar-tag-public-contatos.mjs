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

  try {
    console.log('=== ATUALIZANDO public.contatos COM TAG recadastramento_pendente ===\n');

    await client.query('BEGIN');

    // 1. Garantir 'pronto_whatsapp' em celulares válidos de public.contatos
    const updatePronto = await client.query(`
      WITH cel AS (
        SELECT id, regexp_replace(COALESCE(telefone_e164, telefone, ''), '\\D', '', 'g') as tel_digitos
        FROM public.contatos
      )
      UPDATE public.contatos c
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT tag 
          FROM unnest(c.tags || ARRAY['pronto_whatsapp']) as tag
        )
      )
      FROM cel
      WHERE c.id = cel.id
        AND (
          (length(cel.tel_digitos) = 11 AND substring(cel.tel_digitos from 3 for 1) = '9')
          OR (length(cel.tel_digitos) = 13 AND substring(cel.tel_digitos from 5 for 1) = '9')
        )
        AND NOT ('pronto_whatsapp' = ANY(c.tags));
    `);
    console.log(`-> Contatos que ganharam 'pronto_whatsapp' em public.contatos: ${updatePronto.rowCount}`);

    // 2. Aplicar 'recadastramento_pendente' em todos os ex-doadores que têm 'pronto_whatsapp'
    const updateRecad = await client.query(`
      UPDATE public.contatos c
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT tag 
          FROM unnest(c.tags || ARRAY['recadastramento_pendente']) as tag
        )
      )
      WHERE 'pronto_whatsapp' = ANY(c.tags)
        AND ('ex_doador' = ANY(c.tags) OR tipo_contato = 'ex_doador')
        AND NOT ('recadastramento_pendente' = ANY(c.tags));
    `);
    console.log(`-> Contatos que ganharam 'recadastramento_pendente' em public.contatos: ${updateRecad.rowCount}`);

    await client.query('COMMIT');

    // Conferência
    const stats = await client.query(`
      SELECT 
        count(*) as total,
        count(CASE WHEN 'pronto_whatsapp' = ANY(tags) THEN 1 END) as pronto_whatsapp,
        count(CASE WHEN 'recadastramento_pendente' = ANY(tags) THEN 1 END) as recadastramento_pendente,
        count(CASE WHEN 'ex_doador' = ANY(tags) THEN 1 END) as ex_doador
      FROM public.contatos
    `);
    console.log('\nEstatísticas atuais em public.contatos:');
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
