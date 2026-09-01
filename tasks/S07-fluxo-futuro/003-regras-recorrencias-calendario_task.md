# T03 — Regras de recorrência, calendário e realização

- Slice: S07 — Fluxo futuro
- Status: Concluída — domínio puro, commands tenant-safe e realização persistida verificados em PostgreSQL em 2026-08-31.
- Onda: 1
- Dependências: T01; T02 para persistência final
- Paralelização: Lógica pura com T02/T07; integração final após T02

## Objetivo

Criar o domínio que produz ocorrências virtuais e as reconcilia com exceções e realizações reais.

## Escopo

- Implementar `MONTHLY`/`YEARLY`, `FIXED_DAY`/`FIRST_BUSINESS_DAY`/`LAST_BUSINESS_DAY`, `Temporal.PlainDate` e feriados por household.
- Gerar ocorrências sob demanda para qualquer intervalo, com occurrence key estável; normalizar dias inexistentes segundo T01.
- Aplicar `start_on`, `end_on`, substituição futura por nova regra, override de valor/data, skip/cancelamento e realização parcial/total se o contrato V1 a admitir.
- Expor commands tenant-safe para criar, editar prospectivamente, encerrar e registrar exceção/realização; todos idempotentes e transacionais.

## Critérios de aceite

- [x] Fevereiro, anos bissextos, virada de ano, fim de semana e feriado têm resultado testado e determinístico.
- [x] Uma realização relacionada retira/reduz exatamente a previsão correspondente, nunca ambas entram como receita/despesa futura; a reconciliação pura mantém realização parcial explícita e o write persiste somente o vínculo ao fato `POSTED`.
- [x] Edição prospectiva mantém histórico e overrides antigos válidos.
- [x] IDs de outra household não podem ler ou alterar regra, feriado ou ocorrência no boundary puro; commands e referências PostgreSQL repetem o predicado de `household_id`.

## Handoff e verificações

- T04 recebe itens normalizados sem SQL; T10 oferece manutenção/adição de compromissos.
- Testes unitários de calendário/gerador e PostgreSQL de vigência, override, concorrência, idempotência e tenant isolation.

## Evidência do domínio e da integração (2026-08-31)

- [x] `src/modules/recurrences/contracts.ts`, `calendar.ts` e `recurrence.ts`
  implementam o vocabulário V1 do ADR-008 sem SQL, Drizzle, `Date`, relógio
  implícito ou contexto de request. Datas são calculadas com
  `Temporal.PlainDate`; valores permanecem em centavos inteiros serializados.
- [x] `src/modules/recurrences/recurrence.test.ts`: 8 testes cobrindo datas
  estritas, fevereiro comum/bissexto, virada de ano, fim de semana/feriado,
  geração inclusiva e vigência, alteração prospectiva, override de data/valor,
  realização total/parcial, cancelamento, chaves estáveis, conflitos e
  isolamento tenant-safe.
- [x] `rtk npx vitest run src/modules/recurrences/recurrence.test.ts --reporter=dot`
  passou (1 arquivo, 8 testes).
- [x] `rtk ./node_modules/.bin/eslint src/modules/recurring
  src/modules/recurrences --max-warnings=0` e `rtk git diff --check` passaram.
- [x] `src/modules/recurring/validation.test.ts`: 3 testes de normalização
  canônica, rejeição de payload/resource inválido e override explícito.
- [x] `src/modules/recurring/use-cases.integration.test.ts`: 1 teste
  PostgreSQL cobrindo create/retry/`COMMAND_ID_REUSED`, edição prospectiva,
  encerramento, override, realização parcial `POSTED`, cancelamento,
  exclusividade de fato e isolamento entre households.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  T02_INTEGRATION=1 T03_INTEGRATION=1 npx vitest run --config
  vitest.integration.config.mts src/db/recurring.integration.test.ts
  src/modules/recurring/use-cases.integration.test.ts --reporter=dot` passou:
  2 arquivos e 5 testes.
- [x] O bloqueio histórico de typecheck externo foi resolvido no re-release de
  T05; `rtk npm run typecheck` passou no gate final T13.

## Fora de escopo

Cron, RRULE genérica, feriados automáticos e previsão probabilística.
## Subtarefas

- [x] Implementar regras puras de calendário e recorrência conforme ADR-008.
- [x] Integrar persistência/realização após schema disponível, usando
  `application_commands`, transações, FKs/constraints de T02 e vínculo
  explícito com `financial_events` `POSTED`.
- [x] Cobrir limites do calendário, isolamento e evidências de aceite no domínio puro.
