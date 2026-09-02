# Tasks — S08: Disponível para gastar

## Objetivo

Entregar uma resposta confiável, explicável e tenant-safe para “quanto posso
gastar?”, derivada do saldo e do forecast de compromissos conhecidos, sem
persistir um saldo de disponibilidade que possa divergir do ledger.

Este plano deriva de [`docs/S08-disponivel-para-gastar.md`](../../docs/S08-disponivel-para-gastar.md),
[`docs/prd.md`](../../docs/prd.md) e [`docs/techspec.md`](../../docs/techspec.md),
em especial as seções 48–57 da TechSpec. Preserva `Money`/`bigint`,
`Temporal.PlainDate`, UUIDv7, `household_id` e o contexto financeiro
derivado da sessão.

## Decisões normativas do plano

- A fórmula V1 é centralizada e versionada: para o horizonte e cenário
  solicitados, `rawSpendable = minimumProjectedBalance - operationalBuffer`.
  `minimumProjectedBalance` vem do forecast consolidado, que já considera
  todos os compromissos conhecidos. O indicador principal usa por padrão
  `CONSERVATIVE` e 90 dias; mudar a página de projeção não muda esse padrão.
- O resultado exibível segue a TechSpec: `displaySpendable = max(0,
  rawSpendable)`. Quando `rawSpendable < 0`, a UI deve mostrar “Pode gastar:
  R$ 0” e o `deficitToPreserveReserve = abs(rawSpendable)`; o breakdown mantém
  o valor bruto negativo. Assim, o negativo não é mascarado nem apresentado
  erroneamente como disponibilidade positiva.
- O engine recebe somente uma timeline normalizada. S08 não replica queries
  de recorrências, eventos futuros ou parcelas e não soma fatura, parcela e
  pagamento como fontes independentes. S07 é o produtor do contrato de
  forecast/compromissos e deve garantir cada compromisso exatamente uma vez.
- Saldos são derivados de `POSTED account_entries`; somente recursos
  `Spendability.GENERAL` entram no spendable global. `RESTRICTED` é exibido
  separadamente no futuro cálculo contextual e `EXCLUDED` não entra. Cartão,
  patrimônio, limite e saldo de caixinha não são sinônimos de Spendable.
- A reserva operacional é absoluta, em centavos, por household. A inexistência
  de configuração tem semântica explícita decidida em T01 (valor inicial ou
  bloqueio de configuração); nunca inferir percentual de despesa.
- S08 prepara uma porta/adaptador para reservas de caixinhas com valor zero
  antes de S09. A proteção efetiva por caixinhas é integrada em S09, sem
  alterar a fórmula ou duplicar a subtração de despesas que já reduziram a
  caixinha.
- Contratos que cruzam a fronteira server/client usam strings de centavos e
  datas ISO. Nenhum valor, descrição, nome de conta ou lista de compromissos
  crua pode ser enviado a logs, breadcrumbs ou Sentry.

## Ordem de execução

### Onda 0 — contrato e gate

1. [T01 — Contrato da fórmula e gate de S07](001-contrato-formula-e-gate-s07_task.md)

T01 é serial: fecha a semântica de cenário, data de referência, horizonte,
buffer, mínimo projetado, negativo e caixinhas antes de qualquer adapter ou UI.

### Onda 1 — fundações paralelas

2. [T02 — Tipos, fixtures e timeline normalizada](002-tipos-fixtures-e-timeline-normalizada_task.md)
3. [T03 — Engine puro de spendable e breakdown](003-engine-puro-spendable-breakdown_task.md)
4. [T04 — Contrato de UI e estados de apresentação](004-contrato-ui-estados-apresentacao_task.md)
5. [T05 — Observabilidade segura do cálculo](005-observabilidade-segura_task.md)

T02, T04 e T05 podem começar após T01. T03 depende das formas normalizadas de
T02; seus testes puros podem ser preparados em paralelo. T04 não implementa
telas e não deve inventar a fórmula.

### Onda 2 — leitura vertical e integração

6. [T06 — Query tenant-safe e serviço de disponibilidade](006-query-tenant-safe-servico-disponibilidade_task.md)
7. [T07 — Explicação, origem do mínimo e não dupla contagem](007-breakdown-origem-minimo-nao-dupla-contagem_task.md)
8. [T08 — Adaptador de reservas para S09](008-adaptador-reservas-handoff-s09_task.md)

