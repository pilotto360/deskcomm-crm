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
    const orgCounts = await client.query(`
      SELECT organization_id, count(*) as total, 
             count(phone_number) as com_telefone,
             count(CASE WHEN tags IS NOT NULL AND array_length(tags, 1) > 0 THEN 1 END) as com_tags
      FROM public.contacts
      GROUP BY organization_id
    `);
    console.log('Contatos por organização em public.contacts:');
    console.table(orgCounts.rows);

    const tagsRes = await client.query(`
      SELECT unnest(tags) as tag, count(*) as qtd
      FROM public.contacts
      WHERE organization_id = '18ccd150-b5a6-4a76-b72c-dd8d1753228e'
      GROUP BY tag
      ORDER BY qtd DESC
      LIMIT 20
    `);
    console.log('\nTop 20 tags em public.contacts (Esperança e Vida):');
    console.table(tagsRes.rows);

    // Amostra de telefones
    const phonesSample = await client.query(`
      SELECT id, display_name, phone_number, tags
      FROM public.contacts
      WHERE organization_id = '18ccd150-b5a6-4a76-b72c-dd8d1753228e'
      LIMIT 10
    `);
    console.log('\nAmostra contatos:');
    console.log(phonesSample.rows);

    // Checar pipelines / funis
    const pipes = await client.query(`
      SELECT id, name, organization_id FROM public.pipelines WHERE organization_id = '18ccd150-b5a6-4a76-b72c-dd8d1753228e'
    `);
    console.log('\nPipelines da Esperança e Vida:');
    console.table(pipes.rows);

    if (pipes.rows.length > 0) {
      const stages = await client.query(`
        SELECT id, name, pipeline_id, display_order 
        FROM public.pipeline_stages 
        WHERE pipeline_id = $1 
        ORDER BY display_order
      `, [pipes.rows[0].id]);
      console.log(`\nEtapas do Pipeline "${pipes.rows[0].name}":`);
      console.table(stages.rows);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
