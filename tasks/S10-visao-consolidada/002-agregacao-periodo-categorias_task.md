# T02 — Agregação do período: realizados e despesas por categoria

- Status: Concluída
- Onda: 1
- Dependências: T01; contratos de S03/S05 (ledger e eventos) e S06 (cartão)
- Paralelização: Com T03, T04 e T05

## Objetivo

Construir a **única** agregação nova do S10: receitas e despesas realizadas do
período e a distribuição de despesas por categoria/agrupamento, derivadas dos
eventos financeiros canônicos já existentes.

## Escopo

- Implementar agregação server-side por household e por período, em centavos,
  usando `bigint`/`Money` e `Temporal.PlainDate`, sem `float` e sem `Date`.
- Somar apenas a representação econômica definida em T01. Fatura, pagamento de
  cartão, transferência entre contas e movimento de Caixinha não entram como
  despesa do período.
- Tratar compra parcelada pelo valor econômico previsto no contrato, sem somar
  compra e parcelas na mesma janela.
- Aplicar `REFUND`, `REVERSAL` e `CORRECTION` pela data efetiva, com sinal
  correto, sem reescrever o passado.
- Agrupar despesas por categoria respeitando a hierarquia de categorias do S02
  e o caso de categoria ausente (`Sem categoria`), com ordenação determinística
  e um agrupamento residual `Outros` quando a lista exceder o limite do
  contrato.
- Retornar totais reconciliáveis: a soma dos grupos deve ser exatamente o total
  de despesas do período, sem resto de arredondamento.
- Expor read model serializável com strings de centavos, participação
  percentual calculada de forma determinística e referências suficientes para
  o drill-down de T07.
- Repetir `household_id` em todos os predicados e joins; nenhuma linha de outro
  espaço financeiro pode influenciar um total.

## Subtarefas

- [x] Criar o módulo de agregação do S10 (`src/modules/overview/`) com
  contratos, query e derivação pura separadas.
- [x] Implementar a derivação pura de totais e grupos com testes de unidade
  cobrindo refund, correção, parcela, categoria ausente e resíduo.
- [x] Implementar a query tenant-scoped com filtros de período e status
  `POSTED`, sem ler tabela de snapshot ou saldo materializado.
- [x] Provar a não dupla contagem cartão x transação com um caso numérico
  fechado (compra parcelada + fatura + pagamento no mesmo período).
- [x] Provar reconciliação: soma dos grupos == total, e total == soma dos
  eventos listados pela tela de transações com o mesmo filtro.

## Critérios de aceite

- [x] A soma dos grupos por categoria é exatamente igual ao total de despesas
  do período, em centavos, inclusive com percentuais arredondados.
- [x] Nenhum cenário de cartão produz dupla contagem, e o teste que prova isso
  é numérico, não textual.
- [x] A agregação é determinística para a mesma entrada e o mesmo `asOf`.
- [x] Um ID/linha de outro household nunca influencia um total nem aparece em
  uma referência retornada.
- [x] Nenhum valor monetário trafega como `number`.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/contracts.ts`, `aggregate.ts` e `query.ts`.
- [x] Testes unitários da derivação pura e teste PostgreSQL opt-in de
  isolamento e reconciliação.
- [x] `EXPLAIN` das consultas de período e categoria, com índices usados.
- [x] `rtk npm exec vitest`, `eslint` e `tsc` aprovados no write set da task.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T06, T07, T09.
- Paralelizável: sim, com T03, T04 e T05.

## Fora de escopo

Compor a home, ler spendable/forecast/caixinhas, criar tela ou definir alerta.
