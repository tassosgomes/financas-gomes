# T04 — Vigência, alocação e regras temporais

- Status: Concluída — regras temporais, alocação, fontes financeiras e
  transição de fechamento foram comprovadas em testes puros e na matriz
  PostgreSQL vertical de T05/T07/T08/T13/T15; a reconciliação por alias de
  evento/compra foi reforçada e regressada em 2026-09-03.
- Onda: 1
- Dependências: T01 e T02; persistência final de T03 para integração
- Paralelização: Com T03, T09 e T10; regras puras podem começar antes da migration

## Objetivo

Implementar as políticas de tempo e distribuição que fazem a Caixinha
preservar histórico, acumular recursos e refletir receitas/despesas sem
reinterpretar o passado.

## Escopo

- Resolver a regra de alocação aprovada em T01: representação, vigência,
  arredondamento, soma de distribuição e ausência de configuração.
- Aplicar distribuição automática somente ao evento de receita realizado que o
  contrato definir; preservar o planejado e não alocar novamente uma realização
  reconciliada.
- Criar/validar versões de regra com `effectiveFrom`/`effectiveUntil`, sem
  sobrescrever uma regra usada em período anterior.
- Resolver a Caixinha/categoria vigente na data econômica da despesa. Uma
  compra parcelada reduz a Caixinha pelo valor econômico total, e não parcela a
  saída mensalmente.
- Aplicar refunds pela data efetiva do estorno, mantendo relação com o evento
  original para explicação e sem exceder o gasto corrigido.
- Derivar aporte sugerido para meta/data-alvo conforme PRD, sem transformar
  sugestão em compromisso ou item de forecast automaticamente.
- Definir e testar a transição de caixa ativa para encerrada, rollover e
  alterações retroativas que exigem reprocessamento/aviso.

## Subtarefas

- [x] Implementar resolvers puros de regra vigente, associação de categoria e
  escolha da Caixinha mais específica quando o contrato exigir.
- [x] Implementar distribuição em centavos com remainder determinístico e
  reconciliação exata ao valor de origem.
- [x] Implementar fontes de gasto líquido e refund com referências opacas;
  impedir a soma concorrente de compra, parcela e pagamento.
- [x] Cobrir virada de mês/ano, mudança futura, regra encerrada, Caixinha
  criada depois do gasto e histórico anterior ao encerramento.
- [x] Documentar quais fontes são virtuais e quais movimentos são persistidos,
  evitando duplicação entre regra, ledger e forecast.

## Critérios de aceite

- [x] Alterar regra ou percentual para o futuro não altera saldo, gasto ou
  distribuição de período já fechado.
- [x] Distribuição realizada totaliza exatamente o valor definido, em centavos,
  e cada parte possui uma referência reconciliável.
- [x] Rollover, compra parcelada, refund e encerramento têm resultado
  determinístico nas datas de fronteira.
- [x] A sugestão de meta é explicativa e não cria aporte real sem command
  explícito.
- [x] Testes provam que previsão/realização e parcela/compra/pagamento não
  geram duas movimentações para a mesma realidade.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/allocation-rules.ts` e resolvers temporais
  equivalentes, sem acesso a persistência.
- [x] Fixtures de receitas, despesas, parcelas, refunds, regras e metas.
- [x] Testes unitários da matriz temporal e documentação da decisão de T01.
- [x] Contrato de entrada para T05/T07 consumir a política sem duplicá-la.

## Evidências atuais — 2026-09-03

Os testes próprios mantêm 12 testes cobrindo: versões antigas/futuras e adjacentes,
virada 2026–2027, sobreposição, distribuição proporcional exata com remainder
e zero-base, receita `EXPECTED` sem movimento, reconciliação idempotente,
  associação subcategoria→ancestral por `occurredOn`, Caixinha criada depois do
  gasto, categoria arquivada, compra econômica única com parcelas/pagamento
  ignorados, refund parcial/fora do fechamento, limite de refund, refund
  referenciado pela referência legada do evento, limite agregado entre aliases
  evento/compra, encerramento, rollover e sugestão de meta sem compromisso.

- [x] `rtk npm exec vitest -- run src/modules/budgets/allocation-rules.test.ts`
  — passou: 1 arquivo, 12 testes, 2026-09-03 00:14 (-03:00), incluindo as
  regressões de refund resolvido por alias e de limite agregado entre aliases.
- [x] `rtk npm exec vitest -- run src/modules/budgets --config vitest.config.mts
  --reporter=dot` — passou: 11 arquivos; 3 arquivos de integração skipped;
  81 testes aprovados, 13 skipped (94 total), 2026-09-03 00:14 (-03:00).
- [x] `rtk npm exec eslint -- src/modules/budgets/allocation-rules.ts
  src/modules/budgets/allocation-rules.test.ts
  src/modules/budgets/allocation-rules.fixtures.ts --max-warnings=0` — passou,
  2026-09-03.
- [x] `rtk npm exec tsc -- --noEmit --pretty false` — passou em 2026-09-03
  (exit 0) após correções localizadas somente nos testes externos
  `account-form.test.tsx` e `forecast-money-fields.test.tsx`; nenhum diagnóstico
  aponta para os arquivos de T04.
- [x] `rtk git diff --check` e auditoria de whitespace dos arquivos próprios —
  passaram após a correção; a auditoria de whitespace não encontrou linhas
  inválidas.

## Gate externo e status final

T04 está concluída. A política pura está implementada e testada, e o fechamento
T15 confirmou a persistência/migration de T03 e a integração vertical de
T05/T07/T08/T13 com PostgreSQL descartável. A matriz ampla passou com 35
arquivos e 137 testes; nenhuma semântica de T04 foi alterada durante o
fechamento.

O typecheck global foi executado novamente em 2026-09-03 e passou com exit 0
após correções somente nos testes externos (`account-form.test.tsx:17` e
`forecast-money-fields.test.tsx:28`); não há pendência de regra temporal de T04.

### Handoff

- **T05:** consumir `resolveEffectiveAllocationRules`,
  `resolveBudgetForExpense`, `resolveBudgetFinancialEffects` e
  `resolveBudgetTemporalState` com dados tenant-safe. Efeitos são virtuais;
  usar `balanceEligible` no corte e não criar uma segunda fonte de saldo.
- **T07:** consumir `distributeRealizedIncome` para `INCOME` `POSTED`, persistir
  somente contribuições positivas/materializáveis dentro da transaction e
  combinar `allocationContributionReferenceId` com a idempotência e referências
  refletidas do command. Não distribuir `EXPECTED`/`PLANNED`.
- **T08:** montar o stream `s09.v1` com referências/efeitos normalizados,
  aplicar proteção somente à Caixinha ativa e positiva, e não somar
  `INSTALLMENT`, pagamento de cartão, forecast ou refund pós-fechamento como
  fontes concorrentes.
- **T13:** reutilizar `allocation-rules.fixtures.ts` e os 12 testes como base
  para PostgreSQL/integração, acrescentando constraints, transaction,
  idempotência e provider quando T03/T05/T07/T08 estiverem disponíveis.

### Arquivos próprios alterados

- `src/modules/budgets/allocation-rules.ts`
- `src/modules/budgets/allocation-rules.test.ts`
- `src/modules/budgets/allocation-rules.fixtures.ts`
- `docs/S09-caixinhas-allocation-policy.md`
- `tasks/S09-caixinhas/004-regras-vigencia-alocacao_task.md`

## Fora de escopo

Integração bancária, rendimento, investimentos associados, juros, inflação,
forecast novo ou cálculo da fórmula global de Spendable.
