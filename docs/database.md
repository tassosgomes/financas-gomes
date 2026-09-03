# PostgreSQL e migrations

O desenvolvimento usa PostgreSQL 16 em Docker. SQLite não faz parte da
aplicação. O mesmo `DATABASE_URL` pode apontar para o banco local, para um
database efêmero de Preview ou para o Neon em produção.

## Desenvolvimento local

Copie o arquivo de ambiente e suba apenas o banco quando estiver trabalhando
no host:

```bash
cp .env.example .env.local
docker compose up -d db
npm run db:migrate:local
npm run db:migrate:status
```

Os arquivos `.env`/`.env.local` fornecem apenas valores padrão: variáveis
definidas explicitamente no shell ou no CI têm precedência. Para verificar um
alvo diferente do configurado localmente, informe `DATABASE_URL` e
`MIGRATION_DATABASE_URL` juntos; assim status, check e deploy apontam para o
mesmo PostgreSQL sem depender de overrides implícitos.

`npm run db:check` verifica o estado e retorna código de erro se houver
migrations pendentes ou divergentes. O comando não inicia o Next.js.

Os comandos disponíveis são:

```bash
npm run db:generate        # gera uma migration a partir do schema Drizzle
npm run db:check:files     # verifica a consistência dos arquivos versionados
npm run db:migrate:local   # aplica migrations no alvo local
npm run db:migrate:status  # mostra aplicadas, pendentes e divergentes
npm run db:check           # valida que não há pendências no banco
```

O primeiro baseline é intencionalmente vazio para que Better Auth e tenancy
possam adicionar suas tabelas em migrations próprias. Migrations são
forward-only, ficam em `drizzle/` e nunca devem ser editadas depois de
aplicadas em um ambiente compartilhado.

## Preview, Neon e produção

Preview pode configurar seu próprio `DATABASE_URL`; não é necessário manter
um ambiente de staging permanente. Em produção, use a URL PostgreSQL do Neon
(preferencialmente o endpoint pooled) nas variáveis da aplicação. O runtime
seleciona o driver serverless do Neon para hosts Neon e o driver Node para o
PostgreSQL local.

Migration de produção é uma etapa explícita anterior ao deploy da aplicação:

```bash
MIGRATION_DATABASE_URL="$DATABASE_URL" npm run db:migrate:deploy
MIGRATION_DATABASE_URL="$DATABASE_URL" npm run db:migrate:status
```

`MIGRATION_DATABASE_URL` permite que a etapa controlada use um alvo diferente
do processo web; quando ausente, os comandos de migration usam
`DATABASE_URL`. A aplicação não chama `migrate()` no boot e não há alteração
manual do schema no dashboard como fluxo normal.

## Testes de integração

Use o compose separado para um PostgreSQL descartável, exposto por padrão em
`localhost:5433`:

```bash
docker compose -f docker-compose.test.yml up -d db
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test \
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test \
npm run db:migrate:local
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test \
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test \
npm run test:integration
```

`npm run test:integration` is opt-in: it enables the PostgreSQL-backed
integration groups configured in the script (including the S03 T03–T07/T13
suites), uses the dedicated `vitest.integration.config.mts` configuration and
runs serially against the disposable PostgreSQL service. Unit tests remain
available through `npm test` and never require Docker or `DATABASE_URL`.

## Imagem e compose completo

O Dockerfile usa o output standalone do Next.js. Para validar a imagem e
subir o banco com a aplicação:

```bash
docker build -t financas-gomes .
docker compose up --build
```

O serviço `app` só inicia o servidor; migrations continuam sendo uma etapa
separada e controlada.
