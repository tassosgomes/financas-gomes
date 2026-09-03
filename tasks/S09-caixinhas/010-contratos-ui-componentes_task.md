# T10 — Contratos de UI e componentes compartilhados

- Status: Concluída — contratos, formatadores e componentes compartilhados foram
  consumidos verticalmente por T11/T12; o typecheck do write set e a matriz E2E
  de Caixinhas estão comprovados. O typecheck global passou em 2026-09-03 após
  correções localizadas somente em testes externos.
- Onda: 1, transversal
- Dependências: T01 e contratos de domínio de T02
- Paralelização: Com T02–T09

## Objetivo

Definir o read model de apresentação e componentes compartilhados para que as
telas comuniquem Caixinhas sem recalcular regras financeiras no client.

## Escopo

- Definir DTOs serializáveis de lista, detalhe, saldo, movimento, meta,
  progresso, aporte/gasto do período, status e impacto no Spendable.
- Formatar strings de centavos e `YYYY-MM-DD` de forma consistente, sem
  `number`, `float` ou `Date` participando da semântica monetária.
- Criar estados loading, vazio, erro, ativo, encerrado, saldo negativo,
  ausência de meta e provider indisponível.
- Projetar componentes acessíveis para saldo acumulado, movimento, progresso,
  confirmação de encerramento e mensagens de proteção/disponibilidade.
- Definir callbacks/actions e links server-side; nenhum href ou permissão deve
  ser montado pelo browser a partir de `householdId` ou referência bruta.
- Manter desktop-first com responsividade suficiente para consulta/cadastro
  simples em mobile e formulários curtos.

## Subtarefas

- [x] Publicar contratos de UI e view models, mantendo domínio separado da
  boundary React/Next.
- [x] Implementar formatadores e componentes compartilhados em
  `src/components/budgets`/equivalente.
- [x] Cobrir acessibilidade de teclado, foco, headings, live regions e texto
  independente de cor.
- [x] Testar estados positivos, zero, negativo, encerrado, vazio e erro opaco.

## Critérios de aceite

- [x] Componentes recebem read models e nunca calculam saldo, proteção,
  progresso ou fórmula de Spendable.
- [x] Saldo negativo é explicado sem aparecer como disponibilidade positiva;
  ausência técnica não vira zero enganoso.
- [x] Valores de alto porte e datas de fronteira mantêm formatação correta e
  não passam por `number` monetário.
