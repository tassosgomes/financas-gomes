# T11 — Testes unitários e integração PostgreSQL

- Status: Planejada
- Onda: 4
- Dependências: T03, T06, T07 e T08
- Paralelização: Pode ser escrito incrementalmente com T09/T10

## Objetivo

Provar precisão, determinismo, isolamento e integração correta das fontes.

## Escopo

- Testes unitários de T02/T03: positivo, zero, bruto negativo, centavos,
  empate de mínimo, eventos no mesmo dia, fronteira de ano e cenários de
  certeza conservador/esperado.
- Testes PostgreSQL: saldo GENERAL, exclusão RESTRICTED/EXCLUDED, buffer,
  configuração ausente, household cruzado, data/horizonte e rollback de falha.
- Fixtures integradas com S07 para sem transações, parcelas futuras, entradas
  futuras confiáveis/incertas, cancelamento e não dupla contagem de cartão.
- Testar contrato de reserva zero e deixar testes de valores de caixinha
  marcados para habilitação obrigatória por S09.

## Critérios de aceite

- [ ] Nenhuma comparação usa float e todos os valores reconciliam em centavos.
- [ ] Há evidência automatizada de que o mesmo conjunto de dados é determinístico.
- [ ] Isolamento é provado em PostgreSQL real, não apenas por mock.

