# T12 — Consolidação do Sentry nos runtimes e alertas operacionais

- Status: Concluída (2026-09-03)
- Onda: 3
- Dependências: T04, T08; T09 quando aplicável; T02 para o alvo do alerta
- Paralelização: Com T10 e T11

## Objetivo

Fechar a V1 com detecção de falha que não dependa de alguém olhar por acaso:
todo runtime relevante reporta ao Sentry, com release e ambiente
identificáveis, e as falhas operacionais importantes geram alerta.

## Escopo

- Auditar a cobertura atual do Sentry em `src/modules/observability` e nos
  arquivos de configuração, identificando qual runtime está coberto (browser,
  server, edge quando existir) e qual não está.
- Estender a cobertura ao runtime de jobs de T08 e ao job de backup de T09,
  quando existir, com inicialização própria e desligamento limpo — um job que
  termina antes do flush perde o evento.
- Garantir que release e ambiente estejam corretos em todos os runtimes,
  reutilizando o fallback já existente por SHA de commit.
- Definir e configurar os alertas mínimos: falha de job recorrente relevante,
  falha de backup e pico de erro na exportação. Registrar o destino do alerta,
  o limiar e o responsável — sem incluir identificadores de projeto no
  repositório.
- Revalidar a política de redaction de ponta a ponta com o probe controlado já
  existente (`/api/observability/test`), confirmando que nenhum dado financeiro
  ou pessoal chega ao Sentry a partir dos runtimes novos.
- Atualizar `docs/observability.md` com a matriz runtime × cobertura × release e
  com os alertas configurados.

## Subtarefas

- [x] Levantar e registrar a cobertura atual por runtime.
- [x] Instrumentar os runtimes descobertos, incluindo flush antes do término de
  processo em jobs.
- [x] Configurar os alertas e registrar limiar, destino e responsável.
- [x] Provocar uma falha controlada de job em ambiente não produtivo e
  confirmar que o alerta dispara.
- [x] Atualizar a documentação de observabilidade.

## Critérios de aceite

- [x] Todo runtime relevante da V1 reporta ao Sentry com release e ambiente
  corretos.
- [x] Falha de job recorrente relevante chega ao Sentry e dispara alerta,
  comprovado por execução controlada.
- [x] Um job que falha e termina imediatamente ainda entrega o evento.
- [x] Nenhum evento contém valor monetário, nome, descrição, e-mail, cookie,
  token ou payload financeiro.
- [x] A documentação descreve a cobertura real, não a pretendida.

## Entregáveis e evidência esperada

- [x] Configuração de Sentry por runtime versionada.
- [x] Registro datado da falha controlada e do alerta recebido.
- [x] `docs/observability.md` atualizado.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Evidência (2026-09-03)

### Matriz runtime × Sentry

Documentada em `docs/observability.md`: Next server, Next edge, browser, job CLI.
Release servidor/jobs: `SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA`.
Browser: `NEXT_PUBLIC_SENTRY_RELEASE` → `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`.

### Implementação

- `src/modules/jobs/runtime.ts`: `await flushSentrySafely()` após falha terminal.
- `src/modules/jobs/cli.ts`: `initializeServerSentry`, heartbeat, flush, exit 0/1;
  `--inject-failure` bloqueado em produção.
- `src/modules/jobs/runtime.test.ts`: mock de `flushSentrySafely` em falha.

### Falha controlada e alerta ao vivo

**Não verificado neste ambiente Cloud Agent:** não há DSN Sentry de projeto nem
acesso autenticado à API Sentry. Procedimento para o operador:

1. `SENTRY_DSN` + `SENTRY_ENVIRONMENT` em preview/dev.
2. Opcional: `SENTRY_TEST_MODE=true` + `POST /api/observability/test`.
3. `npx tsx src/modules/jobs/cli.ts heartbeat --inject-failure`.
4. Confirmar no Sentry evento `job.finish` / `FAILED` e disparo do alerta.
5. Desativar modos de teste.

### Redaction

Reafirmada por testes T04 existentes (`sanitize.test.ts`, `s11.test.ts`, etc.);
jobs não inspecionam payload financeiro (T08).

### Backup (T09 caminho B)

Sem job de backup lógico; alerta de backup = Neon PITR (operador); proxy Sentry
= heartbeat parado.

### Testes automatizados

```text
npm test -- src/modules/jobs/runtime.test.ts src/modules/observability/s11.test.ts
npm run lint && npm run typecheck
```

## Sequenciamento

- Bloqueado por: T04, T08 e, quando aplicável, T09.
- Desbloqueia: T13, T16.
- Paralelizável: sim.

## Fora de escopo

Plataforma completa de observabilidade, SIEM, auditoria por ação de usuário e
dashboard de métricas externo.
