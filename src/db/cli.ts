import { config as loadDotenv } from "dotenv";

import {
  applyMigrations,
  getMigrationStatus,
  MIGRATIONS_FOLDER,
} from "./migrate";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

function usage(): void {
  console.log(`Uso: tsx src/db/cli.ts <comando>

Comandos:
  status       mostra migrations aplicadas, pendentes e divergentes
  check        verifica status e retorna erro se houver pendências
  migrate      aplica migrations forward-only
  deploy       aplica migrations para um alvo controlado
  help         mostra esta ajuda

Diretório de migrations: ${MIGRATIONS_FOLDER}`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "migrate" || command === "deploy") {
    console.log(
      command === "deploy"
        ? "Aplicando migrations controladas..."
        : "Aplicando migrations locais...",
    );
    await applyMigrations();
    console.log("Migrations aplicadas com sucesso.");
    return;
  }

  if (command === "status" || command === "check") {
    const status = await getMigrationStatus();
    console.log(
      `Migrations: ${status.applied} aplicadas, ${status.pending} pendentes, ${status.drifted} divergentes.`,
    );

    if (status.pendingTags.length > 0) {
      console.log(`Pendentes: ${status.pendingTags.join(", ")}`);
    }

    if (command === "check" && (status.pending > 0 || status.drifted > 0)) {
      process.exitCode = 1;
    }

    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`Operação de banco falhou: ${message}`);
  process.exitCode = 1;
});
