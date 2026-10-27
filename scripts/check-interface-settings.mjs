import pg from 'pg';
import fs from 'fs';

let envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2]?.trim().replace(/^['"]|['"]$/g, '');
  }
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const org = await client.query(`
  SELECT id, display_name, interface_settings
  FROM public.organizations
  WHERE id = '18ccd150-b5a6-4a76-b72c-dd8d1753228e'
`);
console.log('Org interface_settings:', org.rows);

const memberships = await client.query(`
  SELECT id, organization_id, user_id, role, interface_settings
  FROM public.organization_memberships
  WHERE organization_id = '18ccd150-b5a6-4a76-b72c-dd8d1753228e'
`);
console.log('Memberships interface_settings:', memberships.rows);

await client.end();
