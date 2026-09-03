# Deploy e validação de produção

Este runbook é o procedimento de fechamento do S01. O deploy é manual e
serializado: os gates do CI precisam estar verdes, a migration deve terminar
com sucesso e somente então a versão da aplicação pode receber tráfego.

O repositório não contém credenciais, IDs de provedor ou domínio de produção.
Os valores entre `<...>` abaixo são autoridade/configuração externa e devem ser
preenchidos no Vercel, Neon, Google Cloud, Sentry ou no ambiente protegido do
GitHub. Nunca os comite.

## Pré-requisitos e autorização

Antes de iniciar, confirme no commit selecionado:

1. O workflow `CI` passou integralmente (lint, typecheck, testes, migrations,
   integração, build, E2E e Docker).
2. O commit foi integrado à branch de produção e não há migration editada
   depois de aplicada em um ambiente compartilhado.
3. O projeto Vercel, o banco Neon, o cliente OAuth e o projeto Sentry foram
   identificados pelo responsável por cada serviço.
4. O ambiente `production` do GitHub possui revisão obrigatória configurada,
   quando a política do repositório exigir aprovação humana.

O deploy é disparado em **Actions → Production deploy → Run workflow**, no
commit aprovado, digitando exatamente `DEPLOY-PRODUCTION`. Qualquer outro valor
falha no job de autorização antes de qualquer migration/deploy. O workflow não
tem gatilho em pull request nem executa migration no boot da aplicação.

## Configuração dos provedores

### Neon

Crie ou selecione o banco PostgreSQL de produção no projeto Neon. A Vercel
**não faz backup** dos dados do PostgreSQL — a integração de marketplace apenas
injeta `DATABASE_URL` e hospeda a aplicação. Toda política de retenção,
PITR e restauração é responsabilidade do **Neon** (decisão T02 / ADR-014).

Antes do primeiro deploy de produção, o operador deve confirmar no console Neon
(sem registrar IDs neste documento):

1. **Plano pago** (Launch ou Scale). O plano Free limita o histórico a 6 horas
   e **não** atende a política de retenção ≥ 7 dias da V1.
2. **Instant restore (PITR) habilitado** — janela de histórico maior que zero
   (`Settings → Instant restore`). Valor zero desliga PITR e Time Travel.
3. **Janela de histórico ≥ 7 dias** (`history_retention_seconds` ≥ 604800).
   Planos Launch permitem até 7 dias; Scale até 30 dias. O padrão de planos
   pagos é 1 dia — é necessário **aumentar** explicitamente para 7 dias.
4. O branch usado em produção é um **root branch** (PITR só é suportado em root
   branches, por exemplo `main` ou `production`).
5. Existe procedimento aprovado para restaurar em **branch separada** antes de
   promover qualquer troca em produção (runbook T13).

Fontes públicas (consultadas em 2026-09-03): [Neon — History
window](https://neon.com/docs/introduction/history-window), [Neon — Instant
restore](https://neon.com/docs/introduction/branch-restore), [Vercel — Postgres
on Vercel](https://vercel.com/docs/storage/vercel-postgres) (confirma que a
Vercel não hospeda nem backupa PostgreSQL).

Matriz completa da auditoria: [`docs/S11-backup-audit.md`](S11-backup-audit.md).
T09 confirmou o caminho B: **não** configure chaves de object storage para
backup da V1 (`BACKUP_*`, `S3_*`, `R2_*` não fazem parte do runtime).

Use duas conexões quando possível:

- `DATABASE_URL` no Vercel: endpoint pooled do Neon, com TLS, para o runtime da
  aplicação;
- `MIGRATION_DATABASE_URL` no secret protegido `production` do GitHub: endpoint
  autorizado para DDL/migrations, com TLS. Pode ser o mesmo banco, mas não deve
  ser exposto ao bundle nem aos logs.

As URLs reais não entram neste documento. A etapa de migration define tanto
`MIGRATION_DATABASE_URL` quanto `DATABASE_URL` no processo do GitHub para que
`db:migrate:deploy`, `db:migrate:status` e `db:check` usem o mesmo alvo.

### Vercel

Vincule o repositório ao projeto correto e mantenha as variáveis abaixo no
ambiente **Production** do projeto. As variáveis `NEXT_PUBLIC_*` precisam estar
definidas antes do build.

