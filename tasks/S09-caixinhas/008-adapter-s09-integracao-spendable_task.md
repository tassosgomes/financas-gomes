# T08 — Provider `s09.v1` e integração com Spendable

- Status: Concluída — provider `s09.v1`/Spendable, reconciliação tenant-safe,
  composição server-side e prova PostgreSQL vertical aprovados em 2026-09-02.
- Onda: 2
- Dependências: T05, T06, T07 e S08 concluídas para o contrato consumido; os
  contratos de S03/S06/S07 permanecem as fontes de ledger/forecast.
- Paralelização: Preparação pura com T06 e integração final após o contrato de
  movimentos T07.

## Objetivo

Preparar a substituição do `ZeroReserveAdapter` pelo provider tenant-safe do
S09, mantendo a API e a fórmula públicas do S08 e aplicando proteção derivada
uma única vez. A composição final captura o contexto financeiro no serviço S08
e injeta o provider persistido somente no boundary server-side.

## Escopo

- Implementar a fonte server-side de `ReserveBox[]` a partir das linhas
  tenant-safe publicadas por T05/T06/T07, com status, `activeFrom`, `closedOn`
  e referências opacas. A fonte lê movimentos persistidos até `asOf` e carrega
  a lineage de despesa/refund, correção e transferência por chaves opacas.
- Conectar o provider ao serviço de Spendable pelo contrato já publicado em
  [`src/modules/spendable/reserve-adapter.ts`](../../src/modules/spendable/reserve-adapter.ts).
  O adapter não recebe `householdId`, `userId`, conta ou seleção do browser.
- Delegar ao adapter puro a derivação já contratada de
  `CONTRIBUTION - WITHDRAWAL` e `protectedAmount=max(balance,0)` por Caixinha;
  saldo negativo fica no histórico, mas não protege nem aumenta o global. Esta
  task não cria nova semântica de movimentos.
- Deduplicar contribuição, retirada, despesa ou correção já refletida por
  entry `POSTED` ou item do forecast. O ajuste de abertura líquido entra antes
  do mínimo do engine; nunca subtrair `protectedCents` novamente do resultado.
- Tratar `closedOn` efetivamente: consulta anterior preserva proteção,
  consulta na data ou depois libera proteção, sem apagar a série histórica.
- Preservar `RESTRICTED`/`EXCLUDED` fora da abertura `GENERAL`; essa filtragem
  pertence ao S08 e não pode ser substituída por uma soma household-wide no
  S09.
- Manter a serialização de centavos/datas e `status=AVAILABLE` somente quando
  a fonte estiver efetivamente disponível; erros técnicos devem ser opacos.

## Subtarefas

- [x] Preparar `ReserveBoxSource` com contexto financeiro capturado antes da
  porta e queries tenant-scoped. Evidência: `reserve-source.ts` usa somente o
  `FinancialContext` resolvido pelo servidor, pagina `BudgetReadQueries.list`
  com `status=ALL` e chama `allMovementsForBudgets` no cutoff; a porta
  `ReserveAdapterContext` não possui tenancy.
- [x] Mapear as linhas persistidas de movimentos T05/T06 para referências
  opacas, kind, centavos e datas sem enviar nome, categoria, saldo ou
  household ao S08. Evidência: `mapBudgetRowToReserveBox` e
  `reserve-source.test.ts`.
- [x] Completar o mapeamento de fontes refletidas (despesa, refund, compra,
  parcela, pagamento, correção e transferência) a partir das referências
  publicadas por T07. Evidência: `reserve-source.ts` carrega
  `sourceReferenceId`, `financialEventId`, `accountEntryId`,
  `transferReferenceId` e a lineage de correções em
  `reconciliationReferenceIds`, sem atravessar metadados; a prova vertical
  exercita despesa `POSTED`/entry, refs de compra/parcela/pagamento e par de
  transferência.
- [x] Publicar o hook de composição no serviço S08 por
  `SpendableServiceDependencies.reserveAdapter`/`reserveAdapterFactory`, sem
  alterar `s08.v1`, `spendable.v1` ou a UI. Evidência: `service.test.ts`
  confirma contexto sem `householdId` na porta e o `ZeroReserveAdapter` segue
  como fallback explícito.
- [x] Compor o provider persistido na action/serviço de produção substituindo
  o zero somente depois de T07. Evidência: `src/app/actions/spendable.ts` usa
  `createBudgetReserveAdapter` via factory após a resolução do contexto;
  `src/app/actions/spendable.test.ts` verifica a composição sem autoridade de
  tenancy no contrato S08.
- [x] Cobrir os cinco cenários normativos do handoff com dados reais
  tenant-scoped: vários aportes uma vez, retirada uma vez, saldo
  negativo/encerramento, classes de recurso e deduplicação com
  compra/parcela/pagamento/despesa. `t08.integration.test.ts` também cobre o
  critério adicional de transferência sem proteção duplicada.
- [x] Testar na camada pura histórico anterior a `closedOn`, cutoff,
  referências duplicadas, erro de contrato, paginação do source, lineage opaca
  e ausência de Caixinhas. Evidência: `reserve-adapter.test.ts` (9) e
  `reserve-source.test.ts` (8), incluindo ordenação determinística das páginas,
  Caixinhas e movimentos por referência/data.
