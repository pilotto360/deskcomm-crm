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
    // Checar se há automações configuradas na tabela automation_rules
    const autoRules = await client.query(`
      SELECT * FROM public.automation_rules WHERE organization_id = $1
    `, [orgId]);
    console.log('Regras de automação (automation_rules):', autoRules.rows);

    // Checar se há campanhas em whatsapp_campaigns ou campaigns ou prospecting_campaigns
    const waCamps = await client.query(`
      SELECT * FROM public.whatsapp_campaigns WHERE organization_id = $1
    `, [orgId]);
    console.log('\nCampanhas em whatsapp_campaigns:', waCamps.rows);

    const prospCamps = await client.query(`
      SELECT * FROM public.prospecting_campaigns WHERE organization_id = $1
    `, [orgId]);
    console.log('\nCampanhas em prospecting_campaigns:', prospCamps.rows);

    // Checar templates de mensagem
    const templates = await client.query(`
      SELECT id, name, content, category FROM public.message_templates WHERE organization_id = $1
    `, [orgId]);
    console.log('\nTemplates de mensagem:', templates.rows);

    // Checar mensagens enviadas recentemente para Judite ou Tiago
    const msgs = await client.query(`
      SELECT m.id, m.content, m.sender_type, m.direction, m.created_at, c.display_name
      FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
      JOIN public.contacts c ON c.id = cv.contact_id
      WHERE cv.organization_id = $1
      ORDER BY m.created_at DESC
      LIMIT 10
    `, [orgId]);
    console.log('\nÚltimas mensagens trocadas:');
    console.table(msgs.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
