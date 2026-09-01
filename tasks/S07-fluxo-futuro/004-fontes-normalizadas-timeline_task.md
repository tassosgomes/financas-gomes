# T04 — Fontes normalizadas e ForecastTimelineBuilder

- Slice: S07 — Fluxo futuro
- Status: Concluída
- Onda: 2
- Dependências: T01, T02, T03 e contrato de leitura de parcelas de S06
- Paralelização: Preparação com T05/T07; integra antes de T06

## Objetivo

Consolidar dados do domínio em `ForecastItem[]`, sem permitir que o motor conheça Drizzle, cartão ou recorrência.

## Escopo

- Criar readers tenant-scoped para saldo de abertura realizado, recorrências/ocorrências, eventos planejados e parcelas futuras do contrato S06.
- Normalizar `date`, `amount`, `direction`, `source`, `certainty`, `referenceId`, label seguro e metadata mínima de drill-down; ordenar canonicamente e validar falhas fechado.
- Deduplicar previsão versus realização usando chaves de origem e excluir itens cancelados; incluir cada parcela apenas na competência que lhe cabe, sem adicionar pagamento de cartão ou valor total da compra como segunda saída.
- Definir o boundary de dados para período solicitado e saldo anterior sem N+1 nem acesso direto do client ao banco.

## Critérios de aceite

- [x] Cada item tem origem navegável ou motivo explícito de indisponibilidade, sem vazar dados de outro household.
- [x] Cenários conservador/esperado aplicam a política de certeza fechada em T01.
- [x] Parcelas canceladas e ocorrências realizadas não permanecem como compromisso ativo.
- [x] A saída é independente da ordem física retornada pelo banco.

## Handoff e verificações

- T05 recebe somente `ForecastItem[]`; T06 usa readers/boundaries; T10 usa referência para drill-down.
- Testes com mês vazio, várias parcelas, realizado+previsto, cancelamento, data de corte e múltiplas fontes.

## Fora de escopo

Saldo disponível para gastar, SQL dentro do engine, gráfico ou entidade de forecast.
## Subtarefas

- [x] Implementar readers das quatro fontes V1 com isolamento tenant-safe.
- [x] Reconciliar previsões, realizações e cancelamentos de forma determinística.
- [x] Integrar instrumentação segura e validar os critérios de aceite.

## Evidências de conclusão

- `src/modules/forecast/sources.ts` implementa as leituras server-side de saldo
  de abertura, recorrências/ocorrências, eventos planejados e parcelas S06,
  repetindo o predicado de `householdId` em cada relação e medindo as queries
  com a instrumentação T07.
- `src/modules/forecast/builder.ts` normaliza as quatro fontes para o contrato
  `ForecastItem`, usa as datas efetivas da ocorrência/entry S06, ordena por
  chaves canônicas, reconcilia realização total/parcial, elimina PURCHASE e
  TRANSFER como saídas adicionais e falha fechado em conflitos ou tenant
  divergente.
- `src/modules/forecast/builder.test.ts`: 10 testes unitários cobrem
  recorrência, evento parcial realizado, parcela esperada/postada/cancelada,
  formato S06 achatado, atraso em `openingAdjustments`, cenários, ordenação,
  isolamento e redaction T07.
- `src/modules/forecast/sources.test.ts`: 3 testes de boundary cobrem rejeição
  de datas/intervalos inválidos e contexto financeiro ausente antes de montar
  qualquer query.
- `src/modules/forecast/sources.integration.test.ts`: cenário PostgreSQL
  opt-in verifica as quatro leituras, saldo anterior, isolamento entre
  households e a composição final sem total de compra/pagamento duplicado.
- Verificações locais: `npx vitest run src/modules/forecast` passou (32
  testes, 1 integração opt-in); `npm test` passou (529 testes, 105 integrações
  opt-in ignoradas). O typecheck não fica totalmente verde por um erro
  preexistente em `src/modules/forecast/engine.ts:389` (cast de `ForecastSource`,
  escopo T05); não houve alteração nesse módulo.
