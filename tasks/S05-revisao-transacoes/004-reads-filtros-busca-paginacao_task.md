# T04 — Reads, filtros, busca, pendências e paginação

- Slice: S05 — Revisão e organização das transações
- Status: Concluída — T04-B, EXPLAIN do SQL completo, busca textual e compatibilidade do contrato S03 com enums ampliados verificados (2026-08-30); o typecheck global segue bloqueado por diagnósticos externos de S06
- Onda: 2
- Dependências: T02, T03, S03 e S04
- Paralelização: Com T05; integração de observabilidade com T10

## Objetivo

Implementar a consulta tenant-scoped que transforma o ledger em uma fila de
revisão rápida, com filtros úteis, origem preservada e paginação previsível.

## Subtasks

- [x] T04-A — publicar helpers puros e tipados em `review-reads.ts`.
  - [x] Predicados de evento revisável: `MANUAL`/`IMPORT`; `SYSTEM`/`REVERSAL`
    falham fechado.
  - [x] Cursor keyset com `occurredOn`, `id`, `filterHash` e `limit`.
  - [x] Mapping de row para `TransactionListItemReadModel`, com origem,
    linhagem importada validada e projeção de revisão.
- [x] T04-B — implementar reads SQL tenant-scoped de list/detail/summary,
  filtros, busca e paginação.
- [x] Criar testes unitários focados para normalização/reads e isolamento.
- [x] Criar teste PostgreSQL dedicado, caso o ambiente de integração esteja
  disponível.
- [x] Executar testes focados e `rtk git diff --check`.
- [!] Executar typecheck: nenhum diagnóstico nos módulos S05 de T04; o comando global ainda retorna erro por `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts`, fora do escopo autorizado.

## Escopo

- Generalizar a leitura atual de S03 para eventos `MANUAL` e `IMPORT`, sempre
  excluindo `REVERSAL` da coleção principal.
- Fazer join tenant-safe de `financial_events`, exatamente um
  `account_entries`, `accounts`, `categories` e, quando aplicável,
  `transaction_import_items`/`transaction_imports`.
- Retornar `source`/linhagem de S04; se um evento `IMPORT` não tiver a relação
  esperada, falhar fechado com erro técnico controlado ou erro de integridade,
  nunca inventar origem manual.
- Implementar filtros combináveis:
  - intervalo inclusivo de `occurredOn`;
  - conta;
  - categoria, incluindo `categoryId=null`;
  - tipo `INCOME`/`EXPENSE`;
  - status `POSTED`/`CANCELLED`;
  - origem `MANUAL`/`IMPORT`;
  - `review=NEEDS_REVIEW|ORGANIZED|ALL`;
  - busca case-insensitive por trecho da descrição atual.
- Aplicar a definição normativa de pendência (`POSTED` + categoria nula) e
  devolver `reviewState`/`reviewReason` por item.
- Implementar `getTransactionReviewSummary` (ou equivalente) com contagem de
  pendências no household, sem trazer todas as linhas para a aplicação.
- Usar keyset pagination com limite default 50 e máximo 100 (ou os valores
  fechados no T02), cursor validado e ordenação `occurred_on DESC, id DESC`.
  A query deve buscar `limit + 1` para definir `hasNextPage`.
- Fazer o cursor carregar/validar o hash dos filtros canônicos, evitando que
  uma URL alterada reutilize silenciosamente uma posição incompatível.
- Expandir detalhe por ID para `MANUAL` e `IMPORT`, preservando o retorno
  opaco para ID inexistente/cross-tenant e sem retornar evento `SYSTEM` como
  transação revisável.
- Evitar N+1 para a lista; reads podem usar Drizzle/SQL diretamente conforme a
  [TechSpec, seção 76](../../docs/techspec.md:2087), sem introduzir CQRS.

## Critérios de aceite

- [x] Lista sem filtros retorna manual e importado do household atual, em
  ordem estável, sem reversal duplicado.
- [x] Filtro sem categoria encontra importações recém-confirmadas e lançamentos
  manuais sem `category_id`.
- [x] Filtros de origem, review, conta, categoria, tipo, status, período e
  busca podem ser combinados sem retirar `household_id` de nenhum join.
