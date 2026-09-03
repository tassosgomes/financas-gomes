# Tasks — S10: Visão financeira consolidada

## Objetivo

Entregar a página principal autenticada da V1: uma Visão Geral que responde,
sem cálculo manual, para onde o dinheiro está indo, quanto pode ser gasto com
segurança, como estão os compromissos futuros e como estão as caixinhas — com
drill-down para as telas de origem.

Este plano foi derivado de
[`docs/S10-visao-consolidada.md`](../../docs/S10-visao-consolidada.md),
[`docs/prd.md`](../../docs/prd.md) e
[`docs/techspec.md`](../../docs/techspec.md), com atenção às seções 10–12, 16–19,
21, 24, 28 e 31–33 do PRD e às seções 15, 48–57, 76, 86–95, 97, 102, 114 e 116
da TechSpec.

## Fronteira do slice

- **O S10 compõe e apresenta; ele não recria fórmula financeira.** Ledger e
  eventos são do S03/S05, cartão é do S06, forecast é do S07, "quanto posso
  gastar" é do S08 e Caixinhas é do S09.
- A única agregação nova de propriedade do S10 é o resumo do período
  (receitas/despesas realizadas e despesas por categoria), definida em T01 e
  implementada em T02.
- A home autenticada real do projeto é `/app` (`AUTHENTICATED_ROUTE`), não `/`.
  A TechSpec descreve `/` conceitualmente; o slice mantém a rota existente.
- Dinheiro trafega em centavos (`bigint`/`Money`, strings na serialização),
  datas usam `Temporal.PlainDate`/ISO e IDs usam UUIDv7. O browser nunca fornece
  `householdId` nem autoridade de tenancy.
- Cada bloco falha isoladamente. Erro nunca é apresentado como zero monetário.

## Decisões normativas do plano

- "Período atual" é uma definição única, fechada em T01, e vale para todos os
  blocos que não declararem janela própria no contrato.
- A regra de não dupla contagem cartão versus transação é normativa e numérica:
  fatura, pagamento de cartão, transferência entre contas e movimento de
  Caixinha não entram como despesa do período.
- A soma dos grupos de categoria é exatamente o total de despesas do período,
  com arredondamento determinístico e grupo residual explícito.
- Alertas da V1 são determinísticos, derivados do read model consolidado, sem
  query própria e sem inferência de IA.
- Não há cache na V1. Qualquer exceção exige decisão registrada no ADR-013 com
  invalidação explícita e prova de consistência.
- Todo agregado exibido carrega a chave de reconciliação que permite reproduzir
  o mesmo número na tela de destino.

## Dependências e gates

S01 fornece autenticação, household e contexto financeiro. S02 fornece
categorias e contas. S03/S05 fornecem eventos, ledger e revisão. S06 fornece
cartão, fatura e parcelas. S07 fornece forecast e timeline. S08 fornece a
fórmula e o read model de Spendable. S09 fornece Caixinhas, saldo derivado e a
porta `s09.v1`.

**Gate S09 — fechado:** o slice S09 está integralmente entregue em `main`
(`feat: deliver S09 caixinhas`). O bloco de Caixinhas da home opera em estado
**AVAILABLE** por padrão, consumindo `budgetReadAccess` / `s09.v1`. Falha
técnica isolada do bloco renderiza `error` próprio; não há fallback default de
indisponibilidade nem número derivado próprio pelo S10.

## Ordem de execução

### Onda 0 — Contrato e gate

1. [T01 — Contrato da Visão Geral, fronteira e gate de dependências](001-contrato-visao-geral-gate_task.md)

T01 é serial. Ela fecha período, blocos, não dupla contagem, degradação
parcial, drill-down e limites de escopo antes de qualquer query ou tela.

### Onda 1 — Fundações paralelas

2. [T02 — Agregação do período: realizados e despesas por categoria](002-agregacao-periodo-categorias_task.md)
3. [T03 — Composição tenant-safe das leituras existentes](003-composicao-leituras-existentes_task.md)
4. [T04 — Observabilidade segura da Visão Geral](004-observabilidade-s10_task.md)
5. [T05 — Contratos de UI e componentes compartilhados](005-contratos-ui-componentes_task.md)

As quatro podem começar juntas após T01. T02 e T03 são independentes entre si:
uma agrega dados novos, a outra apenas orquestra leituras existentes. T04 e T05
são trilhas transversais e só fecham quando os contratos de backend estabilizam.

### Onda 2 — Backend vertical

6. [T06 — Read model consolidado da home e reconciliação](006-read-model-consolidado_task.md)
7. [T07 — Drill-down determinístico para as telas de origem](007-drill-down-navegacao_task.md)
8. [T08 — Alertas determinísticos da V1](008-alertas-deterministicos_task.md)
9. [T09 — Performance, índices e volume representativo](009-performance-volume_task.md)

T06 é o ponto de junção e é serial. Depois dela, T07, T08 e T09 rodam em
paralelo: T07 monta links, T08 deriva alertas e T09 mede e indexa.

### Onda 3 — Experiência do produto

10. [T10 — UI: hierarquia de decisão da página principal](010-ui-hierarquia-decisao_task.md)
11. [T11 — UI: compromissos futuros, caixinhas, alertas e drill-down](011-ui-compromissos-caixinhas-drilldown_task.md)
12. [T12 — Estados vazio/erro/loading e consulta mobile](012-estados-empty-erro-responsivo_task.md)

