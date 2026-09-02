# Fixtures sintéticas do spendable `s08.v1`

As fixtures desta pasta são dados determinísticos para T02/T03/T11. Os
centavos são strings no manifesto e viram `bigint` apenas no domínio; datas
financeiras usam `Temporal.PlainDate`. IDs têm finalidade de referência opaca
e não devem ser usados como texto de telemetria.

O catálogo executável está em
[`src/modules/spendable/fixtures.ts`](../../../src/modules/spendable/fixtures.ts).
Ele inclui horizonte vazio, agregação no mesmo dia, entradas confiáveis e
incertas, compromisso futuro, três parcelas sem compra/pagamento concorrente,
realização sem duplicação, virada de ano, escopo GENERAL, buffer ausente ou
effective-dated e o adapter de reserva zero.