| Variável | Tipo | Valor/critério |
| --- | --- | --- |
| `BETTER_AUTH_URL` | secreta/configuração | origem HTTPS canônica, por exemplo `https://<dominio>` |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | pública/opcional | mesma origem quando frontend e API compartilham host |
| `DATABASE_URL` | secreta | URL PostgreSQL pooled do Neon |
| `BETTER_AUTH_SECRET` | secreta | valor aleatório com pelo menos 32 caracteres |
| `GOOGLE_CLIENT_ID` | configuração | client ID do projeto Google autorizado |
| `GOOGLE_CLIENT_SECRET` | secreta | secret do cliente Google |
| `SENTRY_DSN` | secreta | DSN do projeto Sentry para o servidor |
| `SENTRY_ENVIRONMENT` | configuração | `production` |
| `SENTRY_RELEASE` | configuração/opcional | release do commit publicado; o código usa o SHA da Vercel como fallback |
| `NEXT_PUBLIC_SENTRY_DSN` | pública/opcional | DSN público do projeto Sentry para o navegador |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | configuração | `production` |
| `NEXT_PUBLIC_SENTRY_RELEASE` | pública/opcional | mesmo release enviado no build |
| `E2E_TEST_AUTH_ENABLED` | configuração | `false` ou ausente |
| `SENTRY_TEST_MODE` | configuração | `false` ou ausente |
| `SENTRY_TEST_TOKEN` | secreta/opcional | ausente fora de uma janela curta de probe controlado |

Não configure `MIGRATION_DATABASE_URL` no Vercel: esse alvo pertence à etapa
protegida do GitHub. Não use os placeholders de `.env.example` em produção.

No ambiente protegido `production` do GitHub Actions, configure:

- Secret `VERCEL_TOKEN` com escopo da equipe proprietária do projeto (ou da
  conta pessoal, se o projeto não estiver em uma equipe); tokens limitados
  somente ao projeto não são compatíveis com o preflight atual do `vercel pull`;
- Secret `MIGRATION_DATABASE_URL` com a URL Neon de migration;
- Variable `VERCEL_ORG_ID`;
- Variable `VERCEL_PROJECT_ID`;
- Variable `PRODUCTION_URL`, contendo apenas a URL pública HTTPS canônica.

`VERCEL_ORG_ID` deve ser o `orgId` exato gerado pelo `vercel link` em
`.vercel/project.json` — não o slug exibido na URL da conta. Os workflows usam
esse valor junto com `VERCEL_PROJECT_ID` e não passam `--scope` explicitamente.

Os IDs e a URL são valores públicos de configuração, mas ainda devem ser
confirmados pelo responsável do projeto. O token e as URLs PostgreSQL são
segredos; não os passe em argumentos, comentários, issues ou logs.

### Google OAuth

No cliente OAuth de produção, configure:

- origem JavaScript: `https://<dominio>`;
- redirect URI autorizado: `https://<dominio>/api/auth/callback/google`.

O path deve coincidir exatamente com o contrato do Better Auth. Remova hosts de
preview e localhost do cliente de produção se a política do provedor permitir.

### Sentry

Associe `SENTRY_DSN` e `NEXT_PUBLIC_SENTRY_DSN` ao mesmo projeto e defina o
ambiente como `production`. O release deve identificar o commit publicado.
Durante uma validação controlada, `SENTRY_TEST_MODE=true` e um
`SENTRY_TEST_TOKEN` aleatório podem ser habilitados temporariamente; depois do
probe, remova o token e volte `SENTRY_TEST_MODE` para `false`, publicando a
alteração de configuração conforme a política da Vercel.

## Execução controlada

O workflow `.github/workflows/production-deploy.yml` executa, nesta ordem:

1. valida a existência do alvo `MIGRATION_DATABASE_URL`;
2. verifica os arquivos de migration;
3. aplica migrations forward-only;
4. confirma status sem pendências ou drift;
5. puxa a configuração Production da Vercel;
6. gera e publica o build prebuilt;
7. testa health e readiness no `PRODUCTION_URL`.

