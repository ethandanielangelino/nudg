import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const next = spawn(process.execPath, [nextCli, "dev"], {
  cwd: projectRoot,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

let baseUrl = null;
let pollTimer = null;
let polling = false;
let stopped = false;

async function pollReminders() {
  if (!baseUrl || polling || stopped) return;
  polling = true;
  try {
    const response = await fetch(`${baseUrl}/api/cron/reminders`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      process.stderr.write(`Local reminder poll failed (${response.status}): ${result.error || "unknown error"}\n`);
    } else if (result.processed > 0) {
      process.stdout.write(`Local reminder poll: ${result.sent} sent, ${result.retried} retrying, ${result.failed} failed.\n`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "connection failed";
    process.stderr.write(`Local reminder poll could not reach Nudg: ${detail}\n`);
  } finally {
    polling = false;
  }
}

function forwardOutput(stream, destination) {
  stream.on("data", (chunk) => {
    destination.write(chunk);
    if (!baseUrl) {
      const match = chunk.toString().match(/https?:\/\/localhost:(\d+)/);
      if (match) {
        baseUrl = `http://localhost:${match[1]}`;
        if (process.env.CRON_SECRET && process.env.SUPABASE_SECRET_KEY) {
          process.stdout.write("Local reminder polling is on (checks every 30 seconds).\n");
          setTimeout(() => { void pollReminders(); }, 5_000);
          pollTimer = setInterval(() => { void pollReminders(); }, 30_000);
        } else {
          process.stderr.write("Local reminder polling is off: set CRON_SECRET and SUPABASE_SECRET_KEY in .env.local.\n");
        }
      }
    }
  });
}

forwardOutput(next.stdout, process.stdout);
forwardOutput(next.stderr, process.stderr);

function stop() {
  if (stopped) return;
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
  next.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
  process.exitCode = code ?? 0;
});
