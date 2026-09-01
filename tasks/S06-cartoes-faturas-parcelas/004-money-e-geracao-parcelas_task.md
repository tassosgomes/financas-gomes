# T04 — Money, divisão exata e agregado de parcelas

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — aggregate puro, schedule determinístico e invariantes verificados em 2026-08-31.
- Onda: 1
- Dependências: T01 e T03
- Paralelização: Pode ser desenvolvida em paralelo à migration T02; integração final em T06

## Objetivo

Representar uma compra parcelada como um agregado pequeno e puro, garantindo
que o schedule seja determinístico, exato e impossível de confundir com N
compras independentes.

## Escopo

- Reutilizar `Money`/`bigint` de S03 para aceitar valores positivos em
  centavos, sem conversão por `number` ou float.
- Implementar divisão inteira com remainder distribuído deterministicamente a
  partir das primeiras parcelas: para R$ 100 em 3, `3334, 3333, 3333` centavos.
- Garantir `N >= 1`, limite operacional explícito e testado, total positivo e
  `SUM(installments.amount_cents) = purchase.amount_cents`.
- Gerar sequência 1..N, data/ciclo/vencimento via T03 e snapshot imutável da
  regra necessária para explicar a parcela no futuro.
- Diferenciar N=1/à vista de N>1 sem duplicar fato econômico; se o contrato
  uniformizar N=1 em plano, manter a mesma invariável e o mesmo vínculo.
- Modelar transições `PLANNED`, `POSTED`, `CANCELLED` e rejeitar `PAID` ou
  qualquer operação que pague/edite uma parcela isoladamente.
- Fornecer funções de soma, saldo futuro, parcelas remanescentes e cancelamento
  do aggregate sem acesso a Drizzle/PostgreSQL.

## Critérios de aceite

- [x] Totais que não dividem exatamente e valores grandes permanecem exatos.
- [x] Remainder é sempre alocado pela mesma ordem e a soma nunca muda o valor
  da compra.
- [x] Schedule tem exatamente N itens, sem sequência faltante/duplicada, e
  cada item aponta para o plano/compra corretos.
- [x] Datas de todas as parcelas avançam corretamente pelos meses/anos,
  inclusive quando o ciclo inicial está no fim do mês.
- [x] Estado cancelado remove a parcela da obrigação futura, mas não apaga a
  linha histórica nem cria a semântica de parcela paga.
- [x] Testes cobrem 1, 2, 3 e N alto permitido, remainder, overflow,
  cancelamento e invariantes de aggregate.

## Subtarefas e evidências

- [x] T04-A — reutilizar `Money` de S03 e publicar `allocateInstallments` em
  `bigint`, com limite explícito de 1–120 e teto de `BIGINT` sem conversão
  monetária para `number`/float.
- [x] T04-B — publicar `generateInstallmentSchedule`/`createInstallmentPlan`
  como aggregate imutável com vínculo `planId`/`purchaseId`, sequência
  contígua, soma exata e snapshot de billing por parcela.
- [x] T04-C — avançar ciclos por `PlainYearMonth`/helpers de T03, incluindo
  virada dezembro→janeiro, fim de mês e override somente na parcela
  autorizada; regra futura não reinterpreta o schedule materializado.
- [x] T04-D — modelar `PLANNED → POSTED` e cancelamento do aggregate
  `PLANNED/POSTED → CANCELLED`, mantendo histórico e bloqueando
  `PAID`/pagamento, edição ou cancelamento individual.
- [x] T04-E — publicar somas, saldo futuro, parcelas remanescentes,
  serialização explícita de centavos e validação de invariantes; barrel
  `src/modules/credit-cards/index.ts` exporta o contrato para os consumidores.
- [x] T04-F — adicionar `src/modules/credit-cards/installments.test.ts` com
  14 testes para 1x/2x/3x, N=120, remainder, valores grandes, overflow,
  ciclos/fim de mês, override, cancelamento, estados proibidos e agregados
  corrompidos.
- [x] T04-G — selecionar regra versionada por `occurredOn`, comparar aliases
  `Money`/datas por valor civil e rejeitar snapshots ou estados de aggregate
  inconsistentes antes de expor somas/read models.

## Handoff

- T06 usa o aggregate para criar compra e schedule na transaction.
- T07 usa funções de parcelas remanescentes e não soma o evento total junto
  com cada parcela.
- T09 cancela o aggregate inteiro e não expõe mutation de item individual.
- T15 reutiliza os mesmos casos puros na suíte de integração.

## Verificações

- [x] `rtk npm test -- --run src/modules/credit-cards/installments.test.ts` —
  1 arquivo e 14 testes passaram em 2026-08-31.
- [x] `rtk npm exec eslint -- src/modules/credit-cards/installments.ts
  src/modules/credit-cards/installments.test.ts src/modules/credit-cards/index.ts`
  — sem erros ou warnings.
- [x] `rtk git diff --check` — sem whitespace inválido.
- [x] Invariantes unitárias verificam soma `bigint`, cardinalidade, sequência,
  vínculos, estados e determinismo; nenhum teste usa `Date`, float ou
  timezone.
- [x] `rtk npm run typecheck` — concluído sem diagnósticos em 2026-08-31;
  não há diagnóstico em `src/modules/credit-cards/installments.ts` ou seus
  testes.

## Fora de escopo

Parcelamento da fatura, juros, rotativo, refund parcial e redistribuição de um
estorno entre parcelas. Esses comportamentos exigem o slice de correções.