Se qualquer etapa falhar, o job de deploy não começa (migration e deploy são
jobs dependentes). O workflow nunca chama `migrate()` no servidor Next.js.

Para uma execução manual equivalente, sem imprimir a URL no terminal:

```bash
MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
DATABASE_URL="$MIGRATION_DATABASE_URL" \
npm run db:migrate:deploy

MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
DATABASE_URL="$MIGRATION_DATABASE_URL" \
npm run db:migrate:status

MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
DATABASE_URL="$MIGRATION_DATABASE_URL" \
npm run db:check
```

Execute esse bloco apenas em uma máquina/runner autorizado e com o alvo
explicitamente confirmado. O caminho preferencial é o workflow protegido.

## Validação publicada

Os probes são públicos e não exigem sessão:

```bash
curl --fail --show-error --silent --location \
  "${PRODUCTION_URL%/}/api/health"
curl --fail --show-error --silent --location \
  "${PRODUCTION_URL%/}/api/readiness"
```

O health deve retornar HTTP 200 com `status=ok` e o check `process=ok`. O
readiness deve retornar HTTP 200 com `status=ok`, `database=ok` e `schema=ok`.
Qualquer resposta diferente de 200 bloqueia o tráfego. As respostas não devem
conter URLs PostgreSQL, cookies, tokens, headers de autorização ou payloads.

Depois dos probes, execute o smoke test manual com duas contas Google de teste
controladas e sem dados financeiros reais:

1. Usuário A entra via Google, chega a `/app` e confirma que o primeiro acesso
   criou exatamente um espaço financeiro persistido.
2. Usuário A cria um convite, copia o link sem colocá-lo em logs ou tickets,
   e sai da sessão.
3. Usuário B entra via Google, abre o link, aceita o convite e confirma que vê
   o mesmo espaço financeiro.
4. Usuário B faz logout; uma nova visita a `/app` deve exigir autenticação.
5. Revogue/remova as contas de teste e qualquer convite de teste conforme a
   política do ambiente.

Para observabilidade, valide o evento controlado no projeto Sentry correto
somente durante uma janela aprovada:

```bash
curl --fail --show-error --silent --location -X POST \
  -H "x-sentry-test-token: $SENTRY_TEST_TOKEN" \
  "${PRODUCTION_URL%/}/api/observability/test"
```

O endpoint deve retornar apenas um `eventId` opaco. Verifique no Sentry que o
evento tem ambiente/release corretos e não contém cookies, Authorization,
tokens de convite, secrets, mensagens de erro ou dados financeiros. Desative o
modo de teste imediatamente após a validação.

## Rollback e reexecução segura

As migrations são forward-only. Não edite nem tente executar uma migration
`down` contra produção.

- Falha somente na aplicação: interrompa o tráfego novo e promova no Vercel a
  última deployment compatível conhecida. Confirme health/readiness antes de
  reabrir o tráfego.
- Migration aplicada e build rejeitado: mantenha a aplicação anterior se ela
  for compatível com o schema expandido; corrija o build e publique uma nova
  versão. Não reverta SQL manualmente.
- Migration com dados incorretos ou destrutivos: pare a operação, preserve os
  logs sem segredos e siga o procedimento de restauração/PITR aprovado pelo
  responsável Neon. Restauração de produção exige autorização explícita e
  validação em um banco separado antes de qualquer troca.
- Após corrigir a causa, reexecute o mesmo workflow no commit aprovado. A
  tabela `drizzle.__drizzle_migrations` torna a aplicação idempotente: versões
  já aplicadas ficam registradas e somente pendências são executadas.

Antes de promover qualquer versão anterior, compare o contrato da aplicação
com as migrations já aplicadas. Se não houver compatibilidade, faça uma
migration de correção para frente e só depois promova a nova aplicação.

## Evidências e bloqueios atuais

O checkout atual contém apenas placeholders locais/CI. Não há neste ambiente
domínio publicado, `VERCEL_TOKEN`, IDs Vercel, URL Neon, credenciais Google,
DSNs Sentry ou usuários de teste. Consequentemente, este runbook e o workflow
estão prontos, mas o deploy, a migration, o smoke test e a validação Sentry de
produção permanecem pendentes até que esses valores/autoridades sejam
fornecidos e configurados nos provedores corretos.
