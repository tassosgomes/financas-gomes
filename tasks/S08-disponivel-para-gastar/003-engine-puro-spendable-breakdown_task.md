# T03 — Engine puro de spendable e breakdown

- Status: Planejada
- Onda: 1
- Dependências: T01 e T02
- Paralelização: Com T04 e T05

## Objetivo

Implementar uma função determinística que calcula o menor saldo projetado e
um breakdown reconciliável, sem acesso a banco ou conhecimento de origem.

## Escopo

- Aplicar a timeline diária ao saldo de abertura, encontrar o menor saldo no
  horizonte e calcular `rawSpendable`, `displaySpendable` e déficit.
- Preservar os itens/pontos que explicam o mínimo, inclusive empates, em uma
  ordem determinística e serializável.
- Aplicar cenário/horizonte/buffer recebidos, sem defaults ocultos e sem
  `max(0)` antes de registrar o déficit.
- Cobrir precisão, zero, negativo, agrupamento intradiário, horizonte vazio,
  limites de data e entradas incertas em testes unitários puros.

## Critérios de aceite

- [ ] `minimumProjectedBalance - buffer = rawSpendable` em todo resultado.
- [ ] O bruto negativo retorna `display=0` e déficit positivo equivalente.
- [ ] O engine é puro, livre de SQL, sessão, React e mutação de entrada.

