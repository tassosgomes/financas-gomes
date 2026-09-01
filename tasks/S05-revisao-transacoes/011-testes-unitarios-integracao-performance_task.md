# T11 — Testes unitários, integração e performance

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento — unitários S05, integrações T04/T05/T06, volume/EXPLAIN,
  lint e regressão PostgreSQL concluídos; o narrowing de enums S03/S05 foi
  revalidado, mas o typecheck global está bloqueado por S06 e a cobertura
  funcional dependente do E2E T12 permanece aberta (2026-08-30)
- Onda: 4
- Dependências: T02–T06 e T10; fixtures de S03/S04
- Paralelização: Escrita incremental durante o backend; gate final antes de T13

## Subtasks

- [x] Mapear os contratos de T02/T04/T05/T10 aos testes existentes, mantendo
  os cenários de UI/E2E de T12 fora deste gate.
- [x] Cobrir unitariamente normalização/aliases/null, origem, estado de revisão,
  busca, limite/cursor/hash, command, categoria por tipo, campos protegidos e
  projeção segura de erros/read model.
- [x] Cobrir em PostgreSQL os fluxos focados já publicados por T04/T05:
  isolamento entre households, lista mista, filtros/pêndencias/resumo,
  cursor, linhagem importada, update manual/importado, categoria nula,
  rollback e idempotência.
- [x] Executar a suíte PostgreSQL dedicada de T11 com volume sintético de
  10.000 importados + 100 manuais e auditar o cenário completo sem depender de
  T06/T08/T09.
- [x] Capturar e registrar os cinco planos `EXPLAIN (ANALYZE, BUFFERS,
  FORMAT JSON)` e medições de primeira página, pendências, conta/período,
  cursor e busca textual.
- [!] Executar a regressão completa S03/S04 e os gates globais de integração,
  lint e typecheck; a evidência histórica de integração/lint permanece válida,
  os módulos S05 não têm diagnóstico após o narrowing, mas o typecheck global
  está bloqueado por `src/db/financial-events-schema.ts` e
  `src/modules/observability/s06.ts` (S06). A reconciliação do planner com T03
  continua registrada.

## Objetivo

Provar que a fila de revisão é correta, tenant-safe, idempotente e utilizável
com volume representativo sem regredir S03/S04.

## Escopo

- Mapear cada critério de aceite de S05 para testes, distinguindo testes puros,
  PostgreSQL real, componentes e E2E de T12.
- Unitários:
  - normalização de filtros, aliases, `null`, origem, review e busca;
  - limite, cursor, ordenação e hash de filtros;
  - cálculo de `NEEDS_REVIEW`/`ORGANIZED`;
  - contrato de source manual/importado;
  - validação de command, descrição, categoria por tipo e campos proibidos;
  - mapeamento/redaction de erros.
- Integração PostgreSQL com pelo menos dois households:
  - lista combinada manual/importada e exclusão de reversals;
  - filtros individuais/combinados, sem categoria e resumo;
  - paginação sem duplicar/omitir itens em empate de data;
  - detalhe e source lineage de importação;
  - update de descrição/categoria manual e importado;
  - categoria nula, arquivada, cross-tenant e tipo incompatível;
  - retry/idempotência, rollback e preservação de amount/entry/origin/linhagem;
  - IDs, cursor, conta e categoria de outro tenant retornando erro opaco.
- Performance básica:
  - semear volume representativo baseado no extrato real (por exemplo,
    10.000 importados + lançamentos manuais, sem usar dados reais);
  - medir primeira página, `NEEDS_REVIEW`, filtro por conta/período, próxima
    página por cursor e busca textual;
  - capturar `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` em ambiente de teste;
  - evitar limite de tempo frágil dependente de CI, mas registrar orçamento,
    plano e regressões comparáveis; exigir que paginação não degrade para
    offset/full scan inesperado.
- Executar regressão das suítes S03/S04, incluindo importação, ledger,
  idempotência e isolamento.

## Critérios de aceite

- [ ] Cada critério de aceite funcional de S05 tem teste automatizado ou uma
  justificativa explícita de cobertura em T12.
- [x] Testes focados de T05 comprovam que editar um importado não remove
  `origin=IMPORT`,
  import batch, row number ou external ID.