- [x] Componentes são reutilizáveis por T11/T12 e não expõem autoridade de
  tenancy.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/ui-contracts.ts` e view models.
- [x] Componentes compartilhados e testes focados.
- [x] Evidências de lint, typecheck e acessibilidade para as telas.

## Reconciliação de rastreabilidade — 2026-09-03

### Escopo inspecionado

Foram confrontados esta task, a ADR-012, `src/modules/budgets/contracts.ts`,
`src/modules/budgets/ui-contracts.ts`, todos os artefatos em
`src/components/budgets` e seus testes. A ADR mantém a regra de que a UI recebe
strings/datas serializáveis e que saldo, progresso, proteção e Spendable são
derivados no servidor; a auditoria atual inclui as telas `src/app/budgets` e
as integrações verticais de T11/T12.

### O que foi marcado

- As quatro subtasks foram marcadas: existem DTOs/view models na boundary,
  formatadores sem conversão monetária numérica, componentes compartilhados
  exportados e testes focados cobrindo acessibilidade e estados solicitados.
- O primeiro critério foi marcado após a remediação: `budget-components.tsx`
  importa e usa diretamente os view models/read-model states de
  `src/modules/budgets/ui-contracts.ts`, sem redeclaração local. O componente
  apenas apresenta os valores e estados fornecidos pelo servidor; a conversão
  de `progressBps` para `number` é somente a adaptação exigida pela API DOM de
  `<progress>`, sem cálculo de progresso ou valor monetário.
- O segundo critério foi marcado: `BudgetBalanceCard` explica déficit sem
  apresentar disponibilidade positiva; a proteção exibida vem do read model,
  e o estado `UNAVAILABLE` de Spendable exibe alerta sem apresentar valores
  como zero.
- O terceiro critério foi marcado: os testes cobrem `9223372036854775807`
  centavos, zero, sinal, datas `0000-02-29`, `2024-02-29`, `9999-12-31` e
  entradas inválidas; `formatters.ts` opera sobre strings.
- Os dois primeiros entregáveis foram marcados: `ui-contracts.ts` contém DTOs,
  view models e estados discriminados; `src/components/budgets` consome a
  boundary canônica e contém formatadores, componentes e testes focados.

### Reconciliação vertical — 2026-09-03

- O quarto critério foi marcado após a auditoria de T11/T12: as telas importam
  os componentes compartilhados e as actions resolvem o contexto no servidor;
  nenhuma rota ou componente recebe householdId como autoridade do browser.
- O terceiro entregável foi marcado: lint do write set, testes de componentes,
  testes de acessibilidade e os fluxos E2E de T11/T12 foram executados. O
  typecheck global passou após correções somente nos dois arquivos de teste
  externos, sem diagnóstico no write set de T10.

### Remediação do typecheck — 2026-09-02

- O erro original em `budget-components.tsx:250` foi diagnosticado como a
  passagem de `progressBps: string` para `aria-valuenow` e `value`, atributos
  que o React tipa como `number`. A correção usa o valor de basis points já
  fornecido pelo servidor e o converte apenas para a API numérica do elemento
  nativo `<progress>`.
- A mesma correção ligou os componentes à boundary canônica: estados usam a
  discriminante `state` de `BudgetReadModelState`, e saldo, movimento,
  progresso, status e Spendable usam os tipos de `ui-contracts.ts`.
- O typecheck do write set T10 continua sem erro; a execução global de
  2026-09-03 passou após correções somente nos testes externos
  `account-form.test.tsx:17` e `forecast-money-fields.test.tsx:28`.

### Comandos e resultados

- [x] `rtk npm exec vitest -- run
  src/components/budgets/formatters.test.ts
  src/components/budgets/budget-components.test.tsx --config vitest.config.mts
  --reporter=dot` — passou (exit 0): 2 arquivos, 20 testes, 2026-09-03.
- [x] `rtk npm exec eslint -- src/modules/budgets/ui-contracts.ts
  src/components/budgets/formatters.ts src/components/budgets/formatters.test.ts
  src/components/budgets/budget-components.tsx
  src/components/budgets/budget-components.test.tsx
  src/components/budgets/index.ts --max-warnings=0` — passou sem erros ou
  warnings.
- [x] O typecheck do write set T10 não reportou diagnósticos; a execução global
  de 2026-09-03 passou com exit 0 após correções somente nos testes externos
  `src/components/accounts/account-form.test.tsx:17` e
  `src/components/forecast/forecast-money-fields.test.tsx:28`.
- [x] Testes verticais de T11 que consomem os componentes compartilhados —
  `rtk npm exec vitest -- run src/components/budgets/formatters.test.ts
  src/components/budgets/budget-components.test.tsx
  src/components/budgets/budget-list-screen.test.tsx
  src/components/budgets/budget-form.test.tsx src/app/budgets/page.test.tsx
  'src/app/budgets/[referenceId]/page.test.tsx' --config vitest.config.mts
  --reporter=dot` — passaram: 6 arquivos, 35 testes.
- [x] `rtk npm run typecheck` global — passou em 2026-09-03 (exit 0) após
  correções localizadas somente nos testes externos; nenhum diagnóstico aponta
  para o write set de T10/T11/T12.
- [x] `rtk git diff --check` — passou (exit 0) no worktree atual.

### Gates e handoff após T11/T12

T11 e T12 consumiram a boundary canônica, comprovaram estados, acessibilidade,
revalidação e tenancy, e fecharam os dois itens que estavam abertos. O
typecheck global está verde após a correção dos testes externos; não há
pendência funcional de T10.

## Fora de escopo

Queries, Server Actions, persistência, cálculo de saldo e integração real com
Spendable.
