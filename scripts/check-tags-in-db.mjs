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
      SELECT count(*) as total
      FROM public.contacts
      WHERE organization_id = $1 AND 'recadastramento_pendente' = ANY(tags)
    `, [orgId]);
    console.log('Total com tag recadastramento_pendente em public.contacts:', res.rows[0].total);

    const checkTags = await client.query(`
      SELECT unnest(tags) as t, count(*) as count
      FROM public.contacts
      WHERE organization_id = $1
      GROUP BY t
      ORDER BY count DESC
    `, [orgId]);
    console.log('\nTodas as tags em public.contacts:');
    console.table(checkTags.rows);

    // Também checar a query de contact-tags (/api/v1/contact-tags)
    const recentRes = await client.query(`
      SELECT tags
      FROM public.contacts
      WHERE organization_id = $1 AND tags != '{}'
      ORDER BY updated_at DESC
      LIMIT 1000
    `, [orgId]);
    const recentTags = new Set();
    for (const r of recentRes.rows) {
      if (Array.isArray(r.tags)) {
        for (const t of r.tags) recentTags.add(t);
      }
    }
    console.log('\nTags retornadas pelo endpoint /api/v1/contact-tags (top 1000 updated_at):', Array.from(recentTags));
    console.log('recadastramento_pendente está presente nas top 1000 updated_at?', recentTags.has('recadastramento_pendente'));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