T10 e T11 são paralelas, pois tocam blocos diferentes da mesma página; a
composição final da página precisa ser integrada uma vez só, evitando conflito.
T12 fecha os estados e a responsividade depois que os blocos existem.

### Onda 4 — Qualidade e fechamento

13. [T13 — Testes unitários e de integração PostgreSQL](013-testes-unitarios-integracao_task.md)
14. [T14 — Testes E2E da home para os detalhes](014-testes-e2e_task.md)
15. [T15 — Validação de release, DoD e handoff para S11](015-validacao-release-handoff_task.md)

T13 pode ser escrita incrementalmente desde T02, mas só fecha com o backend
integrado. T14 exige a experiência completa. T15 é serial.

## Matriz de dependências e paralelização

| ID | Onda | Dependências | Pode ocorrer em paralelo com |
|---|---:|---|---|
| T01 | 0 | S05, S07, S08, S09 e handoffs | — |
| T02 | 1 | T01 | T03, T04, T05 |
| T03 | 1 | T01 | T02, T04, T05 |
| T04 | transversal | T01, infra S01 | T02, T03, T05, T06–T13 |
| T05 | transversal | T01 | T02, T03, T04 |
| T06 | 2 | T02, T03 | acabamento de T04, escrita de T13 |
| T07 | 2 | T06 | T08, T09 |
| T08 | 2 | T06 | T07, T09 |
| T09 | 2 | T06 | T07, T08 |
| T10 | 3 | T05, T06 | T11 |
| T11 | 3 | T05, T06, T07, T08 | T10 |
| T12 | 3 | T10, T11 | parcialmente por bloco |
| T13 | 4 | T02–T09 | T10–T12 durante a escrita |
| T14 | 4 | T10, T11, T12, T13 | — |
| T15 | 4 | T04, T09, T13, T14 | — |

## Caminho crítico

`T01 → (T02 + T03) → T06 → (T07 + T08) → (T10 + T11) → T12 → T13 → T14 → T15`

T04, T05 e T09 são trilhas de suporte: atrasam o fechamento, não o avanço. T13
reduz risco se for escrita desde a Onda 1, mas seu gate final permanece depois
do backend integrado e das telas.

## Rastreabilidade — critérios e requisitos → tasks

O PRD deste projeto não numera user stories; a rastreabilidade usa os critérios
de aceite do slice e as seções de origem.

| Critério / requisito de origem | Tasks | Tipo de cobertura |
|---|---|---|
| Totalizações reconciliam com as telas de detalhe | T02, T06, T07, T13, T14 | Direta |
| "Quanto posso gastar" é exatamente o cálculo do S08 | T01, T03, T06, T10 | Direta |
| Navegar de um agregado para os lançamentos que o compõem | T07, T11, T14 | Direta |
| Não há dupla contagem de cartão versus transação | T01, T02, T06, T13 | Direta |
| Dashboard compreensível com nenhum, poucos e muitos dados | T09, T12, T13, T14 | Direta |
| Nenhum dado de outro espaço financeiro nas agregações | T02, T03, T06, T13 | Direta |
| PRD §16 Dashboard (saldo, planejado x realizado, caixinhas, projeções, alertas) | T02, T03, T06, T08, T10, T11 | Direta |
| PRD §17 Visualização das caixinhas | T03, T06, T11 | Suporte (dono: S09) |
| PRD §18 Alertas orientativos | T08, T11 | Direta |
| PRD §21 Fluxo semanal principal / ações rápidas | T10 | Parcial |
| PRD §24 e TechSpec §97 Consulta mobile ocasional | T05, T12, T14 | Direta |
| PRD §28 Registrar pouco, entender muito | T01, T10, T12 | Suporte |
| TechSpec §86–87 Navegação e conteúdo do dashboard | T01, T10, T11 | Direta |
| TechSpec §76 Reads e §102 Observabilidade | T03, T04, T09 | Direta |
| TechSpec §114 Índices e §116 Testes | T09, T13, T14 | Direta |

## Definition of Done do S10

- [ ] A home autenticada apresenta, sem cálculo manual do usuário, resumo do
  período, despesas por categoria, disponibilidade para gastar, próximos
  compromissos e resumo de caixinhas.
- [ ] "Quanto posso gastar" é o resultado do S08 consumido sem recálculo, e
  coincide com `/spendable/breakdown` para o mesmo contexto.
- [ ] Todo agregado exibido reconcilia em centavos com a tela de origem, com
  filtro equivalente na URL.
- [ ] Nenhum cenário de cartão, parcela, fatura, pagamento, transferência ou
  movimento de Caixinha gera dupla contagem.
- [ ] Estados de loading, vazio e erro são distinguíveis por bloco; erro nunca
  aparece como zero monetário e a falha de um bloco não derruba a página.
- [ ] Nenhum dado de outro espaço financeiro alcança número, nome, referência
  ou link da home, comprovado por teste cross-space com IDs forjados.
- [ ] Alertas são determinísticos, orientativos, limitados em quantidade e
  derivados apenas do read model consolidado.
- [ ] A home permanece legível e utilizável em 360px para consulta rápida.
- [ ] Logs, breadcrumbs e Sentry registram apenas contexto operacional agregado,
  sem centavos, nomes, descrições, SQL, payloads, cookies ou tokens.
- [ ] Testes puros, integração PostgreSQL, performance com volume representativo
  e E2E da home para os detalhes estão executados e registrados.
