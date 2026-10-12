import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const db = createAdminClient();

  // 1. Pointers
  const { data: pointers } = await db
    .from("followup_flow_pointers")
    .select("id, name, status, trigger_config, active_version_id");
  console.log("POINTERS:", JSON.stringify(pointers, null, 2));

  // 2. Agents
  const { data: agents } = await db
    .from("ai_agents")
    .select("id, name, published_version_id");
  console.log("AGENTS:", JSON.stringify(agents, null, 2));

  // 3. Agent versions followup config
  const { data: versions } = await db
    .from("ai_agent_versions")
    .select("id, agent_id, status, followup")
    .order("created_at", { ascending: false })
    .limit(3);
  console.log("AGENT_VERSIONS:", JSON.stringify(versions, null, 2));

  // 4. Enrollments
  const { data: enrolls } = await db
    .from("followup_enrollments")
    .select("id, pointer_id, contact_id, status, next_eval_at, last_error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("ENROLLMENTS:", JSON.stringify(enrolls, null, 2));

  // 5. Recent events in event_log
  const { data: events } = await db
    .from("event_log")
    .select("id, event_type, created_at, consumed_by")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("EVENTS:", JSON.stringify(events, null, 2));
}

main().catch(console.error);
