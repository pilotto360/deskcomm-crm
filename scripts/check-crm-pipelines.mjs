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
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'crm_stages'
    `);
    console.log('Colunas de crm_stages:', cols.rows.map(r => r.column_name).join(', '));

    const pipes = await client.query(`
      SELECT p.id as pipeline_id, p.name as pipeline_name, s.id as stage_id, s.name as stage_name
      FROM public.crm_pipelines p
      JOIN public.crm_stages s ON s.pipeline_id = p.id
      WHERE p.organization_id = $1
    `, [orgId]);
    console.table(pipes.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
