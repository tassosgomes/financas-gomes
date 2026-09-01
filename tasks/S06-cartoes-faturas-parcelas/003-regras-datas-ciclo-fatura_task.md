# T03 — Datas, ciclos de cobrança e regras versionadas

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — resolver puro, vigência e snapshots verificados em 2026-08-31.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T10 e T11; T04 consome o resolver final

## Objetivo

Implementar um domínio puro e determinístico para transformar data da compra e
regra vigente do cartão em ciclo de fechamento, competência da fatura e
vencimento, sem depender de timezone, JavaScript `Date` ou banco.

## Escopo

- Criar contratos tipados para regra de billing, ciclo resolvido, competência,
  vencimento e override; usar `Temporal.PlainDate`/`PlainYearMonth` na lógica.
- Resolver a regra cuja vigência contém a data da compra. Regras futuras não
  podem alterar compras já materializadas; intervalos devem ser tratados de
  forma determinística e sem sobreposição.
- Fechar a fronteira do dia de fechamento conforme T01 e cobrir explicitamente
  compra no dia anterior, no próprio dia e no dia seguinte.
- Normalizar `closing_day`/`due_day` em meses sem aquele dia (incluindo
  fevereiro bissexto) segundo uma função documentada; não deixar rollover
  implícito em `Date` local.
- Calcular a primeira data de vencimento posterior ao fechamento de acordo com
  a regra aprovada; preservar no schedule o resultado resolvido e a origem da
  regra.
- Aplicar `billing_due_on_override` somente no escopo permitido por T01, sem
  mudar a regra global do cartão nem reclassificar compras existentes.
- Expor funções puras para T04/T06/T07 e serializar somente `YYYY-MM-DD`,
  `YYYY-MM` e números inteiros/string de centavos.

## Critérios de aceite

- [x] Mesmo input produz o mesmo ciclo em qualquer timezone/processo.
- [x] Casos antes/no/depois do fechamento têm competência e vencimento
  previsíveis, incluindo virada de mês e de ano.
- [x] Dia 31, fevereiro, ano bissexto e vencimento menor/igual/maior que o
  fechamento seguem a decisão documentada no T01.
- [x] Uma alteração de regra com `effective_from` posterior deixa intactos os
  ciclos de compras antigas.
- [x] Override válido é respeitado apenas para a compra/parcela autorizada;
  override inválido não cria uma fatura impossível nem altera outra compra.
- [x] Testes de domínio não precisam de banco e não usam `Date`, float ou
  timezone do ambiente.

## Handoff

- T04 recebe o resolver para montar o schedule N.
- T05 usa as validações de dia e vigência no CRUD de billing.
- T06 persiste as datas resolvidas em cada parcela para congelar a semântica.
- T07 agrupa por ciclo/vencimento sem recalcular compras antigas com a regra
  atualmente ativa.

## Subtarefas e evidências

- [x] T03-A — validar datas civis estritas com
  `Temporal.PlainDate`/`Temporal.PlainYearMonth`, sem `Date`, timezone ou
  conversão de competência para um instante.
- [x] T03-B — selecionar a regra vigente pelo intervalo semiaberto
  `effectiveFrom <= occurredOn < effectiveUntil` e rejeitar vigências
  sobrepostas ou inválidas.
- [x] T03-C — resolver a fronteira inclusiva do fechamento, normalizar dias
  inexistentes para o último dia do mês e calcular vencimento estritamente
  posterior, inclusive em fevereiro e dezembro/janeiro.
- [x] T03-D — validar e congelar `billingDueOnOverride` somente após o
  fechamento, preservando `dueDateSource` e sem alterar a regra global.
- [x] T03-E — aceitar aliases civis equivalentes sem depender da identidade
  de objetos e rejeitar aliases divergentes antes de materializar o ciclo.

## Verificações

- Testes unitários de fronteira, meses curtos, bissexto, year rollover,
  vigência e override.
- `rtk npm test -- --run` nos testes do módulo de billing e `rtk npm run typecheck`.
- Revisar que não há import de `Date` nos arquivos de domínio financeiro.

## Evidências

- [x] `rtk npm test -- --run src/modules/credit-cards/billing-cycle.test.ts` — 9 testes aprovados em 2026-08-31, incluindo aliases equivalentes/divergentes e override posicional.
- [x] `rtk npm exec eslint -- src/modules/credit-cards/billing-cycle.ts src/modules/credit-cards/billing-cycle.test.ts` — sem erros ou warnings.
- [x] `rtk npm run typecheck` — concluído sem diagnósticos em 2026-08-31.
- [x] O resolver calcula com `Temporal.PlainDate`/`Temporal.PlainYearMonth` e retorna somente strings civis (`YYYY-MM-DD`/`YYYY-MM`) e inteiros; não há acesso a banco, timezone ou `Date` nativo.

## Fora de escopo

Feriados, dias úteis, calendário do emissor, cobrança automática, rotativo e
juros. O S06 só representa a regra civil configurada e um override explícito.
