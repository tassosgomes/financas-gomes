# T02 — Tipos, fixtures e timeline normalizada

- Status: Planejada
- Onda: 1
- Dependências: T01 e contrato de forecast de S07
- Paralelização: Com T04 e T05

## Objetivo

Criar o contrato tipado que isola o engine puro das fontes de persistência e
uma matriz de fixtures financeiras reutilizável.

## Escopo

- Modelar `ForecastItem`, ponto agregado diário, cenário, certeza, referência
  opaca e componente de saldo em `Money`/`bigint` e `Temporal.PlainDate`.
- Normalizar a timeline de S07 sem conhecer Drizzle/PostgreSQL, ordenar datas
  de forma estável e agregar todos os itens do mesmo dia antes de alterar o
  saldo.
- Construir fixtures para saldo sem eventos, entrada confiável/incerta,
  compromisso futuro, parcelas, pagamento de cartão e fronteira de ano.
- Incluir cenários que provem que item já realizado ou uma parcela não entra
  duas vezes; usar IDs opacos e nunca descrições/valores em telemetria.

## Critérios de aceite

- [ ] Nenhum `number`, `float` ou `Date` participa de cálculo financeiro.
- [ ] A mesma coleção em ordem distinta produz a mesma timeline diária.
- [ ] Fixtures cobrem os casos de aceite de S08 e podem ser usadas por T03/T11.

