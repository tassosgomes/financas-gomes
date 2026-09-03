# Política pura de vigência e alocação da T04

Esta política é a única fonte de decisão temporal para T05/T07. Ela não lê
SQL, não cria `budget_movements` e não altera `FinancialEvent`, `ForecastItem`
ou saldo.

## Vigência

- Regras de alocação usam `[effectiveFrom, effectiveUntil)`; uma data de
  receita escolhe a versão válida nessa data econômica.
- Intervalos adjacentes são válidos e sobreposição para a mesma Caixinha é
  rejeitada. A ordenação canônica é `boxReferenceId`, portanto a escolha do
  remainder não depende da ordem de leitura.
- Associação de despesa usa `occurredOn`, sobe da subcategoria para ancestrais
  e escolhe uma única Caixinha. Uma Caixinha criada depois não recebe o gasto
  histórico.
- `activeFrom` é inclusivo; `closedOn` é exclusivo para proteção. Um efeito
  histórico na data de fechamento pode ser explicado, mas um refund posterior
  é marcado `balanceEligible=false` e não reabre/protege a Caixinha.

## Alocação de receita

`amountCents` é peso nominal effective-dated, não percentual persistido nem
saldo. Somente `INCOME` `POSTED`/realizada é distribuída. Para peso total `W`,
cada parte recebe `floor(income * weight / W)` e os primeiros pesos positivos
na ordem canônica recebem um centavo do remainder. O lote fecha exatamente no
valor da receita, com referência determinística derivada da receita, regra e
Caixinha. Receita `EXPECTED`/`PLANNED` e ausência de peso positivo não geram
movimento.

O resultado da função é virtual. A materialização de partes positivas como
`CONTRIBUTION`, a idempotência do command e a transaction pertencem a T07.
Sugestão de meta, rollover e estado temporal também são derivados: não criam
movimento, compromisso ou item de forecast.

## Fontes financeiras e não dupla contagem

O stream virtual de efeitos contém apenas:

- compra econômica/`EXPENSE` realizada: `WITHDRAWAL` pelo total na data da
  compra;
- refund realizado: `CONTRIBUTION` na data efetiva, ligado à referência da
  despesa original e limitado ao valor econômico original.

`INSTALLMENT`, `FORECAST` projetado, fatura, `CARD_PAYMENT` e `TRANSFER` são
fontes concorrentes e são reportados como ignorados. Se evento e compra
representarem a mesma identidade econômica, somente a compra é conservada;
um refund pode referenciar tanto a referência opaca do evento legado quanto a
referência da compra econômica, sem perder a reconciliação, e refunds por
aliases diferentes compartilham o limite acumulado da mesma compra.
Fontes e efeitos são virtuais; somente movimentos explícitos ou contribuições
que T07 decidir materializar serão persistidos.
