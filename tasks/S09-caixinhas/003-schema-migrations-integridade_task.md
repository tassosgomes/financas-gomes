# T03 — Schema, migrations e integridade

- Status: Concluída
- Onda: 1
- Dependências: T01 e contratos de T02
- Paralelização: Com T02, T04, T09 e T10; aplicação da migration é serial

## Objetivo

Persistir a configuração e os movimentos das Caixinhas com constraints fortes,
sem materializar saldo e sem permitir associações cross-tenant.

## Escopo

- Criar as tabelas definidas por T01, preferencialmente equivalentes a
  `boxes`/`budgets`, `box_movements` e `budget_allocation_rules`, mantendo o
  nome interno distinto do termo da UI somente quando documentado.
- Incluir UUIDv7, `household_id`, timestamps técnicos, vigência, meta/data-alvo,
  categoria e status necessários ao contrato, além das referências de origem
  dos movimentos.
- Manter amount de movimentos positivo em `BIGINT`; o tipo
  `CONTRIBUTION`/`WITHDRAWAL` carrega a semântica do sinal. Não criar
  `balance`, `protected_amount` ou snapshot de Spendable.
- Criar FKs compostas para Caixinha–household, movimento–Caixinha–household,
  categoria–household e fontes financeiras quando aplicável.
- Criar unicidade de referência de movimento e regras de alocação, no máximo
  uma Caixinha ativa por categoria quando decidido em T01, índices de leitura
  por household/data e checks de amount/data/intervalo.
- Usar `RESTRICT` por padrão; permitir `CASCADE` somente em dados sem
  significado independente. Caixinhas com histórico devem ser encerradas.
- Integrar a tabela `application_commands` com as operações do S09 sem aceitar
  operação arbitrária do caller.

## Subtarefas

- [x] Mapear o schema existente e confirmar que nenhuma migration de S08 criou
  tabela ou coluna de Caixinha. Evidência: inspeção do journal/migrations até
  S08 e teste PostgreSQL de ausência de colunas de saldo/snapshot nas tabelas
  canônicas.
- [x] Implementar o schema Drizzle e exports em `src/db/schema.ts`. Evidência:
  typecheck, ESLint direcionado e 4 testes de metadados passaram.
- [x] Gerar migration forward-only; usar SQL manual para partial indexes,
  constraints compostas ou trigger quando Drizzle não expressar a regra.
  Evidência: migration 20260902140856_cuddly_mercury aplicada em banco limpo,
  com FKs compostas, btree_gist/exclusions, índices parciais e triggers.
- [x] Adicionar índices motivados pelas queries de T05 e registrar a query que
  cada índice atende. Evidência: matriz abaixo e presença catalogada pelos
  testes de metadados/integração.
- [x] Criar testes de schema, FKs, checks, unicidade, status e rollback.
  Evidência: 4 testes unitários e 6 testes PostgreSQL passaram.
- [x] Executar `db:check:files`, migration idempotente e status em PostgreSQL
  descartável. Evidência: banco dedicado financas_gomes_t03_final com duas
  aplicações, status direto 19 aplicadas/0 pendentes/0 divergentes e
  db:check:files sem divergência.

## Critérios de aceite

- [x] Dois households não conseguem compartilhar Caixinha, movimento,
  categoria ou referência de origem por manipulação de IDs. Evidência:
  testes PostgreSQL de FKs compostas para budget/categoria/evento e
  uniqueness por household de referência e origem.
- [x] Amount zero/negativo, movimento fora da vigência, fechamento inválido e
  referência duplicada são rejeitados pelo domínio e pelo banco quando
  aplicável. Evidência: checks/triggers/exclusions exercitados com códigos
  PostgreSQL 23514, 23505 e 23P01; intervalos adjacentes foram aceitos.
- [x] Não existe saldo persistido nem caminho de deleção que remova o histórico
  financeiro de uma Caixinha usada. Evidência: consulta de catálogo sem
  balance/protected/snapshot e testes de UPDATE/DELETE append-only e FK
  RESTRICT.
- [x] A migration é forward-only, reproduzível e não depende de Vercel/Neon.
  Evidência: aplicação em PostgreSQL 16 descartável limpo, segunda aplicação
  idempotente e status sem drift.

## Entregáveis e evidência esperada

- [x] Schema em `src/db/*` e exports no entrypoint do banco.
- [x] Migration em `drizzle/` com snapshot/journal consistente.
- [x] Testes PostgreSQL de constraints, isolamento referencial e rollback.
- [x] Saída de `rtk npm run db:check:files`, migration/status e
  `rtk git diff --check` registrados na task.

## Fora de escopo

