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
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'message_templates'`);
    console.log('Colunas de message_templates:', cols.rows.map(r => r.column_name).join(', '));

    const tpl = await client.query(`SELECT * FROM public.message_templates LIMIT 5`);
    console.log('Templates:', tpl.rows);

    const colsAgent = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_agents'`);
    console.log('Colunas de ai_agents:', colsAgent.rows.map(r => r.column_name).join(', '));

    const agents = await client.query(`SELECT id, display_name, prompt FROM public.ai_agents WHERE organization_id = $1`, [orgId]);
    console.log('Agents:', agents.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