- [x] Testes unitários e de integração de T05 comprovam que `categoryId=null`
  é aceito e volta à fila de revisão.
- [x] Testes de dois households em T04/T05 não descobrem dados, contagens,
  source ou
  cursores do outro tenant.
- [x] Testes unitários/integrados de T04 cobrem data igual, cursor inválido e
  mudança de
  filtros.
- [x] Evidência de performance e planos é registrada sem dados financeiros
  reais ou sensíveis.
- [!] Suítes unitária, integração opt-in e lint passam conforme as evidências
  registradas; o typecheck global tem bloqueio externo de S06 documentado, sem
  marcar T11 como concluída.

## Handoff

- T12 usa os fixtures/IDs e contratos de teste para o fluxo E2E.
- T13 recebe comandos, evidências de migration, planos e regressão completa.

## Verificações

- [x] `rtk npm exec vitest -- run src/modules/transactions/review-contracts.test.ts
  src/modules/transactions/review-reads.test.ts
  src/modules/transactions/review-use-cases.test.ts
  src/modules/transactions/review-adapters.test.ts
  src/modules/transactions/observability-s05.test.ts` — 5 arquivos e 37
  testes passaram.
- [x] `rtk npm run test:integration` com PostgreSQL descartável e flags da task:
  19/19 arquivos e 77/77 testes passaram após o ajuste do fixture/asserção de
  EXPLAIN compartilhado com T03.
- [x] `rtk npm exec eslint --
  src/modules/transactions/review-performance.integration.test.ts` — passou.
- [!] `rtk npm exec tsc -- --noEmit --pretty false` — nenhum diagnóstico nos
  quatro módulos S05 reparados; o processo global ainda reporta erros em
  `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts`
  (S06), além de UI de cartões.
- [x] `rtk npm run lint` global — exit 0 em 2026-08-30.

## Evidências e bloqueios — 2026-08-30

- A cobertura unitária focada passou com 37 testes e valida os contratos de
  leitura/update e a redaction de T10. As integrações T04/T05 passaram com
  11/11 testes; o preview autenticado T06 passou com 5/5.
- A suíte opt-in `src/modules/transactions/review-performance.integration.test.ts`
  passou com duas verificações, usando duas households sintéticas, 10.000
  importados + 100 manuais. No ensaio atual, as medições foram primeira página
  29,68 ms, próxima página 14,39 ms, pendências 13,56 ms e resumo 13,91 ms.
  Os cinco planos JSON foram capturados: first-page (1,179 ms), pending
  (2,194 ms), account/date (1,329 ms), keyset (3,810 ms) e search (6,607 ms).
  O caminho de `financial_events` nos quatro primeiros usou `Index Scan` com
  `Limit`/sort incremental; `Seq Scan` residual ocorre em relações auxiliares
  pequenas. A busca usa `Limit`/`Sort` com `Seq Scan` na tabela de eventos,
  esperado para `ILIKE '%...%'` sem índice textual, e não usa `Offset`.
- O teste de T03 foi tornado representativo (10.000 eventos por household,
  inserção em chunks de 500) e agora exige plano index-backed tenant/data,
  aceitando `Index Scan`/`Index Only Scan` e rejeitando `Seq Scan`. Não houve
  alteração de produto ou migration; o planner deixou de escolher full scan no
  volume do gate. A regressão PostgreSQL completa passou em 19/19 arquivos e
  77/77 testes.
- O único item T11 ainda aberto é o primeiro critério de aceite, que exige
  mapear cada critério funcional de S05 com cobertura automatizada ou
  justificativa E2E. T12 continua bloqueada por sua boundary de Server Action;
  por isso T11 permanece `Em andamento`, embora seu gate técnico de
  integração/performance esteja concluído.

### Retificação de compatibilidade de enums — 2026-08-30

- [x] A revisão de tipos dos módulos S05 confirma guards explícitos para
  `POSTED|CANCELLED` e `EXPENSE|INCOME|REVERSAL`; os estados/tipos de S06 não
  são projetados pelos readers nem aceitos pelos writes S03/S05.
- [!] O typecheck global não pode ser promovido a verde nesta rodada: os
  diagnósticos remanescentes estão fora de S05, incluindo `financial-events-schema.ts`
  e `observability/s06.ts`; nenhum arquivo S06 foi tocado.
