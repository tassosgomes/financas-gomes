# T02 — Schema, migrations e integridade de cartões, compras e parcelas

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — T02-G (integridade do aggregate e probes PostgreSQL, 2026-08-31).
- Onda: 1
- Dependências: T01, S01, S02 e S03
- Paralelização: Com T03, T04, T10 e T11; aplicação da migration é serial

## Objetivo

Criar a persistência mínima para cartão, compra, plano e schedule, mantendo o
ledger existente como fonte de verdade e impedindo referências cross-tenant,
órfãs ou valores incoerentes no PostgreSQL.

## Escopo

- Estender o schema existente somente conforme o contrato T01: enum de evento
  para `PURCHASE` e `TRANSFER`, estados necessários para entries esperados/
  publicados e demais extensões compatíveis com S03.
- Criar `credit_cards` como configuração 1:1 do `accounts` já existente, com
  `account_id`, `credit_limit_cents`, `default_payment_account_id` opcional e
  FKs compostas por `household_id`.
- Criar `credit_card_billing_rules` com `closing_day`, `due_day`,
  `effective_from`/`effective_until`, unicidade/ordenação e proteção contra
  intervalos sobrepostos conforme T01.
- Criar `credit_card_purchases` apenas como aggregate metadata/link tenant-safe
  entre o cartão, o `FinancialEvent(PURCHASE)` e o plano; não duplicar valor ou
  descrição sem necessidade.
- Criar `installment_plans` e `installments` com sequência única por plano,
  valores em `bigint`, ciclo/vencimento resolvidos, estado `PLANNED | POSTED |
  CANCELLED` e vínculo obrigatório à compra originadora.
- Se definido no T01, adicionar ao `account_entries` a relação segura com a
  parcela e os campos `expected_on`/`posted_on` necessários; evitar que uma
  linha futura entre no saldo POSTED ou que uma parcela seja somada duas vezes.
- Preservar `application_commands` e criar a allow-list/índices das operações
  de S06 sem quebrar os retries de S02–S04.
- Adicionar checks de valor positivo/inteiro, quantidade/ordem de parcelas,
  datas, estados, tipo de conta, unicidade 1:1 e soma/shape que possam ser
  garantidos no banco. Invariantes que exigem várias linhas devem ter teste de
  integração e, se necessário, trigger/transaction explícita.
- Criar índices motivados pelas leituras: household+card, billing date/cycle,
  purchase, plan+sequence, installment status e entries por conta/data.
- Não criar `credit_card_statements`, `accounts.balance`, tabela paralela de
  transações ou coluna monetária `float`.
- Gerar migration Drizzle forward-oriented, atualizar `src/db/schema.ts` e
  fixtures/seed demo sem migration automática no boot.

## Critérios de aceite

- [x] Schema e migration aplicam em banco PostgreSQL limpo e sobre S01–S03 sem
  perder dados nem relaxar constraints existentes.
- [x] Nenhum cartão, compra, plano, parcela ou entry pode apontar para outro
  `household`; FKs compostas e queries de teste comprovam o isolamento.
- [x] Uma compra parcelada não aceita N zero/negativo, sequência duplicada,
  valor zero ou relação com plano/cartão inexistente.
- [x] Não é possível apagar em cascata o histórico de conta/evento/parcela;
  `RESTRICT`/arquivamento segue a política da TechSpec.
- [x] Um cartão tem uma única configuração e regras de billing não se
  sobrepõem nem apagam a vigência usada por compras antigas.
- [x] O schema preserva os invariantes de S03: entry pertence a evento,
  amount do evento é absoluto, saldo não é armazenado e commands antigos
  continuam idempotentes.
- [x] `rtk npm run db:check:files` não acusa drift e os testes PostgreSQL
  verificam tabelas, enums, índices, FKs e checks.

## Handoff

- T05 consome os contratos de `credit_cards` e `credit_card_billing_rules`.
- T06 grava o evento, compra, plano, parcelas e entries na mesma transaction.
- T07 usa os índices por ciclo/data e não cria uma tabela de fatura.
- T08 usa `TRANSFER` e duas entries para pagamento.
- T09 usa `RESTRICT`, status e vínculo da compra para cancelamento atômico.

## Verificações

