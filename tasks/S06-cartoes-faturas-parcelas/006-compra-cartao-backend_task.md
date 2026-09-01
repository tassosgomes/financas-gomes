# T06 — Criação de compra à vista e parcelada

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — compra PURCHASE à vista/parcelada, schedule, entries,
  snapshots, idempotência, isolamento e rollback implementados e testados em
  PostgreSQL em 2026-08-31.
- Onda: 2
- Dependências: T02, T03, T04, T05 e S03
- Paralelização: Pode ser preparada com T07–T09; escrita final depende de T05

## Objetivo

Implementar a operação que registra uma compra no cartão como um fato
econômico único e materializa, atomicamente, o schedule necessário para a
fatura atual e as futuras.

## Escopo

- Definir `CreateCreditCardPurchase` com `commandId`, `cardId`, `amountCents`,
  `occurredOn`, descrição, categoria opcional e `installmentCount`; tenant,
  status, origem, sinais e datas derivadas nunca vêm do cliente.
- Validar cartão ativo `CREDIT_CARD`, data não futura/compatível com
  `tracking_started_on`, valor positivo, descrição, categoria de despesa do
  mesmo household e quantidade dentro do limite do contrato.
- Criar um único `FinancialEvent(kind=PURCHASE, amount_cents=total)` e a
  relação `credit_card_purchases`; para N>1 criar um único plano e exatamente
  N parcelas usando T03/T04. Tratar N=1 conforme o contrato T01 sem duplicar
  evento ou entry.
- Preservar categoria e o total econômico para o handoff de Caixinhas:
  quando S09 consumir a compra, a reserva será afetada pelo total do evento,
  nunca por cada parcela mensal.
- Congelar em cada parcela o ciclo, fechamento/vencimento e metadados da regra
  que foram resolvidos no momento da compra; não recalcular ao ler com a regra
  atual.
- Criar os `AccountEntry` do cartão conforme a política T01 para efeito à
  vista, parcelas já publicadas e compromissos futuros. A projection deve
  saber qual fonte é canônica para não somar entry e installment duas vezes.
- Persistir evento, aggregate, plano, parcelas, entries e
  `application_commands` em uma única `db.transaction()`; nenhum repository
  abre transaction independente.
- Implementar retry idempotente e concorrência segura; falha de qualquer
  insert/constraint deve deixar zero efeitos novos.
- Expor action/adapter serializável e resposta com compra, schedule e IDs
  opacos suficientes para navegar ao detalhe, sem retornar objetos de domínio.

## Critérios de aceite

- [x] Compra à vista cria um único fato econômico e aparece na competência
  calculada do cartão.
- [x] Compra parcelada de total T e N parcelas cria exatamente N itens, soma T,
  mantém sequência 1..N e vincula todos à compra correta.
- [x] Arredondamento é em centavos e deterministicamente reproduzível.
- [x] Ciclo antes/no/depois do fechamento, virada de ano e regra versionada
  produzem as datas esperadas.
- [x] Repetição do command não cria evento/plano/parcela/entry duplicados;
  payload incompatível é rejeitado.
- [x] Falha injetada no meio da gravação faz rollback completo, inclusive
  `application_commands`.
- [x] Nenhum campo de tenant, sinal, `POSTED`, `PLANNED` ou limite é confiado
  ao browser.
- [x] A criação não cria `CreditCardStatement` persistida, `accounts.balance`
  ou uma despesa manual paralela.

## Handoff

- T07 consome purchase/plan/installments para construir faturas e obrigação.
- T09 usa o aggregate e locks para editar/cancelar sem órfãos.
- T13 usa a resposta serializável para mostrar a prévia do schedule.
- T15 verifica atomicidade, isolamento, idempotência e invariantes do ledger.

## Verificações

- Unitários do command e integration tests em PostgreSQL com cartão, categoria,
  datas e valores sintéticos.
- Casos de rollback, double submit, dois households e regra alterada depois da
  compra.
- `rtk npm run typecheck`, lint e `rtk npm test -- --run` focado no módulo.

## Subtarefas e evidências

- [x] **T06-A1 — Contrato e boundary**: `contracts.ts`/`validation.ts`
  definem `CreateCreditCardPurchase`, descrição normalizada, centavos,
  categoria opcional, quantidade 1–120, override civil e rejeição de campos
  tenant/ledger; `purchase-validation.test.ts` cobre os casos inválidos.
- [x] **T06-A2 — Agregado e datas**: `purchase-use-cases.ts` usa
  `resolveBillingCycle`/`generateInstallmentSchedule`, congela regra/ciclo/
  fechamento/vencimento e divide centavos com remainder determinístico.
- [x] **T06-A3 — Transaction e ledger**: uma `db.transaction()` grava evento
  `PURCHASE` único, purchase↔plan, N installments e N entries negativos
  `EXPECTED`/`POSTED`, sem statement persistida ou saldo paralelo.
- [x] **T06-A4 — Idempotência e tenancy**: `application_commands` é reservado
  por household/command/payload, retry devolve `result` original e IDs de outro
  household são tratados como `CARD_NOT_FOUND`.
- [x] **T06-A5 — Observabilidade**: create passa por
  `withS06CreditCardObservability` com operação/stage/IDs opacos e sem payload
  financeiro.
- [x] **T06-A6 — Testes PostgreSQL**:
  `purchase-use-cases.integration.test.ts` passou 4/4 (evento único, N=3 e
  arredondamento, retry/COMMAND_ID_REUSED, cross-tenant e rollback completo).
- [x] **T06-A7 — Gate de compatibilidade T06/T09 (2026-08-31)**: o erro de
  tipo causado por atribuir ao mesmo builder as variantes com/sem
  `.for("update")` foi corrigido usando consultas condicionais com o mesmo
  predicado tenant-safe. A porta do factory também expõe explicitamente
  `create`, `update` e `cancel`, preservando o contrato T06 e habilitando T09;
  `rtk npm run typecheck` não reporta mais erros em `purchase-use-cases.ts`.

## Evidência do gate T15

- [x] `rtk npm run typecheck` — a correção eliminou os diagnósticos reportados
  nas linhas ~433/~790 de `purchase-use-cases.ts` em 2026-08-31.
- [x] `rtk npm exec eslint -- src/modules/credit-cards/purchase-use-cases.ts`
  — sem erros ou warnings em 2026-08-31.
- [x] `rtk npm run build` — o build atual compilou o bundle e as rotas sem
  diagnósticos em `purchase-use-cases.ts` ou `projections.ts`; a verificação
  foi repetida após T14 em 2026-08-31.

## Fora de escopo

Realização automática futura por job, compra em moeda estrangeira, compra
recorrente, reconciliação do emissor, juros/rotativo e refund parcial.
