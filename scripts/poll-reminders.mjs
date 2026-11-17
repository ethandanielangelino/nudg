const baseUrl = (process.env.NUDG_DEV_URL || `http://localhost:${process.env.PORT || "3000"}`).replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  process.stderr.write("Reminder polling is off: CRON_SECRET is missing from .env.local.\n");
  process.exit(1);
}

let stopped = false;
let polling = false;

async function poll() {
  if (stopped || polling) return;
  polling = true;
  try {
    const response = await fetch(`${baseUrl}/api/cron/reminders`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      process.stderr.write(`Reminder poll failed (${response.status}): ${result.error || "unknown error"}\n`);
    } else if (result.processed > 0) {
      process.stdout.write(`Reminder poll: ${result.sent} sent, ${result.retried} retrying, ${result.failed} failed.\n`);
    }
  } catch (error) {
    process.stderr.write(`Reminder poll could not reach ${baseUrl}: ${error instanceof Error ? error.message : "connection failed"}\n`);
  } finally {
    polling = false;
  }
}

process.stdout.write(`Reminder polling is on for ${baseUrl} (checks every 30 seconds). Press Ctrl+C to stop.\n`);
void poll();
const timer = setInterval(() => void poll(), 30_000);
function stop() { stopped = true; clearInterval(timer); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
