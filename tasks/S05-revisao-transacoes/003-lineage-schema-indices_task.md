# T03 — Linhagem, schema, constraints e índices

- Slice: S05 — Revisão e organização das transações
- Status: Concluída — schema, migration, PostgreSQL, EXPLAIN em volume representativo e reversão controlada verificados (2026-08-30)
- Onda: 1
- Dependências: T01; schema/migrations de S03 e S04
- Paralelização: Com T02, T07 e T10; aplicação da migration é serial

## Objetivo

Garantir no banco a integridade da origem importada e preparar as consultas de
revisão sem enfraquecer o ledger nem reter dados financeiros brutos.

## Subtasks

- [x] Auditar no código a definição de `transaction_import_items`: FKs
  compostas tenant-safe para lote e evento, `ON DELETE RESTRICT`, campos
  `import_id`, `row_number` e `external_id`, além dos índices de join.
- [x] Completar a auditoria de `financial_events` e `account_entries`,
  incluindo órfãos e preservação de `origin` após alterações.
- [x] Confirmar e documentar a decisão de unique lineage: o schema e a
  migration impõem no máximo um item por evento importado em
  `(household_id, financial_event_id)`, sem uma tabela de linhagem concorrente.
- [x] Conferir os índices declarados para origem/data/ID, categoria e
  linhagem/joins no schema e na migration.
- [x] Medir os índices com `EXPLAIN (ANALYZE, BUFFERS)` em volume
  representativo e registrar a justificativa baseada nos planos.
- [x] Confirmar que `src/db/schema.ts` inclui e exporta as tabelas de
  importação e que a migration presente é aditiva, com os índices de origem,
  categoria e unique lineage.
- [x] Validar aplicação segura da migration em banco vazio e existente, sem
  introduzir `transactions` nem `accounts.balance`.
- [x] Exercitar reversibilidade formal da migration com down/rollback
  controlado.
- [x] Criar e executar testes com PostgreSQL real para `ON DELETE RESTRICT`,
  FKs compostas, evento importado sem/múltipla linhagem, evento manual sem
  item, duplicação de lineage e tentativa cross-tenant.
- [x] Executar `db:check:files`; registrar o resultado, o status da migration,
  os testes, os planos e as evidências de ausência de órfãos após validar em
  PostgreSQL.
- [x] Preparar o handoff completo para T04, T11 e T13 com fixtures, planos,
  evidências de ausência de órfãos e instruções de aplicação serial.

## Escopo

- Auditar `financial_events`, `account_entries` e
  `transaction_import_items` existentes antes de criar migration.
- Preservar `financial_events.origin` (`MANUAL`, `IMPORT`, `SYSTEM`) e as FKs
  compostas por `household_id`; não criar uma coluna/tabela concorrente de
  `source` sem decisão da T01.
- Garantir que um evento `IMPORT` revisável tenha no máximo uma linhagem de
  item. Se a relação ainda não tiver essa garantia, adicionar uma unique
  constraint/index tenant-safe em `(household_id, financial_event_id)` e
  testar o caso de duplicação.
- Manter `import_id`, `row_number` e `external_id` imutáveis por convenção de
  use case e protegidos por FKs/índices existentes; não armazenar token, bytes,
  arquivo ou linhas inválidas para permitir a revisão.
- Revisar índices reais para a query de T04: tenant + origem + data + ID,
  tenant + categoria + data + ID, joins de entry/evento e consulta da
  linhagem. Adicionar somente índices motivados pelo `EXPLAIN` e pelo volume
  representativo; não criar índice de busca textual sem medir.
- Se a busca case-insensitive exigir uma extensão PostgreSQL, validar sua
  portabilidade em Docker/Neon antes de adotá-la. A implementação pode manter
  uma busca simples sem `pg_trgm` caso o volume e o `EXPLAIN` sejam aceitáveis.
- Gerar migration Drizzle reversível/documentada, atualizar
  `src/db/schema.ts` e exports, e manter `ON DELETE RESTRICT` para eventos,
  entries e linhagem com significado histórico.
- Cobrir checks/FKs e isolamento com PostgreSQL real, incluindo evento
  importado sem/múltipla linhagem, evento manual sem item e tentativa
  cross-tenant.

## Critérios de aceite

- [x] Não existe `transactions` física nem `accounts.balance` novo.
- [x] Evento importado continua identificável por `origin=IMPORT` e pela
  relação `transaction_import_items` após qualquer update de descrição/categoria.
- [x] Um item não pode apontar para evento ou lote de outro household.
- [x] O schema impede a duplicidade de linhagem definida no contrato ou a
  query de T04 falha de forma explícita diante de corrupção.
