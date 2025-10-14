import pg from "pg";
import fetch from "node-fetch";

const DATABASE_URL = process.env.DATABASE_URL;
const KB_WORKER_URL = process.env.KB_WORKER_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;

if (!DATABASE_URL || !KB_WORKER_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

const postJob = async (job_id) => {
  const res = await fetch(KB_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ job_id })
  });
  if (!res.ok) {
    console.error("Worker call failed", res.status, await res.text());
  }
};

(async () => {
  await client.connect();
  await client.query("LISTEN kb_embedding_job_enqueued");
  console.log("Listening on kb_embedding_job_enqueued");

  client.on("notification", (msg) => {
    const job_id = msg?.payload;
    if (job_id) postJob(job_id).catch(e => console.error("postJob error", e));
  });

  // keepalive
  setInterval(async () => {
    try { await client.query("SELECT 1"); } catch (_) {}
  }, 60000);
})().catch((e) => {
  console.error("Listener failed to start", e);
  process.exit(1);
});