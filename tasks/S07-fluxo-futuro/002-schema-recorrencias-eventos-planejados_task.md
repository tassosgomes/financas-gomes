# T02 — Schema de recorrências, eventos planejados e integridade

- Slice: S07 — Fluxo futuro
- Status: Concluída — gate de release revalidado após correção do lint (2026-08-31).
- Onda: 1
- Dependências: T01, S03 e S06
- Paralelização: Com T03, T07 e T08 após o contrato; migration serial antes dos writers

## Objetivo

Persistir somente regras e exceções necessárias para gerar compromissos futuros, mantendo o forecast como derivação.

## Escopo

- Criar `recurring_rules`, overrides/`recurring_occurrences`, calendário de feriados e a representação de eventos planejados explicitamente decidida em T01; não persistir uma timeline ou saldo projetado.
- Usar `household_id`, UUIDv7, `DATE`, centavos inteiros, FKs compostas, checks de valor positivo, frequência `MONTHLY|YEARLY`, regra de dia V1 e unicidade `(recurring_rule_id, occurrence_key)`.
- Relacionar realização a evento/ocorrência sem duplicar `FinancialEvent`/`AccountEntry`; preservar `PLANNED|EXPECTED|POSTED|CANCELLED` e `include_in_conservative_forecast` quando aplicável.
- Criar índices para busca por household, vigência, ocorrência/período, status e referências de parcelas do S06; migrations reversíveis no procedimento já adotado.

## Critérios de aceite

- [x] Nenhuma regra, ocorrência, feriado ou compromisso pode cruzar household — todas as relações usam `household_id` e FKs compostas quando há recurso relacionado; o teste PostgreSQL T02 rejeita rule/occurrence cross-tenant e o reader sempre repete o predicado do contexto.
- [x] Override e realização não podem duplicar a mesma occurrence key — `recurring_occurrences_rule_key_uq` garante uma linha por `(recurring_rule_id, occurrence_key)`; vínculos de realização têm unicidade por fato e trigger de exclusividade entre fontes.
- [x] Alterar regra futura não reinterpreta regra/ocorrência histórica; a vigência é consultável — regras carregam `start_on`/`end_on` inclusivos e exceções persistem separadamente; o modelo não materializa timeline nem sobrescreve occurrence histórica.
- [x] Dados inválidos (zero, intervalo invertido, enum/data inválidos) falham no banco e na aplicação — checks/enums/`DATE` cobrem PostgreSQL; o normalizador puro de recorrência já cobre datas, vigência, frequência, regra de dia e centavos, com testes focados verdes.

## Handoff e verificações

- T03 usa writes/constraints; T04 consulta fontes normalizadas; T06 mede as queries.
- Gerar/aplicar migration no banco de integração e testar FK composta, unicidade, rollback e isolamento.

## Fora de escopo

Materializar ocorrências normais, cron/RRULE, integração de calendário externo e forecast persistido.
## Subtarefas

- [x] Mapear schema e invariantes do ADR-008: fontes V1, vigência inclusiva, chaves de ocorrência, estados, realização explícita e ausência de saldo/timeline persistidos.
- [x] Implementar migration/schema e acesso tenant-safe: `src/db/recurring-schema.ts`, exports em `src/db/schema.ts`, `src/modules/recurring/reads.ts` e migration `drizzle/20260831221511_opposite_slapstick.sql`.
- [x] Executar verificações e registrar evidência de aceite.

## Evidência T02 (2026-08-31)

- [x] `rtk npm run db:generate` gerou a migration `20260831221511_opposite_slapstick.sql`; `rtk npm run db:check:files` passou sem drift e o snapshot/journal foram atualizados.
- [x] Migration aplicada em PostgreSQL 16 descartável (`127.0.0.1:5433/financas_gomes_test`); status do runner: `17` aplicadas, `0` pendentes, `0` divergentes. As quatro tabelas, índices únicos e triggers S07 foram inspecionados no catálogo PostgreSQL.
- [x] `src/db/recurring-schema.test.ts`: 3/3 testes de metadados para colunas, checks, FKs compostas, índices e ausência de tabela de forecast/saldo.
- [x] `T02_INTEGRATION=1` em `src/db/recurring.integration.test.ts`: 4/4 testes PostgreSQL para FK composta/isolamento, unicidade da occurrence key, checks de valor/vigência/frequência, realização vinculada a fato `POSTED`, exclusividade de fonte, rollback e read tenant-safe.
- [x] `src/modules/recurrences/recurrence.test.ts`: 8/8 testes focados da validação pura de datas, vigência, frequência, regra de dia e centavos.
- [x] `rtk npm run typecheck` foi executado; diagnósticos restantes estão em `src/modules/recurrences/*` (trabalho paralelo de T03: união de opções/calendário e import de `BusinessCalendar`) e `src/components/forecast/forecast-badges.tsx` (T08: declarações export/local), sem referência aos arquivos de T02.

## Evidência T02 — re-release (2026-08-31)

- [x] Correção mínima aplicada em `src/db/recurring.integration.test.ts`: removido somente o import não utilizado `and` de `drizzle-orm`.
- [x] `rtk npm exec eslint -- src/db/recurring.integration.test.ts --max-warnings=0` e `rtk npm run lint` — exit 0, sem warnings.
- [x] `rtk npm run db:check` e `rtk npm run db:check:files` — schema consistente; 17 migrations aplicadas, 0 pendentes e 0 divergentes.
- [x] `rtk npx vitest run src/db/recurring-schema.test.ts src/modules/recurrences/recurrence.test.ts --reporter=dot` — 2 arquivos, 11/11 testes passaram.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test T02_INTEGRATION=1 npx vitest run --config vitest.integration.config.mts src/db/recurring.integration.test.ts --reporter=dot` — 1 arquivo, 4/4 testes PostgreSQL passaram.
- [x] `rtk npm run typecheck` — o único diagnóstico restante é `TS2352` em `src/modules/forecast/engine.ts:389` (T05); não há diagnóstico nos arquivos de T02.
- [x] `rtk git diff --check` — sem saída.

## Handoff T02 → T03/T04/T06

- T03 pode persistir regra/override/realização dentro de uma transaction; os enums e checks fecham estados, datas e centavos, e os comandos publicados já estão na allow-list única de `application_commands`.
- T04 deve usar `listRecurringSourcesForContext`/`listRecurringSources` ou as leituras específicas de `src/modules/recurring/reads.ts`; `householdId` não é aceito como autoridade de consulta e IDs cross-tenant retornam ausência.
- T06 pode filtrar por vigência, ocorrência/período e status usando os índices publicados; nenhuma timeline, saldo ou ocorrência normal é materializada por T02.
