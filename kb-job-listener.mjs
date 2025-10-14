// listener.js
import pg from "pg";
import fetch from "node-fetch";

// Prefer Supabase-provided envs; fall back to your custom names if set
const DATABASE_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL;

const KB_WORKER_URL = process.env.KB_WORKER_URL; // e.g. https://<project>.functions.supabase.co/kb-embeddings-worker
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL (SUPABASE_DB_URL or DATABASE_URL)");
  process.exit(1);
}
if (!KB_WORKER_URL) {
  console.error("Missing KB_WORKER_URL (Edge Function URL)");
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error("Missing SERVICE_ROLE_KEY (SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY)");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  // optional tuning
  statement_timeout: 0,
  query_timeout: 0,
  application_name: "kb-embedding-listener",
});

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text || "<no body>"}`);
  }
  return text;
}

async function postJob(job_id, attempt = 1) {
  try {
    console.log(`[listener] Posting job_id=${job_id} attempt=${attempt}`);
    const out = await postJson(KB_WORKER_URL, { job_id });
    console.log(`[listener] Worker response (job ${job_id}): ${out?.slice(0, 200) || "<ok>"}`);
  } catch (e) {
    console.error(`[listener] Worker call failed for job ${job_id}:`, e.message);
    if (attempt < 3) {
      const backoffMs = attempt * 1000;
      await new Promise(r => setTimeout(r, backoffMs));
      return postJob(job_id, attempt + 1);
    }
  }
}

async function keepAlive() {
  try {
    await client.query("SELECT 1");
  } catch (e) {
    console.error("[listener] keepalive error:", e.message);
  }
}

// Optional periodic batch kick if your worker supports { process_all: true }.
// Comment out if unsupported.
async function processAll() {
  try {
    console.log("[listener] process_all tick");
    const out = await postJson(KB_WORKER_URL, { process_all: true });
    console.log("[listener] process_all response:", out?.slice(0, 200) || "<ok>");
  } catch (e) {
    console.error("[listener] process_all failed:", e.message);
  }
}

async function main() {
  console.log("[listener] Starting…");
  await client.connect();
  await client.query("LISTEN kb_embedding_job_enqueued");
  console.log("[listener] LISTEN on kb_embedding_job_enqueued");

  client.on("notification", (msg) => {
    // Expect payload to be the job_id as text
    const job_id = msg?.payload;
    if (!job_id) {
      console.warn("[listener] notification without payload");
      return;
    }
    void postJob(job_id);
  });

  client.on("error", (err) => {
    console.error("[listener] PG client error:", err.message);
  });

  // Keep the connection healthy
  setInterval(keepAlive, 60_000);

  // Optional safety net to nudge processing
  // Adjust interval as needed, or remove if not desired
  setInterval(processAll, 300_000);
}

main().catch((e) => {
  console.error("[listener] Failed to start:", e);
  process.exit(1);
});