T06 depende de T02/T03 e do contrato publicado de S07. T07 fecha sobre T06;
T08 pode avançar em paralelo depois de T01 e é integrado por T06. T05 deve ser
aplicada continuamente nos caminhos desta onda.

### Onda 3 — experiência principal

9. [T09 — Card principal de disponível para gastar](009-ui-card-principal_task.md)
10. [T10 — Breakdown acessível e navegação para a origem](010-ui-breakdown-acessivel_task.md)

T09 depende de T04/T06; T10 depende de T04/T07. Podem ser desenvolvidas em
paralelo depois que o read model estabilizar.

### Onda 4 — qualidade e fechamento

11. [T11 — Testes unitários e integração PostgreSQL](011-testes-unitarios-integracao_task.md)
12. [T12 — Testes E2E da consulta de disponibilidade](012-testes-e2e_task.md)
13. [T13 — Validação de release e handoff para S09](013-validacao-release-handoff-s09_task.md)

T11 é incremental, mas fecha após T06–T08. T12 depende das duas telas e T13
é o gate serial final, dependente de T05/T11/T12.

## Matriz de dependências e paralelização

| ID | Onda | Dependências | Pode ocorrer em paralelo com |
|---|---:|---|---|
| T01 | 0 | S07, S01–S06 | — |
| T02 | 1 | T01, contrato S07 | T04, T05 |
| T03 | 1 | T01, T02 | T04, T05 |
| T04 | 1 | T01 | T02, T03, T05 |
| T05 | 1 | T01 | T02–T04 e T06–T10 |
| T06 | 2 | T02, T03, S07 | T08 (e instrumentação T05) |
| T07 | 2 | T06 | T08; acabamento de T09 |
| T08 | 2 | T01 | T06/T07; implementação final em S09 |
| T09 | 3 | T04, T06 | T10 |
| T10 | 3 | T04, T07 | T09 |
| T11 | 4 | T03, T06–T08 | preparação incremental com T09/T10 |
| T12 | 4 | T09–T11 | — |
| T13 | 4 | T05, T11, T12 | — |

## Caminho crítico

`T01 → T02 → T03 → T06 → T07 → T10 → T11 → T12 → T13`

T04/T05 e T08 reduzem risco fora do caminho crítico; T09 pode fechar em
paralelo ao T10 quando o read model de T06 estiver estável.

## Definition of Done do slice

- [x] Para os mesmos dados, cenário, data e horizonte, o cálculo retorna o
  mesmo resultado e a mesma composição.
- [x] O indicador usa forecast conservador de 90 dias por padrão, considera
  obrigações conhecidas de S07 uma única vez e não confunde patrimônio,
  limite/fatura de cartão ou recursos excluídos com dinheiro gastável.
- [x] O usuário vê o valor, a data/horizonte/cenário usados, o buffer, o menor
  saldo projetado e os eventos que levam ao mínimo; os componentes reconciliam
  exatamente o resultado.
- [x] Zero e déficit são compreensíveis: disponibilidade mostrada não é
  negativa, mas `rawSpendable`/déficit são expostos corretamente.
- [x] Leituras e commands respeitam `household_id`; um household nunca obtém
  saldo, configuração, forecast ou breakdown de outro.
- [x] Recursos restritos/excluídos não inflam o spendable global e o contrato
  de reservas de caixinha está preparado para S09 sem bloquear S08.
- [x] Falhas técnicas de cálculo são observáveis com dados agregados e seguros;
  valores financeiros crus e descrições não saem do processo.
- [x] Testes puros, PostgreSQL e E2E cobrem positivo, zero, déficit, ausência
  de transações, parcelas/entradas futuras, não dupla contagem, isolamento e
  estados de UI. A integração com valores reservados fica explicitamente
  fechada por S09.

Esta Definition of Done do slice foi auditada na T13. Os gates específicos de
S08 estão verdes; a promoção global permanece bloqueada pela regressão E2E
externa registrada em
[`T13 — Validação de release e handoff para S09`](013-validacao-release-handoff-s09_task.md).
