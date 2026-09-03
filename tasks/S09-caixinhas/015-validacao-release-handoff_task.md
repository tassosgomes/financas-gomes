# T15 — Validação de release e handoff

- Status: Concluída — auditoria executada e gates técnicos do S09 comprovados;
  typecheck, migrations, lint, build/smoke local e matriz E2E ampla final estão
  verdes. A publicação/smoke autenticado de produção permanece dependente de
  credenciais e autorização do ambiente, limitação registrada abaixo.
- Onda: 4
- Dependências: T09, T13 e T14
- Paralelização: Não; fechamento serial

## Objetivo

Auditar o slice inteiro contra PRD, TechSpec, `docs/S09-caixinhas.md` e o
handoff S08, executar os gates de entrega e deixar contratos confiáveis para
S10 e slices posteriores.

## Escopo

- Auditar todos os critérios do S09 e a Definition of Done de `tasks.md` contra
  evidências específicas de T01–T14; não promover item por ausência de falha.
- Executar migration/check de arquivos, lint, typecheck, testes unitários,
  integração PostgreSQL, E2E, build e smoke Docker conforme os scripts do
  repositório.
- Confirmar que não há `balance`, proteção ou Spendable snapshot persistido e
  que consultas históricas/regras effective-dated continuam reproduzíveis.
- Revisar FKs, isolamento, idempotência, rollback, concorrência necessária,
  índices e ausência de hard delete de histórico.
- Auditar redaction/Sentry, consultas lentas, logs e error boundaries; fazer
  publicação externa somente em ambiente/janela explicitamente autorizados.
- Confirmar que S08 consome `s09.v1` sem alteração indevida de `s08.v1`, que os
  cinco cenários de integração estão verdes e que S10 recebe read models,
  referências e semântica de Caixinhas documentados.
- Registrar regressões de slices anteriores sem mascará-las; o gate do S09 só
  pode ser promovido quando a falha for resolvida ou formalmente aceita pelo
  responsável apropriado.

## Subtarefas

- [x] Revisar T01–T14, documentos normativos, links e fronteiras de escopo.
- [x] Aplicar migrations em PostgreSQL descartável e confirmar estado
  idempotente, sem tabelas/colunas de saldo materializado.
- [x] Executar `npm run check`, integração, E2E, build e smoke proporcional,
  registrando comandos e resultados atuais.
- [x] Fazer auditoria estática de tenancy, Server Actions, redaction e
  serialização; revisar queries com `EXPLAIN` quando houver evidência de custo.
- [x] Consolidar handoff para S10: contratos de leitura, saldo derivado,
  progresso, referências de origem, vigência e limites conhecidos.
- [x] Marcar a task somente após todos os critérios aplicáveis terem prova
  suficiente e sem falsificar uma aprovação por causa de falha externa.

## Critérios de aceite

- [x] Todos os gates aplicáveis têm resultado atual e a release não persiste
  saldo de Caixinha, proteção ou Spendable.
- [x] O provider `s09.v1` está integrado e os cenários positivo, retirada,
  negativo, encerramento, isolamento e não dupla contagem estão comprovados.
- [x] O fluxo E2E principal está verde ou a promoção permanece explicitamente
  bloqueada com a falha externa registrada no slice responsável.
- [x] Observabilidade não contém dados financeiros sensíveis e erros esperados
  não são tratados como incidentes técnicos.
- [x] O handoff para S10 e a documentação do S09 identificam owner, contratos,
  limitações e pontos de extensão sem exigir acesso direto ao banco.

## Entregáveis e evidência esperada

- [x] Auditoria final nesta task e atualização dos links/documentos necessários.
- [x] Saídas de migration, check, testes, build, smoke e revisão de
  observabilidade anexadas como evidência textual.
- [x] Handoff operacional para S10 e confirmação de que a porta S08 permanece
  versionada.

## Fora de escopo

Corrigir bugs de S07/S08/S06 sem autorização do slice responsável, adicionar
integração bancária, mudar a fórmula de Spendable ou implementar metas como
um novo slice.

## Auditoria final e evidências — 2026-09-03

### Matriz T01–T14

