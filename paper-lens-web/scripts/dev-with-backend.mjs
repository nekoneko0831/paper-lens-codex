import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const backendDir = resolve(webDir, "..", "paper-lens-backend");
const frontendPort = process.env.PORT ?? "3001";
const backendPort = process.env.PAPER_LENS_BACKEND_PORT ?? "8766";
const backendBase = process.env.PAPER_LENS_BACKEND ?? `http://localhost:${backendPort}`;
const backendHealth = `${backendBase}/api/papers`;
const nextBin = resolve(webDir, "node_modules", ".bin", "next");

let backendProcess = null;
let frontendProcess = null;
let shuttingDown = false;

async function backendIsAlive() {
  try {
    const res = await fetch(backendHealth, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function spawnBackend() {
  const child = spawn("python3", ["server.py"], {
    cwd: backendDir,
    env: { ...process.env, PORT: backendPort },
    stdio: "inherit",
  });

  backendProcess = child;
  child.on("exit", (code, signal) => {
    if (backendProcess === child) backendProcess = null;
    if (shuttingDown) return;
    console.error(
      `[paper-lens] backend exited (${signal ?? code ?? "unknown"}); restarting in 2s...`,
    );
    setTimeout(() => {
      if (!shuttingDown) spawnBackend();
    }, 2000);
  });
}

function spawnFrontend() {
  frontendProcess = spawn(nextBin, ["dev", "--port", frontendPort], {
    cwd: webDir,
    env: {
      ...process.env,
      PAPER_LENS_BACKEND: backendBase,
      NEXT_PUBLIC_BACKEND_URL: backendBase,
    },
    stdio: "inherit",
  });

  frontendProcess.on("exit", (code, signal) => {
    shutdown(signal ?? code ?? 0);
  });
}

function shutdown(reason = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (frontendProcess && !frontendProcess.killed) frontendProcess.kill();
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  if (typeof reason === "number") process.exit(reason);
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(sig));
}

console.log(`[paper-lens] backend: ${backendBase}`);
if (await backendIsAlive()) {
  console.log("[paper-lens] backend already running; using existing process.");
} else {
  console.log("[paper-lens] starting backend behind the frontend...");
  spawnBackend();
}

console.log(`[paper-lens] frontend: http://localhost:${frontendPort}`);
spawnFrontend();