- [x] Índices usados pela listagem, pendências e filtros aparecem no plano ou
  têm justificativa documentada; não há full scan acidental por falta de
  predicado tenant/date na consulta principal.
- [x] Migration passa `db:check:files`, aplica em banco vazio e existente e
  não remove dados históricos.

## Handoff

- T04 deve usar as colunas/índices validados e fazer join tenant-scoped com
  `transaction_import_items`/`transaction_imports`.
- T05 não pode atualizar nenhuma coluna de origem ou linhagem.
- T11 usa os fixtures de volume e os planos de execução desta task.
- T13 aplica a migration em ambiente de release e confere zero pendências.

## Verificações

- [x] `rtk npm run db:check:files` — passou.
- [x] Status da migration em banco PostgreSQL descartável — `applied: 12`,
  `pending: 0`, `drifted: 0` em banco existente e em banco vazio temporário.
- [x] Rollback/reapply controlado em banco descartável — os três índices da
  migration foram removidos dentro de transaction, a entrada da última
  migration foi reaberta como pendente e `applyMigrations()` os reaplicou;
  sentinela de dados permaneceu intacta e o status final foi `12/0/0`.
- [x] Testes de integração PostgreSQL com `ON DELETE RESTRICT`, FKs compostas,
  unique lineage e isolamento.

## Bloqueios e evidências

- `rtk npm run db:check:files` passou e `rtk git diff --check` não reportou
  whitespace error.
- `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test T03_INTEGRATION=1 npm exec vitest -- run --config vitest.integration.config.mts src/db/review-lineage.integration.test.ts src/db/financial-events.integration.test.ts` passou: 2 arquivos, 10 testes. A suíte de lineage inclui o teste de ausência de órfãos, preservação de `origin`, FKs compostas, unique lineage, isolamento, `ON DELETE RESTRICT` e `EXPLAIN (ANALYZE, BUFFERS)` em 10.000 eventos sintéticos por household (20.000 no total).
- O gate de EXPLAIN foi corrigido no teste, não no produto: com 1.200 eventos por household o planner escolhia legitimamente `Seq Scan` porque o predicado `category_id IS NULL` retornava 25% da tabela pequena. O fixture agora semeia 10.000 eventos por household em lotes de 500, executa `ANALYZE` e exige uma rota index-backed tenant/data (aceitando `Index Scan` ou `Index Only Scan`) e ausência de `Seq Scan`. Na execução atual, origem usou `financial_events_household_origin_occurred_on_id_idx`, categoria usou `financial_events_household_category_occurred_on_id_idx` e pendências usaram `Index Scan` no índice tenant/data com sort incremental; o plano manteve `household_id` e data como condições de índice.
- A auditoria não encontrou necessidade técnica de alterar a migration ou criar índice parcial adicional: o volume T11 (10.000 importados + 100 manuais) já usa os índices existentes no caminho de evento. A busca textual continua explicitamente tratada em T04/T11 como `Seq Scan` esperado para `ILIKE '%...%'`, sem `pg_trgm`.
- O status da migration foi verificado diretamente via `tsx` no PostgreSQL da integração e retornou `applied: 12`, `pending: 0`, `drifted: 0`. Em banco vazio temporário, a mesma aplicação retornou o mesmo status e expôs somente as tabelas esperadas; o banco temporário foi removido após a verificação.
- A migration `20260830164715_overconfident_stardust.sql` é aditiva: contém apenas os dois índices de consulta e o unique index de lineage. O teste de integridade confirmou ausência de `transactions` e `accounts.balance` e não houve remoção de dados históricos.
- A reversão foi exercitada em `financas_gomes_t03_rb_20260830_1652` (PostgreSQL 16 descartável): após as 12 migrations aplicadas, um `BEGIN` com os três `DROP INDEX` da migration seguido de `ROLLBACK` restaurou os três índices e preservou uma linha sentinela e as 12 linhas de `drizzle.__drizzle_migrations`. No ensaio controlado, os mesmos drops e a remoção exclusiva do hash da última migration foram confirmados com `COMMIT`; o banco ficou em `applied: 11`, `pending: 1`, `drifted: 0`, sem os índices e com a sentinela preservada. `applyMigrations()` reaplicou a migration oficial, retornando `applied: 12`, `pending: 0`, `drifted: 0`, com os três índices presentes e a sentinela intacta. O banco descartável foi removido ao final. Esse down manual fica restrito à evidência descartável; produção continua forward-only conforme `docs/database.md`/`docs/production-deploy.md`.
- `src/db/schema.ts` exporta as tabelas de importação; `src/db/financial-events-schema.ts` e `src/db/transaction-imports-schema.ts` declaram os índices/FKs tenant-safe correspondentes. O handoff para T04 usa esses nomes e predicados.