- `rtk npm run db:generate` e `rtk npm run db:check:files`.
- `rtk npm run typecheck` e lint dos módulos alterados.
- Suíte PostgreSQL descartável cobrindo migration, constraints, FKs compostas,
  unicidades, rollback e ausência de `accounts.balance`.

### Evidência T02-D (2026-08-30)

- [x] `rtk npm run db:check:files` passou sem drift.
- [x] A migration `20260830210832_outgoing_titanium_man.sql` foi aplicada no
  PostgreSQL descartável `financas_gomes_test`; o status direto do runner
  retornou `13` aplicadas, `0` pendentes e `0` divergentes.
- [x] A inspeção PostgreSQL confirmou as cinco tabelas S06 e o enum
  `installment_status=PLANNED,POSTED,CANCELLED`; os metadados publicados
  incluem, na ordem `credit_card_billing_rules`, `credit_card_purchases`,
  `credit_cards`, `installment_plans`, `installments`, 2/3/3/2/4 FKs,
  3/0/2/2/5 checks e 4/5/4/4/6 índices.
- [x] O checkpoint inicial de T02-D não comprovava isolamento cross-tenant,
  unicidades/checks por tentativa inválida, rollback atômico, ausência de
  `accounts.balance` ou preservação de dados em banco limpo; esse gap foi
  encerrado e substituído pela suíte/probe T02-G abaixo.

### Histórico do bloqueio resolvido de T02

O status anterior **Em andamento** foi encerrado por T02-G. A evidência T02-G
cobre os critérios pendentes e o schema/migration agora implementa e comprova:

- a FK reversa tenant-safe de `credit_card_purchases.installment_plan_id`
  para `installment_plans`, com ciclo materializável em transaction;
- unicidade de sequência e `RESTRICT` de parcela usando um aggregate válido;
- a suíte PostgreSQL descartável de constraints, isolamento, rollback e
  invariantes de soma/shape exigida pelos critérios.

Durante esta validação também foi corrigida a ordem da migration: os índices
únicos compostos referenciados foram criados antes das FKs compostas, pois o
PostgreSQL rejeitava a ordem gerada originalmente.

### Evidência T02-E (2026-08-30)

- [x] O ledger agora publica `PURCHASE`/`TRANSFER`, os estados
  `PLANNED`/`EXPECTED`/`PENDING` de evento e `EXPECTED` de entry; a migration
  `20260830234839_foamy_logan.sql` adiciona os valores sem alterar os já
  existentes.
- [x] `account_entries.installment_id` tem FK composta
  `(installment_id, household_id)` para `installments` com `ON DELETE RESTRICT`,
  unicidade parcial por parcela e shape explícito para `EXPECTED` versus
  `POSTED`.
- [x] `application_commands` tem allow-list dos comandos publicados de S02–S06
  e a migration instala o trigger `credit_cards_account_type_check`, que
  rejeita configuração vinculada a conta que não seja `CREDIT_CARD`.
- [x] `rtk npm run db:check:files` passou; no PostgreSQL descartável
  `financas_gomes_test`, o runner reportou `14` migrations aplicadas, `0`
  pendentes e `0` divergentes.
- [x] Um probe transacional PostgreSQL confirmou: compra `PURCHASE` manual,
  entry `EXPECTED`, FK de parcela inválida, operação S06 válida, operação fora
  da allow-list e cartão em conta não-CREDIT_CARD (os dois últimos foram
  rejeitados); a transação foi revertida ao final.

### Evidência T02-F (2026-08-30)

- [x] A migration customizada
  `20260830235612_billing-rules-no-overlap.sql` habilita `btree_gist` e cria
  `credit_card_billing_rules_no_overlap_excl` com `daterange` semiaberto,
  isolado por `household_id` e `card_id`; intervalos adjacentes são aceitos e
  sobreposição no mesmo cartão é rejeitada com `23P01`.
- [x] O probe focado `src/db/credit-cards.integration.test.ts` passou `4/4`,
  cobrindo migration/constraint, isolamento por FK composta, tipo de conta,
  unicidades, checks de valor/data/status, `EXPECTED` fora do saldo publicado,
  `RESTRICT`, rollback de evento/entry/command e ausência de `balance`,
  `transactions`, `credit_card_statements` e tipos monetários de ponto
  flutuante.
