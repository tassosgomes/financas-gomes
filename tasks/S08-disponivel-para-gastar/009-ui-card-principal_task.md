# T09 — UI do card principal

- Status: Concluída
- Onda: 3
- Dependências: T04 e T06
- Paralelização: Com T10

## Objetivo

Exibir a disponibilidade como informação de destaque na visão principal ou de
planejamento, com referência temporal e estados seguros.

## Escopo

- Buscar o read model pelo adapter server-side e renderizar valor principal,
  cenário conservador, data de referência e horizonte de 90 dias.
- Renderizar estados de carregamento, sem dados/configuração, falha, zero,
  valor positivo e déficit sem usar fallback monetário enganoso.
- Incluir ação acessível para abrir o breakdown e não oferecer edição direta
  do cálculo no card.
- Garantir responsividade de consulta e formatação consistente de moeda.

## Subtarefas

- [x] Integrar o adapter server-side à visão autenticada com defaults de
  cenário conservador, data de referência e horizonte de 90 dias.
- [x] Renderizar estados de carregamento, ausência, falha, zero, positivo e
  déficit usando somente o read model e mensagens seguras.
- [x] Cobrir a ação acessível para o breakdown, responsividade e formatação
  monetária sem oferecer edição do cálculo.
- [x] Registrar evidências de verificação e concluir a task somente após os
  critérios de aceite passarem.

## Critérios de aceite

- [x] O card nunca mostra valor negativo como “pode gastar”.
- [x] Déficit explica o valor a preservar; erro não é confundido com R$ 0.

## Entrega e evidências (2026-09-01)

- [x] [`src/app/app/page.tsx`](../../src/app/app/page.tsx) consulta o
  `getSpendableAction` server-side sem receber `householdId` ou outro seletor
  financeiro do navegador, usa o read model de T06 e mantém o cenário
  conservador/horizonte de 90 dias definidos pelo serviço.
- [x] A visão autenticada entrega `SpendableCard` com referência `asOf`,
  horizonte, período, buffer e composição autorizada em
  `/spendable/breakdown`; o card não oferece edição do cálculo.
- [x] [`src/app/app/loading.tsx`](../../src/app/app/loading.tsx) expõe o
  estado acessível de carregamento do card. Estados de ausência e falha usam
  envelopes opacos; ausência de recurso não vira `R$ 0`, enquanto zero,
  positivo e déficit preservam a semântica do DTO.
- [x] [`src/app/app/page.test.tsx`](../../src/app/app/page.test.tsx) cobre
  leitura server-side, defaults visíveis, ação de breakdown, ausência,
  falha, zero/positivo, déficit e loading; o caso negativo mantém o bruto no
  texto de resultado, mas nunca em “Pode gastar”.
- [x] `rtk npm exec vitest -- run src/app/app/page.test.tsx src/components/spendable src/modules/spendable --reporter=dot` — 9 arquivos passaram, 59 testes passaram; 2 testes de integração PostgreSQL permaneceram opt-in/skipped.
- [x] `rtk npm exec eslint -- src/app/app/page.tsx src/app/app/loading.tsx src/app/app/page.test.tsx --max-warnings=0` — sem erros ou warnings.
- [x] `rtk npm run typecheck` — passou.
- [x] `rtk git diff --check` — passou.

## Handoff

- [x] T10 pode usar o href `/spendable/breakdown` já exposto pelo card para
  renderizar o breakdown server-side; nenhuma regra financeira foi duplicada
  na visão principal.