- [x] `pageInfo.nextCursor` permite continuar a consulta sem offset e um
  cursor inválido não amplia a consulta nem vaza dados.
- [x] Cada item informa a origem; importados mostram sua linhagem e manuais
  não recebem uma linhagem importada fabricada.
- [x] Resumo de pendências concorda com o filtro `NEEDS_REVIEW` e exclui
  cancelados.
- [x] Detalhe de evento de outro tenant retorna o mesmo erro opaco de não
  encontrado usado por S03.

## Handoff

- T06 expõe list/detail/summary pelos adapters server-side.
- T08 usa `pageInfo`, `reviewState`, `source` e o resumo para a tela.
- T09 usa o detalhe genérico e o back link com os filtros/cursor atuais.
- T10 envolve a duração das queries e classifica erros esperados sem registrar
  `search` ou descrição.

## Verificações

- [x] Testes unitários de normalização de filtros, `null`, aliases, cursor,
  limites e hash de query.
- [x] Testes PostgreSQL de joins, origem, pendências, paginação, detalhe e
  isolamento.
- [x] `EXPLAIN (ANALYZE, BUFFERS)` para consulta sem filtro, review, conta/data
  e busca textual sobre o volume de T11.

## Evidências 2026-08-30

- T04-B foi implementado em `src/modules/transactions/review-reads.ts`:
  list/detail/summary usam predicates tenant-scoped, joins compostos por
  household, filtros combináveis, busca `ILIKE` escapada, cursor keyset com
  hash canônico, limite `limit + 1`, projeção de pendência e validação
  fail-closed da linhagem importada. Detalhe mantém erro opaco para
  cross-tenant/SYSTEM.
- `rtk npm test -- --run src/modules/transactions/review-reads.test.ts src/modules/transactions/review-contracts.test.ts` passou: 2 arquivos, 12 testes.
- `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test T04_INTEGRATION=1 npm exec vitest -- run --config vitest.integration.config.mts src/modules/transactions/review-reads.integration.test.ts` passou: 1 arquivo, 6 testes cobrindo lista mista, filtros/nulo/busca, cursor, detalhe, resumo e linhagem inválida.
- `rtk npm exec eslint -- src/modules/transactions/review-reads.ts src/modules/transactions/review-reads.test.ts src/modules/transactions/review-reads.integration.test.ts src/modules/transactions/index.ts` passou sem erros ou warnings.
- `rtk git diff --check` não reportou erro na evidência anterior. O typecheck global havia passado após a correção mínima dos erros diretamente atribuíveis a T04; após o alargamento de enums, a reexecução atual não tem diagnósticos nos módulos T04, mas o processo global permanece bloqueado por S06 (registrado abaixo). Não houve alteração de UI, T05 ou T06.
- A suíte opt-in de volume de T11 executou a forma SQL completa de T04 com joins tenant-safe e capturou `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` para sem filtro, `NEEDS_REVIEW`, conta/período, cursor keyset e busca. Nos quatro primeiros, o acesso a `financial_events` foi index-backed (`Index Scan` com `Limit`/sort incremental); scans auxiliares em relações de dimensão pequenas não representam full scan da fila. O caminho de busca usa `Seq Scan` em `financial_events` de forma esperada para `ILIKE '%trecho%'` sem `pg_trgm`, sem `Offset`, com execução observada de 6,607 ms no ensaio atual. A limitação fica documentada e não bloqueia o contrato de busca simples.

### Compatibilidade com os enums ampliados de S06 — 2026-08-30

- [x] Os mappers e predicates de T04 foram estreitados explicitamente para o contrato S03/S05: `EXPENSE|INCOME|REVERSAL` e `POSTED|CANCELLED`; `PURCHASE|TRANSFER|PLANNED|EXPECTED|PENDING` não vazam para os read models legados.
- [x] `rtk npm run typecheck` não reportou erros em `reads.ts` nem `review-reads.ts` após o reparo.
- [!] O gate global permanece não verde por erros fora de T04, principalmente `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts` (S06), além de diagnósticos de UI de cartões; nenhuma correção S06 foi feita nesta task.
