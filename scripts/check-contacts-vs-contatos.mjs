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

  try {
    const resContacts = await client.query(`
      SELECT count(*) as total
      FROM public.contacts
      WHERE 'recadastramento_pendente' = ANY(tags)
    `);
    console.log('Em public.contacts: com recadastramento_pendente =', resContacts.rows[0].total);

    const resContatos = await client.query(`
      SELECT count(*) as total
      FROM public.contatos
      WHERE 'recadastramento_pendente' = ANY(tags)
    `);
    console.log('Em public.contatos: com recadastramento_pendente =', resContatos.rows[0].total);

    const tagsContatos = await client.query(`
      SELECT unnest(tags) as t, count(*) 
      FROM public.contatos
      GROUP BY t
      ORDER BY count DESC
    `);
    console.log('\nTags em public.contatos:');
    console.table(tagsContatos.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
