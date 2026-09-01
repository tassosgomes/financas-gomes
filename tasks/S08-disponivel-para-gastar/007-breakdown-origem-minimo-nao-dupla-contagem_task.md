# T07 — Breakdown, origem do mínimo e não dupla contagem

- Status: Planejada
- Onda: 2
- Dependências: T06
- Paralelização: Com T08 e preparação de T09

## Objetivo

Completar a explicabilidade do read model, permitindo reconciliar o valor e
entender quais compromissos levam ao menor saldo projetado.

## Escopo

- Expor saldo de referência, menor saldo, buffer, bruto, display, déficit,
  cenário, janela, versão e pontos causais em centavos serializados.
- Mapear referências de S07 para drill-down autorizado, preservando a origem e
  sem duplicar compra, parcela, fatura e pagamento no detalhamento.
- Validar/instrumentar invariantes: soma diária, reconciliação aritmética,
  item único por `source/referenceId` quando aplicável e ausência de origem
  cancelada/fora da janela.
- Definir limite/paginação de itens causais para proteger a leitura; informar
  truncamento sem ocultar o total agregado.

## Critérios de aceite

- [ ] Usuário pode reconciliar os quatro componentes da fórmula em centavos.
- [ ] O ponto mínimo identifica eventos suficientes sem vazar outro household.
- [ ] Testes comprovam ausência de dupla contagem com parcelas e pagamentos.

