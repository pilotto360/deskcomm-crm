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
      SELECT m.id, m.sent_via, m.sent_by_user_id, m.status, m.created_at, m.body
      FROM public.messages m
      JOIN public.contacts c ON c.id = m.contact_id
      WHERE m.organization_id = $1 AND c.display_name ILIKE '%Helenice%' AND m.direction = 'outbound'
      ORDER BY m.created_at ASC
      LIMIT 1
    `, [orgId]);
    console.log('Mensagem de envio para Helenice:');
    console.log(res.rows[0]);

    // Checar todos os 13 leads de "Reativação enviada"
    const enviadas = await client.query(`
      SELECT l.id, l.title, c.display_name, c.phone_number, l.created_at
      FROM public.crm_leads l
      JOIN public.contacts c ON c.id = l.contact_id
      WHERE l.stage_id = '898682d8-017b-4b05-970f-e64915cd3923'
      ORDER BY l.created_at DESC
    `);
    console.log('\nOs 13 leads com reativação enviada:');
    console.table(enviadas.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
