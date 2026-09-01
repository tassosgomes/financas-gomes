# T06 — Serviço de projeção, contrato e desempenho

- Slice: S07 — Fluxo futuro
- Status: Concluída — evidência `EXPLAIN (ANALYZE, BUFFERS)` sob volume sintético registrada em 2026-08-31; não houve necessidade de alterar índices ou SQL.
- Onda: 2
- Dependências: T02–T05, S03 e S06
- Paralelização: Com T07/T08; bloqueia T09 e T10

## Objetivo

Publicar uma query server-side por período que monta fontes, executa o motor e oferece contrato estável para S08 e S10.

## Escopo

- Implementar `getForecast` (ou nome decidido em T01) com `from`, `to`, cenário e filtros permitidos, validação Zod, `requireFinancialContext` e erro opaco.
- Retornar totais de entradas/saídas, saldo inicial/final/projetado, divisão realizado/previsto, timeline e origens; não expor tabelas ou IDs sensíveis além de `referenceId` autorizado.
- Definir paginação/limites para drill-down e política de horizonte que suporte navegação indefinida sem consulta descontrolada.
- Usar queries indexadas, joins tenant-scoped e shape serializável; evitar N+1 e medir casos representativos.

## Critérios de aceite

- [x] Trocar mês/período recalcula os totais corretos, inclusive em mudança de ano.
- [x] Resultado cross-tenant é indistinguível de inexistente e input inválido não amplia a consulta.
- [x] O contrato não duplica fontes e pode ser usado por S08 sem importar implementações internas.
- [x] Consulta sob volume sintético tem plano/limites documentados e não registra conteúdo financeiro.

## Handoff e verificações

- T09 consome o resumo/timeline; T10 consome referências; S08/S10 recebem types públicos.
- Integração PostgreSQL com período vazio, parcelas, recorrência, cancelamento, isolamento e `EXPLAIN` quando necessário.

## Fora de escopo

Endpoint público, cache compartilhado que crie inconsistência e dashboard consolidado do S10.
## Subtarefas

- [x] Implementar boundary server-side e validação do contrato público.
- [x] Integrar readers/builder/engine com contexto financeiro tenant-safe.
- [x] Cobrir desempenho, erros opacos e evidências de aceite.

## Entrega e evidências (2026-08-31)

- [x] `src/modules/forecast/service.ts` expõe `getForecast`/`createForecastService`:
  valida somente `from`, `to` e `scenario` com o schema Zod estrito, resolve
  `requireFinancialContext()` no servidor, passa o contexto aos readers
  tenant-scoped e valida o `ForecastTimeline` serializável na saída.
- [x] `src/app/actions/forecast.ts` fornece a Server Action
  `getForecastAction`; aliases de leitura não adicionam campos de autoridade
  nem aceitam `householdId`.
- [x] O mês civil default é derivado pelo relógio server-side. `from`/`to`
  parciais completam o mês correspondente; datas invertidas e cenários inválidos
  retornam apenas `code`/`field`.
- [x] Limites operacionais explícitos (default de 120 meses/3.660 dias e
  250.000 fontes/itens, configuráveis por ambiente/dependência e limitados por
  hard caps) são verificados antes da consulta e após a montagem; nenhum array
  é truncado. Excesso retorna `FORECAST_RANGE_TOO_LARGE`.
- [x] `ForecastServiceError` e `toS07ErrorEnvelope` tornam falhas de contexto,
  ausência cross-tenant, inconsistência, validação e infraestrutura opacas;
  observabilidade usa `createS07ForecastOperation`, `measureS07Query` e
  `withS07ForecastObservability` sem valores, descrições, SQL ou referências.
- [x] `src/modules/forecast/service.test.ts`: 7 testes focados cobrem saída
  serializável, default/virada de ano, strict query sem tenant, intervalo
  invertido/limite sem leitura, contexto opaco, bundle estrangeiro e hard caps.
- [x] `src/modules/forecast/service.integration.test.ts`: PostgreSQL
  descartável cobre saldo de abertura, compromisso planejado, cálculo final e
  isolamento entre households; `sources.integration.test.ts` confirma a
  integração de parcela única com T04.

### Evidência de desempenho — EXPLAIN controlado (2026-08-31)

- [x] A captura foi feita em PostgreSQL descartável
  (`127.0.0.1:5433/financas_gomes_test`) dentro de uma transação que terminou
  com `ROLLBACK`; não houve leitura nem escrita de dados reais. O dataset
  artificial continha dois households, cada um com 20.000 eventos realizados,
  5.000 eventos de compra/parcelas, 20.000 entries, 10.000 regras, 10.000
  ocorrências, 10.000 eventos planejados, 730 feriados e 5.000 parcelas. Todas
  as tabelas foram `ANALYZE` antes da medição.
- [x] Foram capturados os sete SQLs efetivamente usados pelos readers de T04:
  saldo de abertura, realizados, join de recorrências, feriados, regras,
  eventos planejados e parcelas, no intervalo sintético de um ano, com
  `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)`.

| Leitura | Caminho observado | Execução | Buffers hit |
| --- | --- | ---: | ---: |
| Saldo de abertura | `Bitmap Heap Scan` + `Bitmap Index Scan` em `account_entries_household_account_posted_on_idx` | 2,128 ms | 380 |
| Realizados | `Hash Join`; entries por bitmap/index e eventos por `Seq Scan` tenant-scoped | 17,081 ms | 1.234 |
| Recorrências | `Hash Join`; occurrences/events por `Seq Scan` tenant-scoped, rules por bitmap e `Memoize` no join opcional | 28,004 ms | 1.613 |
| Feriados | `Seq Scan` tenant-scoped + sort de 730 linhas | 0,456 ms | 19 |
| Regras | `Bitmap Heap Scan` + `Bitmap Index Scan` tenant-scoped + sort | 6,539 ms | 418 |
| Eventos planejados | `Hash Left Join` com scans tenant-scoped e sort | 24,583 ms | 1.851 |
| Parcelas | índice tenant/ciclo em `installments`, joins por PK/índice de evento e sort | 32,421 ms | 45.335 |

O pior plano executou em 32,421 ms, muito abaixo do threshold de lentidão de
250 ms e do orçamento operacional de 2.000 ms definidos em T07. Os scans
sequenciais são de relações amplas já reduzidas ao household (10–25 mil linhas)
e não indicam filtro ausente; as relações seletivas usam os índices compostos
tenant/data existentes. A captura não mostrou N+1 nem sort/temp spill. Portanto,
nenhum índice ou rewrite foi adicionado: a evidência não justifica custo de
escrita/manutenção adicional. O plano completo permanece como artefato local
protegido, conforme `docs/observability-s07-forecast.md`.

### Verificações executadas

- [x] `rtk npx vitest run src/modules/forecast/service.test.ts --reporter=dot`
  — 7/7 testes.
- [x] `rtk npx vitest run src/modules/forecast --reporter=dot` — 38 testes
  aprovados, uma integração opt-in ignorada sem banco.
- [x] PostgreSQL descartável em `127.0.0.1:5433/financas_gomes_test`:
  `T06_INTEGRATION=1 T11_INTEGRATION=1` com as integrações de serviço e
  readers — 2/2 testes aprovados.
- [x] `rtk npm exec eslint -- src/modules/forecast/service.ts
  src/modules/forecast/service.test.ts src/modules/forecast/service.integration.test.ts
  src/app/actions/forecast.ts --max-warnings=0` — sem warnings.
- [x] O diagnóstico histórico de T05 foi corrigido; `rtk npm run typecheck`
  passou na auditoria T13.
