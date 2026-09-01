# T04 — Integridade de tenant e referências

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — acesso tenant-scoped, validação de referências e integração PostgreSQL verificadas em 2026-08-29.
- Onda: 2
- Dependências: T03, S01 e S02
- Paralelização: Pode ser desenvolvida em paralelo com a preparação de T05 e T06

## Objetivo

Garantir que toda operação manual use o espaço financeiro da sessão e só aceite referências válidas para o lançamento.

## Escopo

- Reutilizar `requireFinancialContext()`/helper equivalente; nenhum command recebe tenant confiado pelo browser.
- Criar funções de acesso tenant-scoped para conta, categoria, evento e entry.
- Validar conta:
  - pertence ao tenant atual;
  - está ativa para novos lançamentos;
  - respeita `tracking_started_on` para a data do entry.
- Validar categoria:
  - pode ser nula;
  - pertence ao tenant atual;
  - está ativa;
  - `EXPENSE` para despesa e `INCOME` para receita;
  - não é tratada como conta ou caixinha neste slice.
- Garantir que queries por ID retornem “não encontrado” quando o registro pertence a outro tenant, sem vazar sua existência.
- Cobrir no banco e na aplicação as FKs compostas e a tentativa de forjar `accountId`, `categoryId` ou `eventId`.
- Padronizar erros de referência para a camada de UI.

## Critérios de aceite

- [x] O tenant usado em cada write vem da sessão.
- [x] Conta de outro tenant não pode ser usada mesmo que o ID seja conhecido.
- [x] Categoria de outro tenant, inativa ou de tipo incompatível é rejeitada.
- [x] Entry anterior a `tracking_started_on` é rejeitado.
- [x] Falha de validação não cria evento, entry ou command parcial.
- [x] Há integração negativa contra PostgreSQL real para isolamento cross-tenant.

## Subtarefas e evidências

- [x] Criado [`references.ts`](../../src/modules/transactions/references.ts)
  com acessos tenant-scoped para conta, categoria, evento e entry; toda query
  por ID combina o ID com `household_id` do contexto.
- [x] Reutilizado `withFinancialContext`/`assertFinancialContext`: a fachada
  pública resolve o contexto pela sessão e os helpers internos recebem apenas
  o contexto validado, sem aceitar tenant em commands.
- [x] Integrados os validadores de T02 para conta ativa, categoria opcional
  ativa e compatível com `EXPENSE`/`INCOME`, e `tracking_started_on`; IDs
  ausentes ou cross-tenant usam os erros opacos `*_NOT_FOUND`.
- [x] Adicionados helpers de insert que derivam `householdId` do contexto e
  sobrescrevem tentativas de adulteração antes do INSERT; FKs compostas de
  T03 continuam sendo a segunda barreira no PostgreSQL.
- [x] Criado [`references.test.ts`](../../src/modules/transactions/references.test.ts)
  para contexto obrigatório, mapeamento de erro e fachada tenant-scoped.
- [x] Criado [`references.integration.test.ts`](../../src/modules/transactions/references.integration.test.ts)
  com dois households, contas/categorias em estados distintos, eventos e
  entries; cobre isolamento por ID, data de acompanhamento, estado/tipo de
  categoria, inserts adulterados, FKs cross-tenant e ausência de registros
  parciais após falha de validação.

## Verificações

- [x] `npm run typecheck`: concluído sem erros.
- [x] ESLint focado em `src/modules/transactions/references.ts`, testes e
  `index.ts`: concluído sem warnings/erros.
- [x] `npm test`: 171 testes passaram; 25 testes de integração foram pulados
  por dependerem do ambiente opcional.
- [x] `DATABASE_URL=... MIGRATION_DATABASE_URL=... T04_INTEGRATION=1 npm
  test -- --run src/modules/transactions/references.integration.test.ts
  --config vitest.integration.config.mts`: 3 testes passaram em PostgreSQL
  16 real.
- [x] Execução combinada com T03 (`T03_INTEGRATION=1 T04_INTEGRATION=1`):
  7 testes passaram, confirmando migration/FKs do ledger e isolamento da
  camada de aplicação.
- [x] `npm run db:check:files`: concluído sem divergências; T04 não adiciona
  migration além das constraints compostas entregues por T03.