Queries/read models, Server Actions, UI, cálculo de saldo e integração final
com o adapter do S08.

## Evidências executadas

Arquivos T03 escritos ou integrados no write set:

- src/db/budgets-schema.ts: tabelas budgets, budget_movements e
  budget_allocation_rules; enums, BIGINT positivo, vigência, metas e tipos.
- src/db/schema.ts: exports e registro no schema do Drizzle.
- src/db/accounts-categories-schema.ts: allowlist finita de
  application_commands com operações S09; sem operação budget.delete.
- src/db/financial-events-schema.ts: chave única composta necessária para a FK
  tenant-safe de account_entries.
- src/db/budgets-schema.test.ts e src/db/budgets.integration.test.ts.
- drizzle/20260902140856_cuddly_mercury.sql,
  drizzle/meta/20260902140856_snapshot.json e entrada idx 18 no journal.

Checks estáticos e de migration:

- rtk npm exec tsc -- --noEmit --pretty false: passou.
- rtk npm exec eslint -- src/db/budgets-schema.ts
  src/db/budgets-schema.test.ts src/db/budgets.integration.test.ts
  src/db/schema.ts src/db/financial-events-schema.ts
  src/db/accounts-categories-schema.ts --max-warnings=0: passou.
- rtk npm exec vitest -- run src/db/budgets-schema.test.ts
  --config vitest.config.mts --reporter=dot: 1 arquivo, 4/4 testes.
- rtk npm run db:check:files: Everything's fine.
- rtk git diff --check: exit 0.
- PostgreSQL descartável localhost:5433/financas_gomes_t03_final:
  migration local aplicada duas vezes, ambas com sucesso.
- Verificação direta de status no mesmo alvo:
  applied 19, pending 0, drifted 0, pendingTags vazio.
- rtk env ... T03_INTEGRATION=1 npm exec vitest -- run
  --config vitest.integration.config.mts src/db/budgets.integration.test.ts
  --reporter=dot: 1 arquivo, 6/6 testes PostgreSQL.

Os testes PostgreSQL verificam ausência de colunas balance/protected/snapshot,
FKs compostas e RESTRICT entre households, categoria EXPENSE ativa, amount
positivo, source/account-entry único, exclusões temporais de budgets e regras
de alocação, vigência half-open, fechamento sem reabertura, movimento
append-only, allowlist de application_commands e rollback transacional.

Índices e consumidores:

- budgets_household_status_active_from_idx atende listagem por household,
  status e início; budgets_household_category_active_from_idx atende a linha
  temporal por categoria.
- budget_movements_household_budget_effective_on_id_idx atende histórico
  ordenado de uma Caixinha; budget_movements_household_effective_on_budget_idx
  atende timeline por household/data; budget_movements_household_source_reference_idx
  e o unique partial atendem reconciliação por origem.
- budget_allocation_rules_household_budget_effective_from_idx atende regras
  vigentes de uma Caixinha; budget_allocation_rules_household_effective_from_idx
  atende leitura temporal por household.
- As chaves únicas compostas id/household são âncoras das FKs compostas; a
  migration cria account_entries_id_household_id_uq antes da FK de movimento.

Riscos de integração e handoff:

- T05 deve resolver referenceId/boxReferenceId dentro do household_id e
  calcular saldo/proteção a partir de movimentos; nenhuma coluna de saldo deve
  ser adicionada.
- T06 deve gravar commandId/payloadHash na PK composta de application_commands,
  usar somente a allowlist S09 e respeitar a guarda de CLOSED, active_from e
  category_id após o primeiro movimento.
- T07 deve resolver correctsReferenceId para corrects_movement_id no mesmo
  household/budget, manter correções append-only e executar o par de
  transferência na mesma transação com transferReferenceId comum; uma FK não
  prova sozinha a atomicidade do par.
- T13 pode reutilizar a suíte opt-in com DATABASE_URL apontando para um
  PostgreSQL descartável. O runner confirmou 6/6 testes T03.
- O comando CLI db:check/status carrega .env.local com override=true. No alvo
  compartilhado financas_gomes_test ele reportou 18 aplicadas, 1 pendente e
  1 divergente porque há um hash de migration intermediária preexistente;
  não houve reset destrutivo. O alvo dedicado final foi validado diretamente
  com 19/0/0 e é a evidência normativa desta task.

Não há bloqueio funcional T03: PostgreSQL 16 descartável estava disponível e
todos os critérios foram executados no alvo dedicado. O drift do banco
compartilhado é um gate de ambiente/preexistente e deve ser resolvido pelo
responsável pela infraestrutura antes de usar esse alvo para a suíte global.
