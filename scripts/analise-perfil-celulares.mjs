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
    const res = await client.query(`
      SELECT 
        count(*) as total,
        count(CASE WHEN 'ex_doador' = ANY(tags) THEN 1 END) as ex_doadores,
        count(CASE WHEN 'doador_ativo' = ANY(tags) THEN 1 END) as doadores_ativos,
        count(CASE WHEN 'amigo' = ANY(tags) THEN 1 END) as amigos,
        count(CASE WHEN 'base_legada' = ANY(tags) THEN 1 END) as base_legada
      FROM public.contacts
      WHERE organization_id = $1
        AND phone_number IS NOT NULL
        AND phone_number ~ '^\\+?55[1-9][0-9]9[0-9]{8}$'
    `, [orgId]);

    console.log('Distribuição dos 3.046 celulares válidos:');
    console.table(res.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
