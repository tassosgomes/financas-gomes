# T01 — Contrato da Visão Geral, fronteira e gate de dependências

- Status: Não iniciada
- Onda: 0
- Dependências: S05, S07, S08, S09 e os contratos publicados nos handoffs
- Paralelização: Serial; desbloqueia todo o slice

## Objetivo

Fechar a semântica pública da Visão Geral antes de escrever qualquer query,
composição ou tela. O resultado deve eliminar ambiguidade sobre o que é
"período atual", o que cada bloco mostra, de onde cada número vem e quem é o
dono de cada fórmula.

## Escopo

- Declarar a fronteira do slice: **o S10 compõe e apresenta; ele não recria
  fórmula financeira**. Saldo/ledger é do S03, revisão é do S05, cartão é do
  S06, forecast é do S07, "quanto posso gastar" é do S08 e Caixinhas é do S09.
- Definir o contrato versionado `s10.v1` do read model da home: nome de cada
  seção, campos, tipos serializáveis (strings de centavos, datas ISO), estados
  possíveis e erros opacos.
- Fechar a definição de **período atual**: mês civil do `asOf` resolvido no
  servidor, limites inclusivos/exclusivos, fuso e a relação com
  `Temporal.PlainDate`. Nenhuma seção pode usar uma janela diferente sem
  declarar isso no contrato.
- Fechar a regra de **não dupla contagem** entre cartão e transação: qual
  representação econômica entra em "despesas realizadas" e em "despesas por
  categoria" (compra/parcela/valor econômico) e o que fica fora (fatura,
  pagamento de cartão, transferência entre contas, transferência entre
  Caixinhas, aporte/retirada de Caixinha).
- Fechar o tratamento de `REFUND`, `REVERSAL` e `CORRECTION` nos agregados do
  período, com data efetiva e sinal explícitos.
- Fechar a política de **degradação parcial**: cada bloco falha isoladamente,
  com estado próprio de erro; a home nunca apresenta zero monetário para
  esconder uma falha, e uma falha de bloco não derruba a página inteira.
- Definir o conjunto de blocos da V1 e sua hierarquia: pode gastar (S08),
  resumo do período, receitas/despesas realizadas, despesas por categoria,
  próximos compromissos, resumo de caixinhas, alertas determinísticos.
- Definir os destinos de drill-down e o formato dos filtros na URL para
  `/transactions`, `/forecast`, `/budgets`, `/credit-cards` e
  `/spendable/breakdown`.
- Declarar os limites de escopo: sem BI configurável, sem widget
  configurável, sem relatório customizado, sem benchmark, sem insight de IA.
- Registrar a decisão como ADR (`docs/adr/013-s10-overview-contract.md`) e uma
  matriz de contrato/cenários equivalente à usada em S08/S09.

## Subtarefas

- [ ] Inventariar as leituras já existentes que serão consumidas
  (`getSpendable`, serviços de forecast, `budgetReadAccess`, projeções de
  cartão, reads de transações) e registrar assinatura, contexto exigido e
  erros de cada uma, sem propor reimplementação.
- [ ] Publicar a ADR-013 com o contrato `s10.v1`, invariantes, exemplos em
  centavos e a precedência entre PRD, TechSpec e handoffs S08/S09.
- [ ] Publicar a matriz de cenários: espaço vazio, apenas transações, apenas
  cartão, cartão + parcela, refund no período, Caixinha com saldo negativo,
  Caixinha encerrada, forecast sem itens, receita prevista não realizada e
  volume representativo.
- [ ] Mapear cada critério de aceite de `docs/S10-visao-consolidada.md` para as
  tasks T02–T15 e para a evidência que vai prová-lo.
- [ ] Publicar a lista de gates externos abertos (S09 T04/T07–T15) e o
  comportamento contratado da home enquanto eles não fecharem.

## Critérios de aceite

- [ ] Nenhum campo, janela temporal ou regra de exclusão depende da
  interpretação local de uma task posterior.
- [ ] O contrato afirma explicitamente que "quanto posso gastar" é o resultado
  do S08 consumido sem recálculo, reformatação de fórmula ou arredondamento
  próprio.
- [ ] A regra de não dupla contagem cartão/transação está escrita em centavos,
  com exemplo numérico de compra parcelada, fatura e pagamento.
- [ ] Cada bloco tem estado declarado para dado ausente, dado parcial, erro e
  volume alto, e nenhum deles converte erro em zero.
- [ ] O contrato proíbe `householdId`, `userId` ou qualquer autoridade de
  tenancy vinda do browser nas leituras da home.

## Entregáveis e evidência esperada

- [ ] `docs/adr/013-s10-overview-contract.md` com contrato versionado.
- [ ] `docs/S10-visao-consolidada-contract-matrix.md` com cenários e mapeamento
  de critérios para tasks.
- [ ] Atualização de `docs/S10-visao-consolidada.md` apenas com decisões
  compatíveis com o escopo do slice.
- [ ] `rtk npm exec tsc -- --noEmit` e revisão de links da documentação.

## Sequenciamento

- Bloqueado por: handoffs de S05, S07, S08 e S09.
- Desbloqueia: T02, T03, T04, T05.
- Paralelizável: não.

## Fora de escopo

Criar query, endpoint, componente ou migration. Alterar a fórmula do S08,
o forecast do S07 ou o saldo derivado do S09.
