import pg from 'pg';
import fs from 'fs';

let envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2]?.trim().replace(/^['"]|['"]$/g, '');
  }
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const client = await pool.connect();

try {
  const orgId = '18ccd150-b5a6-4a76-b72c-dd8d1753228e';
  const channelSessionId = '9a413df2-93fc-494a-aa6d-21a9684966af'; // Omnique WhatsApp
  const pipelineId = 'b187e86d-56a2-443b-9967-cd21a6ed9813'; // Reativação e Relacionamento
  const stageId = '898682d8-017b-4b05-970f-e64915cd3923'; // Reativação enviada
  const targetTag = 'recadastramento_pendente';

  // Verifica se já existe uma campanha ativa para esta organização
  const existingRes = await client.query(`
    SELECT id, name, status, snapshot_total, teto_diario
    FROM public.campaigns
    WHERE organization_id = $1 AND name LIKE '%Reativação Esperança e Vida%'
  `, [orgId]);

  if (existingRes.rows.length > 0) {
    console.log("Campanha já existe no banco:");
    console.table(existingRes.rows);
  } else {
    console.log("Criando campanha inicial para Esperança e Vida...");

    const messageBody = `Olá, {{primeiro_nome}}. Aqui é da Associação Esperança e Vida. 💚

Você já fez parte da nossa história e estamos atualizando nosso cadastro para manter por perto somente quem deseja continuar acompanhando o trabalho da Associação.

Você gostaria de continuar recebendo nossas mensagens pelo WhatsApp?`;

    // 1. Busca os contatos com a tag
    const contactsRes = await client.query(`
      SELECT id, phone_number
      FROM public.contacts
      WHERE organization_id = $1 
        AND phone_number IS NOT NULL
        AND btrim(phone_number) <> ''
        AND $2 = ANY(tags)
      ORDER BY created_at ASC
    `, [orgId, targetTag]);

    console.log(`Total de contatos elegíveis encontrados: ${contactsRes.rows.length}`);

    await client.query("BEGIN");

    // 2. Insere a campanha
    const insertCamp = await client.query(`
      INSERT INTO public.campaigns (
        organization_id,
        name,
        description,
        status,
        channel_session_id,
        message_body,
        base_legal,
        lia_ref,
        audience_filter,
        intervalo_segundos,
        janela_inicio_hora,
        janela_fim_hora,
        teto_diario,
        pipeline_id,
        stage_id,
        snapshot_total,
        snapshot_eligible,
        started_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, 'running', $4, $5, 'legitimate_interest', 'LIA-REATIVACAO',
        $6, 1200, 9, 18, 25, $7, $8, $9, $9, now(), now(), now()
      )
      RETURNING id, name, status
    `, [
      orgId,
      'Reativação Esperança e Vida - 25/dia',
      'Campanha de recadastramento de ex-doadores e contatos válidos com ritmo de 25 disparos/dia em horário comercial.',
      channelSessionId,
      messageBody,
      JSON.stringify({ tag: targetTag }),
      pipelineId,
      stageId,
      contactsRes.rows.length
    ]);

    const campaignId = insertCamp.rows[0].id;
    console.log(`Campanha criada com ID: ${campaignId}`);

    // 3. Popula os destinatários em lotes
    const batchSize = 1000;
    for (let i = 0; i < contactsRes.rows.length; i += batchSize) {
      const chunk = contactsRes.rows.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];

      chunk.forEach((c, idx) => {
        const offset = idx * 5;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        values.push(orgId, campaignId, c.id, c.phone_number, 'pending');
      });

      await client.query(`
        INSERT INTO public.campaign_recipients (
          organization_id, campaign_id, contact_id, recipient_address, status
        ) VALUES ${placeholders.join(', ')}
      `, values);
    }

    await client.query("COMMIT");
    console.log(`Sucesso: ${contactsRes.rows.length} destinatários inseridos na fila da campanha!`);
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Erro ao criar campanha:", err);
} finally {
  client.release();
  await pool.end();
}
