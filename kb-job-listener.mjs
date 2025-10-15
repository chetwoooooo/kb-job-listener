import pg from "pg";
import fetch from "node-fetch";
import dns from "dns";
import { promisify } from "util";

const lookup4 = promisify(dns.lookup);

const DATABASE_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const KB_WORKER_URL = process.env.KB_WORKER_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

console.log("[listener] Booting…");
console.log("[listener] Env present:", {
  DATABASE_URL: !!DATABASE_URL,
  KB_WORKER_URL: !!KB_WORKER_URL,
  SERVICE_ROLE_KEY: !!SERVICE_ROLE_KEY,
});

if (!DATABASE_URL || !KB_WORKER_URL || !SERVICE_ROLE_KEY) {
  console.error("[listener] Missing env vars. Exiting.");
  process.exit(1);
}

// Parse and modify connection string to use IPv4
async function getIPv4ConnectionString(connStr) {
  const url = new URL(connStr);
  
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    throw new Error("Refusing to connect to localhost in production.");
  }
  
  // Resolve hostname to IPv4 only
  console.log("[listener] Resolving", url.hostname, "to IPv4...");
  try {
    const result = await lookup4(url.hostname, { family: 4 });
    console.log("[listener] Resolved to IPv4:", result.address);
    
    // Replace hostname with IPv4 address
    url.hostname = result.address;
    return url.toString();
  } catch (e) {
    console.error("[listener] DNS lookup failed:", e.message);
    throw e;
  }
}

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
  console.log("[listener] Worker HTTP status:", res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || "<no body>"}`);
  return text;
}

async function postJob(job_id) {
  try {
    console.log("[listener] Posting job_id:", job_id);
    const out = await postJson(KB_WORKER_URL, { job_id });
    console.log("[listener] Worker response:", out?.slice(0, 200) || "<ok>");
  } catch (e) {
    console.error("[listener] Worker call failed:", e.message);
  }
}

async function keepAlive(client) {
  try {
    const r = await client.query("SELECT NOW()");
    console.log("[listener] keepalive ok @", r.rows?.[0]?.now);
  } catch (e) {
    console.error("[listener] keepalive error:", e.message);
  }
}

async function main() {
  // Get IPv4 connection string
  const ipv4ConnStr = await getIPv4ConnectionString(DATABASE_URL);
  
  const client = new pg.Client({
    connectionString: ipv4ConnStr,
    application_name: "kb-embedding-listener",
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
  });
  
  console.log("[listener] Connecting to Postgres…");
  await client.connect();
  console.log("[listener] Connected.");
  
  try {
    const info = await client.query("SELECT current_database() db, current_user usr");
    console.log("[listener] DB info:", info.rows[0]);
  } catch (e) {
    console.error("[listener] Info query failed:", e.message);
  }
  
  console.log("[listener] LISTEN kb_embedding_job_enqueued");
  await client.query("LISTEN kb_embedding_job_enqueued");
  
  client.on("notification", (msg) => {
    console.log("[listener] Notification:", msg?.channel, msg?.payload);
    const job_id = msg?.payload;
    if (job_id) postJob(job_id);
  });
  
  client.on("error", (err) => {
    console.error("[listener] PG client error:", err.message);
  });
  
  setInterval(() => keepAlive(client), 60_000);
  
  console.log("[listener] Listening for notifications...");
}

main().catch((e) => {
  console.error("[listener] Failed to start:", e);
  process.exit(1);
});



