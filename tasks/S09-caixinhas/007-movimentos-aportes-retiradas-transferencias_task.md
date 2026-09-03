# T07 — Aportes, retiradas e transferências

- Status: Concluída — movimentos, reconciliação e integração vertical com o
  provider `s09.v1` aprovados em 2026-09-02.
- Onda: 2
- Dependências: T02, T03, T04, T05 e T06
- Paralelização: Com T08 após o contrato do provider, T09 e T13

## Objetivo

Persistir movimentações auditáveis que alteram a reserva, incluindo aportes,
retiradas, correções e transferências entre Caixinhas, sem sobrescrever saldo.

## Escopo

- Implementar `RegisterContribution`, `RegisterWithdrawal` e a operação de
  transferência entre duas Caixinhas ativas, com amount positivo e referência
  opaca única por movimento.
- Validar vigência, status, datas e origem; permitir saldo negativo conforme a
  TechSpec/handoff, exibindo o estado em vez de fabricar uma proteção positiva.
- Gravar pares de transferência atomicamente: retirada na origem e aporte no
  destino, mesmo household, sem criar receita/despesa ou movimento bancário.
- Aplicar a regra de distribuição automática de receita realizada definida em
  T01/T04, com arredondamento determinístico, referências de origem e
  idempotência. Não distribuir receita apenas planejada sem a decisão explícita
  do contrato.
- Relacionar retiradas/despesas/refunds a referências de FinancialEvent ou
  ForecastItem quando aplicável, para que a mesma realidade não seja devolvida
  também pelo provider de reserva.
- Corrigir ou desfazer um movimento por novo movimento compensatório e manter
  a trilha de origem; não editar/deletar silenciosamente movimento publicado.
- Envolver escrita, command record e qualquer distribuição em uma transaction.

## Subtarefas

- [x] Criar schemas Zod e commands serializáveis com limites de amount/data.
- [x] Implementar use cases e repositórios de movimentos, incluindo origem,
  correção e transferência atômica.
- [x] Implementar idempotência por `(household_id, commandId)` e unicidade de
  referência; retry com payload diferente deve falhar fechado.
- [x] Integrar aportes automáticos e reconciliação de realização sem duplicar
  forecast, ledger, parcela, compra ou pagamento. Evidência vertical em T08:
  `reserve-source.ts` preserva a lineage opaca publicada por T07 e o provider
  deduplica despesa `POSTED`/entry, refs de compra/parcela/pagamento e o par de
  transferência antes do ajuste do Spendable.
- [x] Atualizar read models/revalidate paths e produzir feedback seguro para a
  UI de T12.
- [x] Testar rollback de uma distribuição parcial ou transferência inválida.

## Critérios de aceite

- [x] Múltiplos aportes e retiradas produzem saldo derivado correto, sem campo
  mutável de saldo.
- [x] Uma transferência entre Caixinhas altera a origem e o destino uma única
  vez, não altera o saldo bancário e não cria uma despesa.
- [x] Retry idêntico retorna o mesmo resultado; command ou referência
  reutilizada com dados diferentes não duplica nem corrompe o histórico.
- [x] Movimentos já refletidos em `POSTED`/forecast são identificáveis pelo
  provider e não reduzem/aumentam Spendable duas vezes. Evidência: T08
  PostgreSQL vertical cobre refs de evento/entry, forecast e lineage de
  transferência, mantendo o ajuste de abertura e o bruto uma única vez.
- [x] Falha no meio da operação deixa zero linhas parciais e não grava comando
  como concluído quando a transaction falha.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/movements.ts`/use cases e contratos públicos.
- [x] Actions para aporte, retirada e transferência.
- [x] Testes de domínio/boundary, integração PostgreSQL de atomicidade,
  idempotência, referências e isolamento.
- [x] Fixtures de movimentos consumíveis por T08, T13 e T14.

## Fora de escopo

Transferência bancária, conta separada, investimento, rendimento e pagamento de
cartão. A transferência aqui é somente entre Caixinhas.

## Evidências executadas — 2026-09-02

- [x] `rtk npm exec vitest -- run src/modules/budgets/movements.test.ts
  src/modules/budgets/movement-actions.test.ts src/modules/budgets/reads.test.ts
  src/db/budgets-schema.test.ts --reporter=dot` — 4 arquivos, 24 testes
  aprovados. Cobre os limites da boundary, sinais/validação de vigência,
  transferência/correção/distribuição pura, actions tenant-safe, revalidate e
  reads/linhagem.
- [x] `rtk env T07_INTEGRATION=1
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  npm exec vitest -- run --config vitest.integration.config.mts
  src/modules/budgets/movements.integration.test.ts --reporter=dot` — 1
  arquivo, 6 testes PostgreSQL aprovados. Cobre saldo derivado, referências
  de evento/entry, isolamento cross-tenant, par de transferência sem
  evento/lançamento, retry/colisão de command e referência, correção
  append-only, distribuição determinística/realizada, rejeição de receita
  planejada e rollback integral de transferência/distribuição.
- [x] `rtk npm exec vitest -- run src/modules/budgets
  src/db/budgets-schema.test.ts --reporter=dot` — regressão T02–T07/T13:
  11 arquivos, 75 testes aprovados; 13 testes de integração opt-in pulados.
  A expectativa do manifesto T13 foi atualizada para a fixture
  `movement-commands`.
- [x] `rtk npm exec eslint -- src/modules/budgets/movements.ts
  src/modules/budgets/contracts.ts src/modules/budgets/service.ts
  src/modules/budgets/movements.test.ts
  src/modules/budgets/movement-actions.test.ts
  src/modules/budgets/movements.integration.test.ts
  src/modules/budgets/movement-fixtures.ts
  src/modules/budgets/t13-domain-allocation.test.ts src/db/budgets-schema.ts
  src/app/actions/budgets.ts src/modules/budgets/index.ts --max-warnings=0` —
  aprovado; `rtk git diff --check` — aprovado.
- [x] `rtk npm exec tsc -- --noEmit --pretty false --incremental false` — passou
  em 2026-09-03 (exit 0) após correções localizadas somente nos testes
  externos `account-form.test.tsx` e `forecast-money-fields.test.tsx`. Nenhum
  erro de T07 foi reportado.

- [x] `rtk env T08_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/spendable/t08.integration.test.ts --reporter=dot` — 1 arquivo, 6 testes
  PostgreSQL aprovados; comprova o consumo vertical dos movimentos T07,
  reconciliação por evento/entry/forecast e isolamento cross-tenant.

## Gate explícito / handoff

O provider `s09.v1`/Spendable foi integrado por T08 e a deduplicação vertical
contra ledger/forecast, compra, parcela, pagamento e transferência está
comprovada. T07 publica as referências `financialEventId`, `accountEntryId` e
`sourceReferenceId`, preserva a trilha append-only e fornece as fixtures para
esse consumo; não implementa UI. O typecheck global foi marcado após a
execução verde de 2026-09-03; as correções ficaram restritas aos testes
externos descritos acima.
