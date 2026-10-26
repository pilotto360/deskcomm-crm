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
    const leadsByPipe = await client.query(`
      SELECT p.name as pipeline_name, s.name as stage_name, count(l.id) as total_leads
      FROM public.crm_pipelines p
      JOIN public.crm_stages s ON s.pipeline_id = p.id
      LEFT JOIN public.crm_leads l ON l.stage_id = s.id
      WHERE p.organization_id = $1
      GROUP BY p.name, s.name, s.position
      ORDER BY p.name, s.position
    `, [orgId]);
    console.table(leadsByPipe.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
