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
    const leads = await client.query(`
      SELECT l.id, l.title, l.contact_id, l.stage_id, s.name as stage_name, l.created_at, c.display_name, c.phone_number, c.tags
      FROM public.crm_leads l
      JOIN public.crm_stages s ON s.id = l.stage_id
      LEFT JOIN public.contacts c ON c.id = l.contact_id
      WHERE l.organization_id = $1
      ORDER BY l.created_at DESC
      LIMIT 10
    `, [orgId]);
    console.table(leads.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
