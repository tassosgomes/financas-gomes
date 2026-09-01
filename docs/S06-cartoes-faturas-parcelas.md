# S06 — Cartões, faturas e compras parceladas

## Objetivo

Representar corretamente gastos feitos em cartão de crédito, incluindo compras parceladas e sua incidência em faturas futuras.

## Valor entregue

O usuário consegue registrar e acompanhar uma compra no cartão e entender em quais períodos o gasto comprometerá seu fluxo financeiro.

## Regra importante já fechada

Uma compra parcelada é tratada como uma unidade lógica. A V1 não deve oferecer comportamento que implique "pagar uma única parcela" de forma isolada como se fosse um compromisso independente livremente quitável.

## Fluxo principal

1. Usuário cadastra/seleciona cartão.
2. Registra compra à vista ou parcelada.
3. Sistema calcula/distribui parcelas conforme as regras de competência da fatura.
4. Usuário visualiza impacto na fatura atual e nas futuras.
5. Pagamento da fatura é refletido de acordo com a modelagem definida.

## Escopo

- Cadastro mínimo de cartão.
- Dia de fechamento/vencimento quando necessários para cálculo.
- Compra no cartão.
- Compra parcelada.
- Geração da série de parcelas.
- Associação das parcelas às competências/faturas apropriadas.
- Visualização de fatura.
- Estado de pagamento da fatura conforme PRD.
- Edição/cancelamento com regra segura para compras parceladas.

## Fora de escopo

- Integração automática com operadora.
- Parcelamento de fatura.
- Rotativo, juros e encargos complexos, salvo requisito explícito do PRD.
- Pagamento isolado arbitrário de uma parcela de compra.

## Dependências

- S01.
- S02.
- S03.

## Dados / domínio

Possíveis entidades:

- `credit_cards`
- `credit_card_purchases`
- `installments`
- `credit_card_statements` ou representação derivada equivalente

As parcelas devem manter vínculo com a compra originadora.

## Backend

- CRUD de cartão.
- Algoritmo determinístico de distribuição de parcelas.
- Regras de fechamento/vencimento.
- Queries de fatura atual/futura.
- Operações transacionais ao editar/cancelar compra parcelada.

## Frontend

- Cadastro de cartão.
- Formulário de compra com quantidade de parcelas.
- Fatura por período.
- Visualização do parcelamento e saldo futuro.
- Ações válidas de pagamento/edição/cancelamento.

## Critérios de aceite

- [ ] Compra à vista entra na fatura correta.
- [ ] Compra parcelada gera exatamente N parcelas com soma coerente ao valor total.
- [ ] Arredondamentos monetários não alteram o total da compra.
- [ ] Parcelas futuras aparecem nas competências corretas.
- [ ] Usuário não consegue manipular uma parcela de maneira incompatível com a unidade lógica da compra.
- [ ] Alteração/cancelamento não deixa parcelas órfãs.
- [ ] Dados continuam isolados por espaço financeiro.

## Testes

- Fechamento antes/depois da data limite.
- Parcelamento com valores que exigem arredondamento.
- 1 parcela versus múltiplas parcelas.
- Virada de mês e ano.
- Cancelamento/edição.
- Pagamento de fatura.

## Observabilidade

- Capturar falhas de cálculo/persistência.
- Registrar contexto técnico do cálculo sem expor detalhes financeiros além do necessário.

## Tarefas internas sugeridas

1. Modelar cartão/compra/parcela/fatura.
2. Implementar regras de datas.
3. Implementar divisão monetária exata.
4. Criar CRUD de cartão.
5. Criar fluxo de compra.
6. Criar visão de fatura.
7. Implementar pagamento conforme regra de domínio.
8. Criar matriz forte de testes de datas e valores.

## Definition of Done

O usuário consegue representar uma compra parcelada real e o sistema mostra corretamente o compromisso criado para os meses futuros.
