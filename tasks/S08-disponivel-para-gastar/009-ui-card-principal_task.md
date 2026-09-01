# T09 — UI do card principal

- Status: Planejada
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

## Critérios de aceite

- [ ] O card nunca mostra valor negativo como “pode gastar”.
- [ ] Déficit explica o valor a preservar; erro não é confundido com R$ 0.