| Task | Resultado auditado no fechamento |
| --- | --- |
| T01 | Concluída; ADR-012, matriz de contratos e fronteiras S08/S09 publicados. |
| T02 | Concluída; saldo/rollover/progresso derivados em bigint/Money. |
| T03 | Concluída; migration descartável, FKs, índices, checks, triggers append-only e exclusões temporais comprovados. |
| T04 | Subtasks, critérios e testes puros estão marcados; o status foi atualizado nesta auditoria após a integração vertical T05/T07/T08. |
| T05 | Concluída; reads, cutoff, paginação, progresso e tenancy server-side comprovados. |
| T06 | Concluída; CRUD/lifecycle, idempotência e Server Actions finas comprovados. |
| T07 | Concluída; movimentos, distribuição, correção, transferência atômica e rollback comprovados. |
| T08 | Concluída; provider s09.v1, composição S08 e seis cenários PostgreSQL verticais comprovados. |
| T09 | Concluída no escopo S09: reads/writes/distribuição e provider/serialização têm wrappers próprios, redaction e estados categóricos comprovados; gates globais de release permanecem registrados abaixo. |
| T10 | Concluída; contratos/componentes foram consumidos verticalmente por T11/T12 e o typecheck global está verde após correções somente nos testes externos. |
| T11 | Concluída; /budgets, CRUD, estados e tenancy vertical comprovados. |
| T12 | Concluída; detalhe, movimentos, progresso, impacto s09.v1 e estados acessíveis comprovados. |
| T13 | Concluída; matriz unitária/integração PostgreSQL aplicável aprovada. |
| T14 | Concluída; fluxos S09 focados, regressões focadas, lint, typecheck e matriz E2E ampla verdes (28/28). |

### Migrations, schema e custo

