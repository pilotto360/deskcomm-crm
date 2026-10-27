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

const cols = await client.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'campaigns' AND table_schema = 'public'
  ORDER BY ordinal_position;
`);

console.log("Columns of public.campaigns:");
console.table(cols.rows);

const cols2 = await client.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'campaign_recipients' AND table_schema = 'public'
  ORDER BY ordinal_position;
`);

console.log("Columns of public.campaign_recipients:");
console.table(cols2.rows);

const policies = await client.query(`
  SELECT tablename, policyname, permissive, roles, cmd, qual
  FROM pg_policies
  WHERE tablename IN ('campaigns', 'campaign_recipients')
`);
console.log("RLS policies:");
console.table(policies.rows);

await client.end();
