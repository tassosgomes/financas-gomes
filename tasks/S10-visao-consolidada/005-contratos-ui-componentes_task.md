# T05 — Contratos de UI e componentes compartilhados da Visão Geral

- Status: Concluída
- Onda: 1 (transversal)
- Dependências: T01
- Paralelização: Com T02, T03 e T04

## Objetivo

Definir os view models e os componentes de apresentação reutilizáveis da home
antes das telas, para que T10–T12 montem a página sem inventar formatação,
rótulo ou estado.

## Escopo

- Criar `ui-contracts.ts` do módulo de visão geral com view models por bloco,
  já formatados a partir de strings de centavos e datas ISO.
- Reutilizar os formatadores de moeda/data existentes do projeto; não criar uma
  segunda formatação monetária.
- Definir rótulos em português alinhados ao produto: "Visão geral", "Pode
  gastar com segurança", "Resumo do mês", "Onde está indo o dinheiro",
  "Próximos compromissos", "Caixinhas".
- Criar os componentes compartilhados: card de seção, item de lista com valor,
  barra de participação por categoria, badge de estado (normal/atenção/crítico)
  e link de drill-down.
- Definir os três estados visuais de cada componente: `loading` (skeleton),
  `empty` e `error`, com acessibilidade (`aria-label`, foco, contraste) e
  `data-testid` estáveis para E2E.
- Manter os componentes puros: sem fetch, sem lógica financeira, sem acesso a
  sessão.

## Subtarefas

- [x] Escrever os view models e os mapeadores do read model `s10.v1` para eles.
- [x] Implementar os componentes compartilhados com variantes de estado.
- [x] Definir e documentar os `data-testid` que T14 usará.
- [x] Testar mapeadores e componentes com dado vazio, parcial e volumoso.
- [x] Validar contraste e semântica de cabeçalhos/regiões da página.

## Critérios de aceite

- [x] Nenhum componente recebe `number` para dinheiro nem faz cálculo próprio.
- [x] Cada componente renderiza corretamente nos três estados sem prop extra
  improvisada pela tela.
- [x] Os rótulos e o vocabulário são únicos e consistentes com S08/S09.
- [x] Os `data-testid` estão documentados e estáveis.
- [x] Os componentes são responsivos a partir de 360px sem overflow horizontal.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/ui-contracts.ts`.
- [x] `src/components/overview/*` com componentes e testes.
- [x] Documento curto dos `data-testid` dentro da própria task ou do ADR.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## `data-testid` estáveis (T14)

| ID | Uso |
| --- | --- |
| `overview-page` | Container da home autenticada |
| `overview-spendable` | Bloco spendable |
| `overview-period-summary` | Bloco resumo do período |
| `overview-period-income` | Receitas do período |
| `overview-period-expense` | Despesas do período |
| `overview-categories` | Bloco despesas por categoria |
| `overview-category-{key}` | Linha/barra de categoria |
| `overview-commitments` | Próximos compromissos |
| `overview-income-upcoming` | Próximas receitas |
| `overview-caixinhas` | Resumo de Caixinhas |
| `overview-invoices` | Faturas de cartão |
| `overview-alerts` | Alertas determinísticos |
| `overview-alert-{ruleId}` | Item de alerta |
| `overview-block-loading` | Estado loading de bloco |
| `overview-block-empty` | Estado empty de bloco |
| `overview-block-error` | Estado error de bloco |

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T10, T11, T12.
- Paralelizável: sim; é trilha transversal.

## Fora de escopo

Montar a página, buscar dados, definir alerta ou regra de negócio.