- [x] O mesmo probe passou sobre um banco PostgreSQL limpo temporário e sobre
  `financas_gomes_test`; o status do runner em teste retornou `15` aplicadas,
  `0` pendentes e `0` divergentes.
- [x] As suítes focadas S03/T02 passaram `19/19` testes; `db:check:files`
  continua sem drift.

### Evidência T02-G (2026-08-31)

- [x] A migration `20260831132300_hesitant_stature.sql` foi aplicada
  forward-only no PostgreSQL de teste; o status do runner retornou `16`
  aplicadas, `0` pendentes e `0` divergentes. A ordem cria a chave única
  `(installment_plans.id, purchase_id, household_id)` antes da FK composta e
  a FK reversa purchase→plan é `DEFERRABLE INITIALLY DEFERRED`, permitindo a
  criação atômica do aggregate sem abrir uma janela sem vínculo.
- [x] `credit_card_purchases.installment_plan_id` possui FK composta
  tenant-safe para `installment_plans`; `installments` também valida em uma FK
  de três colunas que `plan_id` e `purchase_id` pertencem ao mesmo aggregate.
  Todas as FKs S06 usam `ON DELETE RESTRICT`.
- [x] Triggers PostgreSQL rejeitam compra ligada a evento que não seja
  `PURCHASE`, alteração posterior desse kind, plano cujo total diverge do
  evento e troca de conta `CREDIT_CARD` enquanto a configuração existe.
  O check de datas de parcela foi parentizado para exigir due após fechamento
  mesmo quando há override.
- [x] A allow-list de `application_commands` inclui todas as operações
  publicadas de S06: create/update/archive de cartão, create/update de regra,
  create/update-metadata/cancel de compra e create de pagamento, sem remover
  operações de S02–S04.
- [x] `src/db/credit-cards.integration.test.ts` passou `5/5` testes: migration,
  exclusão de intervalos sobrepostos, FKs cross-tenant, aggregate válido com
  soma `10_000`, sequência duplicada, due/override inválido, trigger de tipo,
  `RESTRICT`, rollback e ausência de objetos proibidos. O probe usa transação
  descartável para não deixar fixtures persistidas; a mesma execução passou em
  banco limpo temporário e no alvo `financas_gomes_test`.
- [x] `src/db/credit-cards-schema.test.ts` passou `3/3`, incluindo metadados da
  FK reversa, FK plan/purchase e chave única necessária à referência composta;
  `rtk npm run db:check:files` continua sem drift.
- [x] `rtk npm run typecheck` passou sem diagnósticos, incluindo
  `src/db/credit-cards-schema.ts`, `src/db/financial-events-schema.ts` e
  `src/db/credit-cards.integration.test.ts`.

### Subtarefas T02-G

- [x] **T02-G1 — FK reversa e integridade do aggregate:** vínculo obrigatório
  purchase↔plan, chave composta do plano e consistência plan/purchase nas
  parcelas.
- [x] **T02-G2 — Checks/triggers cross-table:** kind `PURCHASE`, espelho de
  amount do plano, especialização da conta e due/override.
- [x] **T02-G3 — Allow-list e migração forward-only:** operações S06, ordem de
  índices/FKs e status 16/0/0 no PostgreSQL de teste.
- [x] **T02-G4 — Probe PostgreSQL:** isolamento, unicidade, `RESTRICT`,
  rollback, soma/shape, ausência de `balance`/`transactions`/statements e
  armazenamento monetário integral.

### Evidência T02-H (2026-08-31)

- [x] O probe T02-F passou a filtrar a leitura de regras pelos dois
  `household_id` dos fixtures, preservando a asserção exata das quatro regras
  esperadas e impedindo resíduos de outros tenants/execuções de contaminar o
  resultado. Não houve relaxamento de constraint ou de validação tenant-safe.
- [x] `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  T02_INTEGRATION=1 npm exec vitest run --config
  vitest.integration.config.mts src/db/credit-cards.integration.test.ts` —
  1 arquivo/5 testes aprovados, inclusive com rows residuais fora do fixture.
- [x] A execução agregada `npm run test:integration` passou 23 arquivos/93
  testes; o único skipped permanece o guard deliberado de T09 (6 testes).

## Fora de escopo

RLS completo, entidade persistida de fatura, rotativo/juros, integração com
operadora, reconciliação automática e qualquer saldo derivado armazenado.
