# T11 — Testes unitários e integração PostgreSQL

- Slice: S07 — Fluxo futuro
- Status: Concluída — cobertura unitária, integração PostgreSQL e auditoria de T04/T06 finalizadas em 2026-08-31.
- Onda: 4
- Dependências: T02–T07; pode ser iniciado incrementalmente após T03/T05
- Paralelização: Com acabamento de T09/T10; fecha antes de T12/T13

## Objetivo

Provar as invariantes de domínio e persistência que tornam a projeção confiável.

## Escopo

- Cobrir calendário, gerador de recorrência, vigência, override, reconciliação, deduplicação, cenário, agregação intradia, precisão e engine puro.
- Cobrir PostgreSQL real para constraints, tenant isolation, queries, cancelamento de origem, comando repetido, rollback e índices relevantes.
- Usar fixtures sintéticas: mês vazio, parcelas múltiplas/rounding, ano bissexto, realizado+previsto, regra alterada, cancelamento e horizonte longo.

## Critérios de aceite

- [x] Cada critério de aceite do S07 está diretamente mapeado a testes
  unitários ou de integração nas evidências abaixo, incluindo builder T04 e
  serviço T06.
- [x] A não-duplicidade de parcela e de previsão/realização é provada no
  PostgreSQL: a integração T11 lê as fontes reais e valida o
  `ForecastTimeline` final com uma linha por parcela e uma linha para o fato
  reconciliado.
- [x] A suíte incremental usa datas civis fixas, `today` explícito quando
  necessário, aritmética inteira e households sintéticos; não consulta dados
  de produção nem depende de relógio/timezone local.

## Mapa de evidências incremental (2026-08-31)

Os nomes abaixo são o vínculo direto entre a matriz de exemplos do ADR-008, os
critérios do S07 e os testes executáveis, incluindo as boundaries concluídas de
T04 e T06.

| Critério/matriz | Evidência atual |
| --- | --- |
| Parcela única, rounding e competência | `src/modules/forecast/sources.integration.test.ts` (PostgreSQL: 3 parcelas, 3 `installmentId`s, soma exata de `10000`, ciclos agosto–outubro e `ForecastTimeline` com 3 itens); `src/modules/forecast/builder.test.ts` (data efetiva, cancelamento e total de compra fora da linha); `src/modules/credit-cards/installments.test.ts` e `src/modules/credit-cards/purchase-use-cases.integration.test.ts` cobrem geração `3334/3333/3333`. |
| Realização total/parcial sem duplicar a obrigação | `src/modules/forecast/sources.integration.test.ts` (PostgreSQL expõe o mesmo fato pela ocorrência e pelo reader de realizados, enquanto o builder entrega uma única linha `POSTED`); `src/modules/forecast/builder.test.ts` (residual parcial e variação); `src/modules/recurrences/recurrence.test.ts`, `src/modules/recurring/use-cases.integration.test.ts` e `src/db/recurring.integration.test.ts` (vínculo explícito, exclusividade e tenant). |
| Regra alterada preserva histórico, vigência e calendário | `src/modules/recurrences/recurrence.test.ts` (fevereiro comum/bissexto, fim de semana/feriado, virada de ano, geração inclusiva e edição prospectiva). |
| Cancelamento e não pagamento isolado de parcela | `src/modules/forecast/builder.test.ts` (ocorrências e parcelas canceladas não geram item); `src/modules/credit-cards/installments.test.ts` e `src/modules/credit-cards/purchase-maintenance.integration.test.ts` (cancelamento do aggregate, reversão e ausência de parcela ativa). |
| Mês vazio, mudança de ano, mesmo dia, saldo e cenário | `src/modules/forecast/engine.test.ts` (14 testes: buckets vazios/virada de ano, agregação diária, abertura atrasada, menor saldo, `CONSERVATIVE`/`EXPECTED`, determinismo e precisão `bigint`); `src/modules/forecast/service.test.ts` (default civil e virada de ano); `src/modules/forecast/service.integration.test.ts` (saldo/compromisso tenant-scoped). |
| Origem explicável e boundary serializável | `src/modules/forecast/contracts.test.ts` (5 testes: referência top-level igual à origem, query sem `householdId`/autorização, datas/valores estritos, status cancelado rejeitado, round-trip JSON e erro code/field-only); `src/modules/forecast/builder.test.ts` e `src/modules/forecast/service.integration.test.ts` validam `referenceId` autorizado no resultado. |
| Isolamento, constraints, rollback e idempotência | `src/db/recurring-schema.test.ts` (3 testes de metadados), `src/db/recurring.integration.test.ts` (4 testes PostgreSQL) e `src/modules/recurring/use-cases.integration.test.ts` (1 teste PostgreSQL); `src/modules/forecast/sources.integration.test.ts` adiciona isolamento do reader de parcelas e saldo inicial. |
| Observabilidade sem dados financeiros crus | `src/modules/observability/s07.test.ts` (11 testes: allow-list, redaction, classificação, correlação e orçamento); `src/modules/forecast/builder.test.ts` e `src/modules/forecast/service.test.ts` exercitam os hooks T04/T06 com telemetria agregada. |

