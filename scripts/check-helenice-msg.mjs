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
      SELECT m.body, m.direction, m.created_at, c.display_name
      FROM public.messages m
      JOIN public.contacts c ON c.id = m.contact_id
      WHERE m.organization_id = $1 AND c.display_name ILIKE '%Helenice%'
      ORDER BY m.created_at ASC
    `, [orgId]);
    console.log('Conversa com Helenice:');
    for (const m of msgs.rows) {
      console.log(`[${m.created_at.toISOString()}] ${m.direction}:`);
      console.log(`${m.body}\n---`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
