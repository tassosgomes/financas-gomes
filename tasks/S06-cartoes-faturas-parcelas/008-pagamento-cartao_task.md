# T08 — Pagamento de cartão como transferência

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída tecnicamente — contratos, validação, transferência
  ledger/idempotência, Server Action, wrapper T10, integração PostgreSQL e
  projeção T07 verificados em 2026-08-31; smoke/release permanecem downstream.
- Onda: 2
- Dependências: T01, T02, T05 e S03
- Paralelização: Com T06, T07, T09 e T10; integração de estado depende de T07

## Objetivo

Registrar o pagamento da fatura no ledger sem transformar liquidação de dívida
em nova despesa e sem criar uma falsa operação de pagamento de parcela.

## Escopo

- Implementar `RegisterCreditCardPayment` com `commandId`, cartão, conta de
  origem, valor positivo, data e descrição opcional; não aceitar
  `statementId`, `installmentId`, tenant, sinais ou status do cliente.
- Validar cartão e conta de origem ativas, mesmo household, conta de origem
  adequada à regra de T01, data dentro das âncoras e valor em centavos.
- Criar um único evento `TRANSFER` e exatamente duas entries: origem negativa
  e cartão positiva, com soma zero. Usar uma transaction única e o mesmo
  mecanismo de idempotência do ledger.
- Permitir pagamento maior que a obrigação e representar o saldo credor na
  projection; não limitar silenciosamente ao valor da fatura.
- Fazer a leitura de fatura reconhecer pagamentos globais e estados parcial/
  total/credor sem repartir o pagamento entre parcelas.
- Expor Server Action fina com erros estáveis; mensagens não podem revelar se
  um cartão/conta de outro household existe.
- Preparar a operação para futura transferência genérica sem implementar uma
  tela de transferências fora do escopo deste slice.

## Critérios de aceite

- [x] Pagamento reduz a posição devedora do cartão e reduz a conta de origem;
  não cria `EXPENSE`, categoria ou movimento de Caixinha.
- [x] A transferência possui exatamente duas entries do mesmo household e
  soma zero; falha parcial faz rollback.
- [x] Retry do mesmo command não duplica evento/entries e reuso incompatível é
  rejeitado.
- [x] Pagamento não muda o status individual de qualquer installment e a UI
  não oferece essa ação.
- [x] Overpayment é permitido e aparece como crédito separado do limite
  contratual; pagamento em data/conta inválida retorna erro acionável.
- [x] Cross-tenant e cartão arquivado não podem ser usados.

## Subtarefas e evidências

- [x] **T08-A1 — Contrato serializável**: `contracts.ts` publica
  `RegisterCreditCardPaymentCommand`, `CreditCardPaymentReadModel` e
  `credit_card.payment.create`, sem `statementId`, `installmentId`, tenant,
  status ou sinais no command.
- [x] **T08-A2 — Boundary/guards**: `validation.ts` normaliza UUIDv7, centavos,
  data civil e descrição opcional; a conta de origem é tenant-scoped, ativa,
  não-cartão e distinta da conta do cartão.
- [x] **T08-A3 — Ledger atômico**: `use-cases.ts` reserva `application_commands`
  no mesmo `db.transaction()`, grava um `TRANSFER` `MANUAL`/`POSTED` e duas
  entries sem installment, com origem negativa, cartão positiva e soma zero.
- [x] **T08-A4 — Money/shape**: `payments.ts` deriva sinais, rejeita
  auto-pagamento e verifica duas entries com soma `bigint` zero.
- [x] **T08-A5 — Action/observabilidade**: a Server Action expõe pagamento
  global e o use case passa pelo wrapper T10 sem payload financeiro.
- [x] **T08-A6 — Testes focados**: `payment.test.ts` cobre command estrito,
  campos proibidos, centavos, isolamento da conta e shape/soma da transferência.
- [x] **T08-A7 — Integração/projeção**: PostgreSQL real e projeção T07 foram
  verificados no `use-cases.integration.test.ts` (pagamento) e em
  `projections.integration.test.ts` (partial/overpayment/crédito, sem mutar
  installment); rollback/idempotência e cross-tenant estão registrados em T15.

## Handoff

- T07 incorpora transferências no estado derivado da fatura.
- T14 expõe formulário de pagamento global e o crédito resultante.
- T15/T16 cobrem pagamento parcial, integral, maior que a dívida, retry e
  isolamento.

## Verificações

- Unitários de validação e adapters.
- PostgreSQL real para duas entries, trigger/constraint de transferência,
  rollback, idempotência e cross-tenant.
- Reconciliar a projection T07 antes/depois do pagamento usando somente ações
  de domínio, sem editar banco por script no fluxo E2E.

## Evidência desta etapa — 2026-08-31

- [x] `rtk npm test -- --run src/modules/credit-cards/payment.test.ts
  --reporter=dot` — 1 arquivo e 5 testes aprovados.
- [x] `rtk npm test -- --run src/modules/observability/s06.test.ts
  src/modules/observability/sanitize.test.ts
  src/modules/credit-cards/payment.test.ts --reporter=dot` — 3 arquivos e
  21 testes aprovados.
- [x] Lint focado dos arquivos T08 — sem erros ou warnings.
- [x] `rtk npm run typecheck` — sem diagnósticos na execução atual após T14;
  não há conflito `.next`/`.next-e2e` reproduzido.
- [x] PostgreSQL/T08_INTEGRATION e projeção T07 — um cenário de pagamento e
  quatro de projection foram aprovados no gate T15; T17 continua somente como
  validação de release.

## Fora de escopo

Parcelamento da fatura, rotativo, juros, multa, conciliação automática,
pagamento isolado de parcela e alocação do pagamento a um statement específico.
