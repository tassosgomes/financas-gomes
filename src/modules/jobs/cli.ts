import { config as loadDotenv } from "dotenv";

import { flushSentrySafely, initializeServerSentry } from "@/modules/observability/server";

import { runS11JobHeartbeat } from "./heartbeat";
import {
  JobDeterministicError,
  runJob,
  utcLogicalWindowForDate,
  type JobRunResult,
} from "./runtime";

// Local files provide defaults; an explicit shell/CI value must win.
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local" });

function usage(): void {
  console.log(`Uso: npx tsx src/modules/jobs/cli.ts <comando> [opções]

Comandos:
  heartbeat              executa o job operacional s11.job.heartbeat
  help                   mostra esta ajuda

Opções:
  --inject-failure       falha determinística (bloqueada em NODE_ENV=production)

Exemplo:
  npx tsx src/modules/jobs/cli.ts heartbeat`);
}

async function runHeartbeatCommand(injectFailure: boolean): Promise<JobRunResult> {
  initializeServerSentry();

  if (injectFailure) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("--inject-failure is not allowed when NODE_ENV=production.");
    }

    return runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: utcLogicalWindowForDate(),
      technicalErrorCode: "JOB_HEARTBEAT_FAILED",
      effect: async () => {
        throw new JobDeterministicError("JOB_HEARTBEAT_INJECTED_FAILURE");
      },
    });
  }

  return runS11JobHeartbeat();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const injectFailure = args.includes("--inject-failure");

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command !== "heartbeat") {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runHeartbeatCommand(injectFailure);
    await flushSentrySafely();

    if (result.status === "FAILED") {
      process.exitCode = 1;
    }
  } catch (error) {
    await flushSentrySafely();
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`Job CLI falhou: ${message}`);
    process.exitCode = 1;
  }
}

main();