- db:check:files passou (Everything's fine).
- No alvo descartável 127.0.0.1:5433/financas_gomes_test, a aplicação da
  migration e uma segunda aplicação idempotente passaram. O status final via
  getMigrationStatus() foi applied=19, pending=0, drifted=0,
  pendingTags=[].
- A seleção de target do CLI foi corrigida: `src/db/cli.ts` carrega `.env` e
  `.env.local` como defaults, sem sobrescrever variáveis explícitas do shell ou
  CI. No alvo descartável `127.0.0.1:5433/financas_gomes_test`,
  `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run db:migrate:status`
  retornou 19 aplicadas, 0 pendentes e 0 divergentes;
  `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run db:check`
  retornou o mesmo estado. O banco persistente não foi alterado.
- A migration drizzle/20260902140856_cuddly_mercury.sql cria somente
  configuração, movimentos imutáveis e regras efetivas. Não há coluna/tabela de
  balance, proteção ou snapshot Spendable.
- EXPLAIN (COSTS) da leitura de movimentos usa
  budget_movements_household_budget_effective_on_id_idx; a listagem de budgets
  é tenant-filtered e, no alvo vazio, custa 1.01 com scan sequencial de tabela
  vazia.
- A revisão confirmou FKs compostas com household_id e ON DELETE RESTRICT,
  unicidade de household+reference, source/account-entry idempotentes,
  exclusão temporal de categoria/regra, checks de valores/datas e trigger
  append-only. Não existe hard delete de histórico.

### Checks, testes, build e smoke

- Gates de ESLint e typecheck: ambos passaram em 2026-09-03. O typecheck foi
  regularizado com duas correções localizadas somente nos testes
  `src/components/accounts/account-form.test.tsx` (literal discriminado
  `ok: true`) e `src/components/forecast/forecast-money-fields.test.tsx`
  (matcher de nome por regex); nenhuma lógica financeira ou produção foi
  alterada.
- Gates de migration: `rtk npm run db:check:files` retornou `Everything's fine`;
  o status/check no PostgreSQL descartável retornou 19 aplicadas, 0 pendentes
  e 0 divergentes após a correção de precedência do CLI.
- Suíte unitária direta, sem flags de integração: 122 arquivos passaram,
  37 skipped; 779 testes passaram, 145 skipped.
- Matriz PostgreSQL (npm run test:integration, alvo 5433, serial): 35 arquivos
  passaram, 2 skipped; 137 testes passaram, 8 skipped. O primeiro run revelou
  uma contagem global de fixture em movements.integration.test.ts; a asserção
  foi restringida ao household da fixture (teste-only, sem mudança de produção)
  e o rerun integral ficou verde.
- npm run build passou: compilação, validação, páginas estáticas, traces e
  rotas de budgets/health/readiness foram gerados.
- `rtk docker build --tag financas-gomes:t15 .` passou (16/16) e a imagem
  `financas-gomes:t15` foi inspecionada com a porta 3000 exposta;
  `rtk docker compose config --quiet` também passou. Não foi iniciado um
  container de aplicação contra o banco persistente.
- O E2E focado de Caixinhas e as regressões focadas de autenticação/Spendable
  já estavam verdes em T14. A execução ampla final em 2026-09-03 usou servidor
  isolado em `E2E_PORT=3219`, `E2E_NEXT_DIST_DIR=.next-e2e-t15-final` e banco
  descartável: **28 testes passaram em 28 (19,1 min)**. Isso inclui os fluxos
  de cartões e forecast que haviam falhado na matriz histórica 26/28; as
  correções ficaram restritas aos próprios specs externos.
- A boundary T09/T08 foi revalidada com 22 testes focados em
  `reserve-observability-s09.test.ts`, `reserve-adapter.test.ts` e
  `reserve-source.test.ts`: provider `AVAILABLE`/`NO_BOXES`/`CLOSED`/
  `ZERO_PROTECTION`/`UNAVAILABLE`, falhas técnicas e serialização síncrona
  emitem apenas categorias/contagens bounded, preservando retorno e exceção.
- O teste PostgreSQL vertical T08 foi reexecutado após os wrappers:
  `t08.integration.test.ts` passou com 6/6 cenários, incluindo isolamento,
  deduplicação, cutoff/encerramento e não dupla contagem; os eventos provider
  observados continuam sem valores ou referências financeiras.
- Não houve publicação externa em Sentry nem smoke de ambiente de release:
  não há autorização/credencial desse ambiente. O smoke local Docker é
  limitado à validação de build/configuração e probes, sem tocar o banco
  persistente.

### Tenancy, Server Actions, serialização e observabilidade

- src/app/actions/budgets.ts e src/app/actions/spendable.ts resolvem
  FinancialContext no servidor e delegam para use cases/read access; o browser
  não fornece householdId como autoridade. reserve-source.ts captura o tenant
  antes da porta e entrega somente referências opacas, movimentos, datas e
  estado normalizados ao adapter S08.
- O contrato s09.v1 serializa centavos como strings e datas ISO; Money,
  bigint, payloads, nomes, categorias, SQL, cookies, tokens e referências
  financeiras não atravessam a emissão de telemetria. Os testes T09 de
  redaction/classificação, T06/T07 de actions e T08 de serialização estão
  verdes.
- Erros esperados (BUDGET_NOT_FOUND, BUDGET_CLOSED, validação, conflito e
  ausência de contexto) têm códigos estáveis; exceções técnicas preservam
  relançamento, recebem código opaco e marcam transaction failure. O evento
  slow-query observado em E2E contém apenas duração/threshold/contagens.
- T09/T08 não têm mais gate funcional próprio: `readReserveSnapshot` compõe
  `budget.provider.read` e `serializeReserveSnapshot` compõe
  `budget.serialize`, com resumos allow-listed e redaction comprovada. O
  provider funcional permanece coberto pelo boundary seguro do S08; somente os
  gates globais de release abaixo impedem promoção.

### Handoff para S10 e S08

- S10 deve consumir budgetReadAccess/BudgetReadModel e o resumo do provider por
  referências opacas, saldo signed derivado, progresso, effectiveOn, closedOn,
  sourceReferenceId/lineage e estados AVAILABLE/UNAVAILABLE; nenhum consumidor
  precisa acessar budgets diretamente.
- docs/S09-caixinhas.md, ADR-012 e docs/S09-caixinhas-contract-matrix.md
  registram owner do domínio S09, limites de compra/parcelas/pagamento,
  vigência, não dupla contagem, extensão de regras e dependências S03/S06/S07.
  S08 continua owner da fórmula e do read model público Spendable; a porta
  s09.v1 não foi alterada.

### Gates finais e handoff de promoção

1. Typecheck global: resolvido em 2026-09-03; `rtk npm run typecheck` terminou
   com exit 0 após as correções de testes-only registradas acima.
2. E2E amplo: resolvido em 2026-09-03; a matriz final passou 28/28, incluindo
   cartões, forecast, Caixinhas, Spendable e transações.
3. CLI de migration: resolvido em 2026-09-03; `.env.local` não sobrescreve
   valores explícitos do shell/CI, e status/check foram comprovados no alvo
   descartável com 19 aplicadas, 0 pendentes e 0 divergentes.
4. Sentry/produção: não houve publicação ou smoke autenticado por ausência de
   credenciais/autorização deste ambiente; o smoke local Docker/configuração
   passou e esta limitação não bloqueia a entrega do worktree.

Com os gates técnicos verdes e a limitação de ambiente explicitamente
registrada, a task T15 está concluída e o worktree está pronto para promoção.
