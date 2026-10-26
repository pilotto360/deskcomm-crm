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
    const msgs = await client.query(`
      SELECT m.id, m.body, m.direction, m.status, m.created_at, c.display_name, c.phone_number
      FROM public.messages m
      LEFT JOIN public.contacts c ON c.id = m.contact_id
      WHERE m.organization_id = $1
      ORDER BY m.created_at DESC
      LIMIT 6
    `, [orgId]);
    console.log('Últimas 6 mensagens:');
    for (const m of msgs.rows) {
      console.log(`[${m.created_at.toISOString()}] ${m.direction} (status: ${m.status}) para/de ${m.display_name} (${m.phone_number}):`);
      console.log(`"${m.body?.slice(0, 150)}..."\n`);
    }

    const rule = await client.query(`
      SELECT conditions, actions FROM public.automation_rules WHERE id = '52771904-d065-429e-aaaa-748d66dc6f8c'
    `);
    console.log('Detalhes da regra Move_funil_reativacao_respondeu:');
    console.log(JSON.stringify(rule.rows[0], null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