### Execuções registradas

- [x] `rtk npm exec vitest -- run src/modules/forecast/contracts.test.ts --reporter=dot` — 5/5.
- [x] `rtk npm exec vitest -- run src/modules/forecast/engine.test.ts --reporter=dot` — 14/14.
- [x] `rtk npm exec vitest -- run src/modules/recurrences/recurrence.test.ts src/modules/recurring/validation.test.ts --reporter=dot` — 11/11.
- [x] `rtk npm exec vitest -- run src/db/recurring-schema.test.ts --reporter=dot` — 3/3.
- [x] `rtk npm exec vitest -- run src/modules/observability/s07.test.ts --reporter=dot` — 11/11.
- [x] `rtk npm exec vitest -- run src/modules/forecast --reporter=dot` — 39/39 testes focados (3 testes de integração opt-in ignorados sem flag).
- [x] `rtk npm exec vitest -- run src/modules/forecast src/modules/recurrences/recurrence.test.ts src/modules/recurring/validation.test.ts src/db/recurring-schema.test.ts src/modules/observability/s07.test.ts --reporter=dot` — 64/64 testes unitários focados (3 integrações opt-in ignoradas sem flag).
- [x] `rtk npm test -- --reporter=dot` — 536 testes aprovados e 107 integrações opt-in ignoradas.
- [x] PostgreSQL descartável (`127.0.0.1:5433/financas_gomes_test`): T02 4/4, T03 1/1, T11 reader/builder 2/2 e T06 service 1/1 com `T02_INTEGRATION=1`, `T03_INTEGRATION=1`, `T06_INTEGRATION=1` e `T11_INTEGRATION=1`.
- [x] Engine/recorrência foram repetidos com `TZ=UTC`, `TZ=America/Sao_Paulo`
  e `TZ=Pacific/Kiritimati` — 22/22 testes em cada execução.
- [x] A suíte unitária completa de `src/modules/forecast` foi repetida nos
  mesmos três fusos — 39/39 testes focados em cada execução.
- [x] `rtk npm exec eslint -- src/modules/forecast/contracts.test.ts src/modules/forecast/sources.integration.test.ts --max-warnings=0` e `rtk git diff --check` — sem saída de lint/whitespace nos arquivos desta entrega.
- [x] `rtk npm exec eslint -- src/modules/forecast --max-warnings=0` — sem warnings em T04/T05/T06/T11.
- [x] `rtk npm run lint` foi executado; permanece apenas um warning preexistente fora
  de T11 em `src/db/recurring.integration.test.ts:2` (T02, import não usado).
- [x] `rtk npm run typecheck` e `rtk npx tsc --noEmit --pretty false --incremental false` foram executados; permanece um diagnóstico preexistente em `src/modules/forecast/engine.ts:389` (conversão `Record<string, unknown>` para `ForecastSource`, T05), sem diagnóstico nos arquivos T11/T04/T06.

## Verificações

- Executar testes focados e integração PostgreSQL, lint/typecheck afetados e `rtk git diff --check`.

## Fora de escopo

E2E de browser e smoke de produção.
## Subtarefas

- [x] Mapear critérios de aceite a testes unitários e integração disponíveis;
  matriz e evidências finais estão registradas acima.
- [x] Implementar e executar cobertura incremental de contrato, domínio,
  schema, reader, builder e engine.
- [x] Fechar a cobertura do serviço T06 e registrar a auditoria final; os
  testes de serviço unitários e PostgreSQL foram executados.
