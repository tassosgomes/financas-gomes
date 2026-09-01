# T09 — Edição e cancelamento seguro da compra

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída no backend — contratos, actions, use cases transacionais,
  observabilidade, integração PostgreSQL, typecheck e build de manutenção
  foram validados em 2026-08-31; o smoke/release permanece downstream.
- Onda: 2
- Dependências: T01, T04 e T06
- Paralelização: Com T07, T08 e T10; fecha antes da UI de manutenção T14

## Objetivo

Permitir corrigir metadados e cancelar uma compra parcelada como unidade
indivisível, preservando histórico e neutralizando efeitos sem reescrever
silenciosamente o passado.

## Escopo

- Implementar `UpdateCreditCardPurchase` somente para campos permitidos por
  T01, como descrição, categoria e metadata não financeira. Categoria nula,
  quando permitida, deve continuar tenant-safe e compatível com o domínio.
- Rejeitar alteração direta de valor, cartão, data econômica, quantidade de
  parcelas, sequência, ciclo materializado e entries publicados; retornar
  erro `NON_EDITABLE_FIELD` ou equivalente.
- Implementar `CancelCreditCardPurchase` com lock do aggregate e uma
  transaction: marcar o evento original como `CANCELLED`, cancelar todas as
  parcelas futuras e criar apenas os efeitos compensatórios definidos no T01
  para entries já publicados.
- Preservar evento, purchase, plano, parcelas e entries históricos; nenhum
  hard delete e nenhum schedule órfão. Pagamentos de cartão já registrados
  permanecem transferências independentes.
- Garantir no máximo um cancelamento efetivo, inclusive sob concorrência e
  retry; comando incompatível não pode produzir uma segunda reversão.
- Atualizar as projections para retirar o compromisso cancelado, manter o
  histórico explicável e não criar refund/estorno implícito de operadora.
- Não expor actions para editar, pagar ou cancelar uma parcela individual.

## Critérios de aceite

- [x] Edição permitida não altera amount, entries, datas de billing ou número
  de parcelas.
- [x] Cancelar uma compra N>1 cancela o aggregate inteiro de uma vez; futuras
  deixam de comprometer faturas/limite e as já publicadas têm compensação
  conforme a política fechada.
- [x] Repetir cancelamento devolve o resultado idempotente ou conflito estável,
  sem nova reversal.
- [x] Falha no meio da operação faz rollback de status, reversal e parcelas.
- [x] O detalhe mantém a relação da compra com cada parcela e informa que a
  parcela não é uma unidade de pagamento independente.
- [x] Outro household não consegue atualizar/cancelar pelo ID da compra.
- [x] T07 não mostra parcela cancelada como obrigação ativa nem duplica o
  efeito compensatório.

## Handoff

- T14 usa os estados e ações permitidas para o detalhe do cartão/compra.
- T15 testa locks, rollback, reversal, histórico, órfãos e cross-tenant.
- T16 valida o fluxo de UI sem scripts administrativos.

## Subtarefas e evidências incrementais

- [x] T09-A — contratos Zod estritos para metadata-only e cancelamento de
  aggregate, sem `installmentId` ou campos financeiros editáveis.
- [x] T09-B — update transacional tenant-safe com hash de payload, lock do
  purchase e alteração exclusiva de descrição/categoria.
- [x] T09-C — cancelamento transacional com lock, status `CANCELLED`,
  cancelamento de parcelas `PLANNED`/`POSTED` e preservação de histórico.
- [x] T09-D — no máximo uma `REVERSAL` para os efeitos `POSTED`, com entries
  compensatórios independentes e sem apagar entries originais.
- [x] T09-E — actions e aliases públicos sem ação para parcela individual;
  observabilidade usa `credit_card.purchase.update_metadata` e
  `credit_card.purchase.cancel`.
- [x] T09-F — testes de integração PostgreSQL para rollback, concorrência,
  retry, cross-tenant, pagamento prévio e projeções T07 em
  `purchase-maintenance.integration.test.ts` (6 testes aprovados em
  2026-08-31).

## Verificações

- [x] `rtk npm exec eslint -- src/modules/credit-cards/purchase-use-cases.ts
  src/modules/credit-cards/validation.ts
  src/modules/credit-cards/purchase-actions.ts
  src/modules/credit-cards/actions.ts src/modules/credit-cards/index.ts
  src/app/actions/credit-card-purchases.ts
  src/modules/observability/s06.ts
  src/modules/credit-cards/purchase-maintenance.integration.test.ts` — sem
  erros ou warnings em 2026-08-31.
- [x] Testes de domínio/boundary para transições e campos não editáveis:
  `rtk npm test -- --run
  src/modules/credit-cards/purchase-maintenance.test.ts
  src/modules/credit-cards/purchase-validation.test.ts
  src/modules/credit-cards/validation.test.ts --reporter=dot` — 20 testes
  aprovados em 2026-08-31.
- [x] `rtk npm run typecheck` — sem diagnósticos após a correção do uso de
  `useRouter` na UI e a integração da boundary de actions em 2026-08-31.
- [x] `rtk npm run build` — compilação das actions/use cases e geração das
  rotas passaram; nenhum bloqueio histórico de reexport se reproduziu.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test
  T09_INTEGRATION=1 npx vitest run --config vitest.integration.config.mts
  src/modules/credit-cards/purchase-maintenance.integration.test.ts
  --reporter=dot` — 6 testes PostgreSQL aprovados, com migrations aplicadas,
  fixtures sintéticas de dois households, rollback/corrida/retry/reversal e
  pagamento global verificados em 2026-08-31.
- [x] Revisar o contrato das queries T07 após cancelamento: a projection
  existente filtra `installments.status = CANCELLED` e
  `financial_events.status = CANCELLED`; o teste T09-F confirma em PostgreSQL
  que a obrigação fica vazia e que o efeito compensatório não é duplicado.

## Fora de escopo

Refund parcial, refund esperado, estorno parcial de parcelamento,
redistribuição de crédito entre parcelas e correction genérica. Esses casos
pertencem ao slice de estornos/correções da TechSpec.
