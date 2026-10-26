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
    // 1. Contatos que têm pronto_whatsapp
    const prontoRes = await client.query(`
      SELECT count(*) as total
      FROM public.contacts
      WHERE organization_id = $1
        AND 'pronto_whatsapp' = ANY(tags)
    `, [orgId]);
    console.log('Contatos com tag pronto_whatsapp:', prontoRes.rows[0].total);

    // 2. Contatos com celular BR válido (+55 + DDD + 9XXXXXXXX) no total
    const validCelRes = await client.query(`
      SELECT 
        count(*) as total_com_celular_valido,
        count(CASE WHEN 'pronto_whatsapp' = ANY(tags) THEN 1 END) as ja_tem_pronto_whatsapp,
        count(CASE WHEN NOT ('pronto_whatsapp' = ANY(tags)) THEN 1 END) as sem_tag_pronto_whatsapp
      FROM public.contacts
      WHERE organization_id = $1
        AND phone_number IS NOT NULL
        AND phone_number ~ '^\\+?55[1-9][0-9]9[0-9]{8}$'
    `, [orgId]);
    console.log('\nContatos com celular válido na base:');
    console.table(validCelRes.rows);

    // 3. Checar os sem tag pronto_whatsapp que têm celular válido: que tags eles têm?
    const semTagSample = await client.query(`
      SELECT id, display_name, phone_number, tags
      FROM public.contacts
      WHERE organization_id = $1
        AND phone_number IS NOT NULL
        AND phone_number ~ '^\\+?55[1-9][0-9]9[0-9]{8}$'
        AND NOT ('pronto_whatsapp' = ANY(tags))
      LIMIT 5
    `, [orgId]);
    console.log('\nAmostra que tem celular válido mas não tinha pronto_whatsapp:');
    console.log(semTagSample.rows);

    // 4. Checar se já existe tag de recadastramento
    const recadRes = await client.query(`
      SELECT unnest(tags) as t, count(*) 
      FROM public.contacts 
      WHERE organization_id = $1 AND tags::text ILIKE '%recadastr%'
      GROUP BY t
    `, [orgId]);
    console.log('\nTags existentes de recadastramento:', recadRes.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
