# S07 — Compromissos e visão do fluxo futuro

## Objetivo

Construir a camada que permite ao sistema olhar além do saldo atual e projetar compromissos financeiros conhecidos.

## Valor entregue

O usuário passa a visualizar quanto do dinheiro futuro já está comprometido, em especial por transações previstas e parcelas de cartão conhecidas.

## Fluxo principal

1. Usuário acessa uma visão futura por período.
2. Sistema considera compromissos já conhecidos.
3. Usuário vê entradas e saídas previstas.
4. Pode abrir a origem de um valor projetado.
5. Corrige/adiciona informações quando necessário.

## Escopo

- Agregação de compromissos futuros já representados no domínio.
- Inclusão das parcelas futuras de cartão.
- Inclusão de lançamentos futuros/recorrentes somente na medida em que estiverem previstos no PRD.
- Visão por mês/período.
- Distinção entre realizado e previsto.
- Base de cálculo reutilizável pelo slice "Quanto posso gastar".

## Fora de escopo

- Forecast probabilístico.
- IA prevendo despesas não cadastradas.
- Cenários financeiros complexos.
- Simulação de investimentos.

## Dependências

- S03.
- S06.

## Contrato normativo

O contrato público e o gate de dependências do slice estão em
[`ADR-008 — Contrato do forecast e gate do S07`](adr/008-s07-forecast-contract.md).
Ele prevalece sobre formulações genéricas deste documento quando definir
fontes, estados, reconciliação, cenários, datas e o handoff para T02–T13.

## Dados / domínio

O objetivo é evitar duplicar conceitos. Sempre que possível, a projeção deve ser derivada das entidades já existentes e de entidades explícitas de compromisso/recorrência apenas quando necessárias.

## Backend

- Serviço/query de projeção por período.
- Regra clara para realizado versus futuro.
- Consolidação de compras parceladas.
- Consolidação de demais compromissos previstos da V1.
- API/contrato estável para os slices S08 e S10.

## Frontend

- Visão mensal futura.
- Totais de entradas, saídas e saldo projetado.
- Drill-down para origem dos compromissos.
- Distinção visual entre realizado e previsto.

## Critérios de aceite

- [ ] Parcela futura de cartão aparece exatamente uma vez na projeção.
- [ ] Valores realizados não são duplicados como futuros.
- [ ] Usuário consegue entender de onde vem um compromisso projetado.
- [ ] Troca de período recalcula corretamente.
- [ ] O cálculo é determinístico para o mesmo conjunto de dados.

## Testes

- Mês sem compromissos.
- Mês com várias parcelas.
- Mudança de ano.
- Realizado + previsto.
- Cancelamento de origem removendo impacto futuro.

## Observabilidade

- Capturar exceções do cálculo.
- Monitorar consultas excessivamente lentas.

## Tarefas internas sugeridas

1. Definir contrato de projeção.
2. Consolidar fontes conhecidas de compromisso.
3. Implementar cálculo por período.
4. Criar visão futura.
5. Criar drill-down.
6. Cobrir casos de borda com testes.

## Definition of Done

Para um mês futuro, o usuário consegue ver compromissos conhecidos e explicar os principais valores que compõem a projeção.
