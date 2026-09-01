# T07 — Projections de fatura, obrigação, limite e saldo credor

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída tecnicamente — readers tenant-safe, projections canônicas,
  pagamentos globais T08, actions, observabilidade T10 e testes
  unitários/PostgreSQL verificados em 2026-08-31; build global atual também
  está verde.
- Onda: 2
- Dependências: T02, T03, T04, T05 e T06
- Paralelização: Com T08 e T09 após o contrato de purchase; prepara T14 e S07

## Objetivo

Entregar leituras tenant-safe que expliquem o cartão sem reduzir todos os
conceitos a um único “saldo de cartão”.

## Escopo

- Implementar funções explícitas, sem `getCreditCardBalance()` genérico:
  `getCurrentStatementAmount`, `getProjectedStatementAmount`,
  `getOutstandingCardObligation`, `getAvailableCreditLimit` e
  `getCardCreditBalance`, ou nomes equivalentes fechados em T01.
- Construir projection de fatura por período/ciclo com itens de compra à vista
  e parcelas cujo ciclo vence no período; incluir referência à compra, número
  da parcela, data, valor, estado projetado/confirmado e origem suficiente para
  drill-down.
- Separar fatura atual, próxima fatura, parcelas futuras, obrigação
  contratual, limite comprometido, limite disponível, posição corrente do
  cartão e saldo credor. Aplicar a fórmula de T01 sem somar o evento total com
  seus itens.
- Derivar estado de pagamento da fatura a partir de entries/transferências
  globais do cartão conforme o contrato; não alocar artificialmente pagamento
  a uma parcela e não exigir `statementId`.
- Excluir compras/parcelas canceladas, preservar histórico consultável e
  diferenciar `PLANNED`, `POSTED` e `CANCELLED` sem inventar `PAID`.
- Permitir consultar qualquer competência futura suportada pelo domínio,
  incluindo virada de ano, e filtrar por cartão/household/período.
- Otimizar SQL/Drizzle para os índices T02, manter shape serializável e evitar
  acesso client-side direto ao banco. Preparar `referenceId` para S07.

## Critérios de aceite

- [x] Compra à vista aparece uma vez na fatura correta.
- [x] Uma compra N aparece uma vez em cada ciclo devido e exatamente N vezes
  no conjunto completo; o total econômico não é repetido na fatura.
- [x] Fatura atual não é apresentada como obrigação total; parcelas futuras
  não são omitidas nem misturadas com o valor já publicado.
- [x] Limite comprometido/disponível segue a regra do contrato e saldo credor
  é exibido separadamente, sem aumentar silenciosamente o limite contratual.
- [x] Pagamento parcial, total, maior que a dívida e pagamento fora de ordem
  produzem estados explicáveis sem marcar parcela como paga.
- [x] Cancelamento de compra remove apenas o impacto futuro/corrente previsto
  e não deixa item órfão ou duplicado.
- [x] Query com ID/período de outro household retorna ausência, nunca dados.
- [x] Mesmos dados produzem o mesmo resultado e as consultas não criam
  entidades de fatura persistidas.

## Subtarefas e evidências

- [x] **T07-A — Contrato de leitura:** adicionados
  `CreditCardStatementItemReadModel`, `CreditCardStatementReadModel`,
  `CreditCardProjectionSummaryReadModel`, `CreditCardProjectionReadModel` e
  `CreditCardProjectionQuery`, todos com centavos/datas serializáveis e
  `referenceId` para S07.
- [x] **T07-B — Query de fatura:** `projections.ts` agrupa somente parcelas
  ativas por competência, preserva purchase/installment/event para drill-down,
  diferencia `PROJECTED`/`CONFIRMED` e suporta competência sem itens e virada
  de ano.
- [x] **T07-C — Comprometimento/limite/crédito:** agregadores usam `bigint`,
  calculam obrigação bruta/líquida, parcelas futuras, posição publicada,
  limite comprometido/disponível e saldo credor sem somar evento/entry/parcela.
- [x] **T07-D — Pagamento global T08:** transferências `TRANSFER` são lidas
  somente pela entry positiva do cartão, em ordem de vencimento, sem
  `statementId`, `installmentId` ou mutação de parcela; parcial/total/crédito
  têm estado determinístico.
- [x] **T07-E — Boundary/observabilidade:** actions server-side, aliases de
  módulo e `withS06CreditCardObservability`/`measureS06Query` foram integrados;
  testes unitários e PostgreSQL cobrem isolamento e não-duplicidade.

### Evidência do checkpoint — 2026-08-31

- Alterações efetivadas: `contracts.ts`, `projections.ts`,
  `projection-actions.ts`, `src/app/actions/credit-card-projections.ts`,
  exports e testes de projection.
- Verificações: 3 testes unitários de agregação e 4 testes PostgreSQL passaram;
  typecheck, lint focado e `db:check:files` passaram.

## Handoff

- T08 precisa saber quais entries de transferência entram no cálculo global.
- T09 precisa dos read models para verificar que cancelamento neutralizou o
  comprometimento.
- T14 renderiza os três níveis de fatura e o breakdown.
- S07 consome itens futuros sem conhecer tabelas internas.

## Verificações

- Testes unitários dos agregadores e testes de leitura com compra 1x, 3x, mês
  sem itens, vários cartões e mudança de ano.
- Integration PostgreSQL para isolamento, cancelamento, pagamentos,
  não-duplicidade e planos com rounding.
- Medir/examinar as queries principais com volume sintético representativo;
  usar `EXPLAIN ANALYZE` somente se necessário para justificar índices.

### Evidência executada — 2026-08-31

- [x] `rtk npx vitest run src/modules/credit-cards/projections.test.ts
  --config vitest.config.mts --reporter=dot` — 3 testes aprovados: alocação
  global por vencimento, overpayment/crédito e determinismo.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test
  T07_INTEGRATION=1 npx vitest run --config
  vitest.integration.config.mts
  src/modules/credit-cards/projections.integration.test.ts --reporter=dot` —
  4 testes aprovados em PostgreSQL descartável, incluindo 3 parcelas,
  rounding, pagamento parcial, overpayment, competência `2027-01` vazia e
  isolamento entre households.
- [x] `rtk npm exec eslint -- src/modules/credit-cards/projections.ts
  src/modules/credit-cards/projections.test.ts
  src/modules/credit-cards/projections.integration.test.ts
  src/modules/credit-cards/projection-actions.ts
  src/app/actions/credit-card-projections.ts` — sem erros ou warnings.
- [x] `rtk npm run typecheck` e `rtk npm run db:check:files` — concluídos sem
  diagnósticos/divergências após a implementação.
- [x] `rtk npm run build` — compilação, typecheck e geração das rotas passaram
  após a correção da boundary de actions; a rota de detalhe T14 também foi
  gerada sem falha em 2026-08-31.
- [x] `rtk npm run lint` — passou sem warnings; os diagnósticos históricos de
  `financial-events-schema.ts`/`transactions/reads.ts` não se reproduzem na
  execução atual.

## Fora de escopo

Forecast probabilístico, S07 completo, spendable, reconciliação automática,
rotativo, juros e persistência de uma entidade `CreditCardStatement`.