- [x] Repetir esses cenários com PostgreSQL e os movimentos/fontes finais de
  T07. Evidência: `t08.integration.test.ts` executado contra PostgreSQL
  descartável, com 6 testes aprovados.

## Critérios de aceite

- [x] O S08 mantém resultado idêntico com o `ZeroReserveAdapter`/snapshot
  indisponível e só recebe a reserva pela porta opcional. Evidência:
  `src/modules/spendable/service.test.ts` e
  `src/modules/spendable/reserve-adapter.test.ts`.
- [x] A reserva reduz o bruto uma vez; retirada não vira também entrada de
  forecast; transferência entre Caixinhas não gera proteção duplicada.
  Evidência: os testes verticais de aportes/retirada, lineage refletida e par
  de transferência mantêm o bruto e o ajuste esperados uma única vez.
- [x] Nenhum cenário cross-tenant revela existência, saldo ou referência.
  Evidência: o cenário vertical consulta o household B após gravar somente A e
  verifica abertura própria, reserva vazia e ausência de referências A.
- [x] A preparação não cria tabela de snapshot/saldo protegido persistido;
  `reserve-source.ts` somente lê linhas T05/T06 e o adapter deriva em memória.
  A auditoria final de schema/release continua em T13/T15.
- [x] A porta pública continua sem autoridade do client e o contrato permanece
  `s09.v1` até uma mudança versionada. Evidência: teste do source e teste do
  serviço verificam contexto capturado fora da porta.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/reserve-source.ts`/adapter server-side persistido,
  exportado pelo módulo `budgets` e composto pela action S08 após T07.
- [x] Testes puros do mapeamento/adapter, composição e regressão da porta S08.
  Prova: 4 arquivos, 26 testes aprovados em 2026-09-02 (`reserve-source.test.ts`
  8, `reserve-adapter.test.ts` 9, `service.test.ts` 8 e
  `actions/spendable.test.ts` 1).
- [x] O handoff em `docs/S09-caixinhas.md` e ADR-011/ADR-012 registra owner,
  contrato, zero explícito e cenários; esta task acrescenta a evidência do
  source T05/T06 e seus limites.
- [x] Testes PostgreSQL de integração vertical S08/S09 e regressão final do
  card/breakdown com T07. Prova: 6 testes T08 verticais aprovados e regressão
  ampla S08/S09/T07 aprovada.

## Evidências executadas — 2026-09-02

- [x] `rtk npm exec vitest -- run
  src/modules/spendable/reserve-adapter.test.ts
  src/modules/budgets/reserve-source.test.ts
  src/modules/spendable/service.test.ts src/app/actions/spendable.test.ts
  --reporter=dot` — 4 arquivos, 26 testes aprovados.
- [x] A regressão de ordenação do `reserve-source` — páginas, Caixinhas e
  movimentos ficam determinísticos por referência/data — permanece aprovada
  no mesmo `reserve-source.test.ts` (8 testes).
- [x] `rtk npm exec eslint -- src/modules/spendable/reserve-adapter.ts
  src/modules/spendable/reserve-adapter.test.ts src/modules/spendable/service.ts
  src/modules/spendable/service.test.ts src/modules/spendable/t08.integration.test.ts
  src/modules/budgets/reserve-source.ts src/modules/budgets/reserve-source.test.ts
  src/app/actions/spendable.ts src/app/actions/spendable.test.ts
  --max-warnings=0` — aprovado.
- [x] `rtk git diff --check` — aprovado.
- [x] Typecheck global — `rtk npm run typecheck` passou em 2026-09-03 (exit 0)
  após correções localizadas somente nos testes externos
  (`src/components/accounts/account-form.test.tsx` e
  `src/components/forecast/forecast-money-fields.test.tsx`); nenhum erro de
  `reserve-source.ts`/teste aparece na saída.
- [x] Regressão ampla `src/modules/budgets src/modules/spendable
  src/db/budgets-schema.test.ts` — 22 arquivos, 147 testes aprovados, 26
  skipped e 1 todo; os testes de integração não opt-in permanecem pulados.
- [x] PostgreSQL vertical T08:
  `rtk env T08_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/spendable/t08.integration.test.ts --reporter=dot`
  — 1 arquivo, 6 testes aprovados; fixtures T07 e reads T05/T06 foram
  exercitados com isolamento por household.

## Pendências e handoff explícitos

- T07 está concluída para movimentos e referências publicadas; T08 consome a
  lineage opaca sem alterar a semântica dos comandos nem das fontes S03/S07.
- `ZeroReserveAdapter` continua como fallback explícito para composições que
  não fornecem S09. A action de produção injeta o source persistido somente
  após capturar o `FinancialContext`; a porta `s09.v1` não recebe
  `householdId`, `userId`, conta ou seleção do browser.
- A promoção de release e as auditorias de schema/observabilidade permanecem
  sob T13/T15; não há pendência de provider ou integração dentro de T08.

## Fora de escopo

Alterar `SpendableEngine`, criar outra fórmula de disponibilidade, persistir
saldo, adicionar conta bancária ou incluir recursos `RESTRICTED` no global.
