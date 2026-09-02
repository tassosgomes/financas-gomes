# T04 — Contrato de UI e estados de apresentação

- Status: Concluída
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T03 e T05

## Objetivo

Definir read models, formatadores e componentes compartilhados para que todas
as telas comuniquem disponibilidade sem reinterpretar a regra financeira.

## Escopo

- Definir DTO serializável, labels de cenário/período, formatos monetários e
  estados `loading`, vazio, erro técnico, zero, disponível e déficit.
- Projetar a semântica acessível do card e do breakdown: valor principal,
  texto de déficit e composição devem ser legíveis por teclado/leitor de tela.
- Estabelecer links/ações para o detalhamento e para origem dos itens sem
  expor dados cross-tenant ou tornar descrições obrigatórias.

## Subtarefas

- [x] Revisar o contrato normativo `s08.v1`/`spendable.v1` da ADR-011 e o
  padrão de contratos/componentes compartilhados do S07.
- [x] Definir o read model de apresentação, labels e formatadores sem
  conversão monetária por `number`.
- [x] Implementar os componentes compartilhados para card, breakdown, estados
  assíncronos e links de origem/detalhamento.
- [x] Cobrir acessibilidade, responsividade, isolamento de dados e estados
  positivo/zero/déficit com testes focados.
- [x] Registrar evidências de verificação e concluir a task somente após os
  critérios de aceite passarem.

## Critérios de aceite

- [x] Componentes recebem read model, nunca calculam saldo ou usam `number`.
- [x] Estado negativo informa R$ 0 disponível e a quantia a recompor.
- [x] Contrato atende desktop-first e consulta responsiva simples em mobile.

## Entrega e evidências (2026-09-01)

- [x] `src/modules/spendable/ui-contracts.ts` publica labels de cenário,
  origem, direção, status, certeza, período, buffer e reserva; os formatadores
  trabalham com strings de centavos e `bigint` somente internamente, sem
  conversão monetária por `number`, `Date` ou `float`.
- [x] `src/components/spendable` publica card, breakdown, composição do read
  model, estados loading/vazio/erro, badges e links de origem/detalhamento.
  Card e breakdown consomem exclusivamente `SpendableBreakdown` ou seu view
  model, sem recalcular saldos ou fórmulas.
- [x] O card mostra o display não negativo e, no bruto negativo, informa o
  déficit a recompor; o breakdown expõe abertura, mínimo, buffer, bruto,
  display, déficit, reserva, período e pontos causais empatados.
- [x] A semântica usa headings/landmarks, `aria-label`, listas ordenadas,
  live regions dos estados compartilhados, texto independente de cor e layout
  responsivo `sm`/`lg`; links são fornecidos pelo adapter server-side e não são
  construídos a partir de `referenceId`/household.
- [x] `rtk npx vitest run
  src/components/spendable/spendable-components.test.tsx --reporter=dot` —
  5 testes aprovados; regressão conjunta com os componentes S07: 9 testes
  aprovados.
- [x] `rtk node_modules/.bin/eslint src/modules/spendable/ui-contracts.ts
  src/components/spendable --max-warnings=0` — sem erros ou warnings.
- [x] `rtk git diff --check` — passou. O typecheck global desta janela ainda
  reporta apenas diagnósticos em arquivos concorrentes de T02/T05
  (`src/modules/observability/s08.ts` e fixture pendente do índice de T02);
  não há diagnóstico nos caminhos da T04.

## Handoff

- T09 pode usar `SpendableCard`/`SpendableReadModel` sem alterar a fórmula ou
  criar fallback monetário.
- T10 pode usar `SpendableBreakdownView`, os view models de pontos/itens e
  `SpendableOriginLink` para drill-down autorizado, inclusive quando a origem
  foi removida.
