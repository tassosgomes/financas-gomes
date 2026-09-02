# T06 — Query tenant-safe e serviço de disponibilidade

- Status: Concluída
- Onda: 2
- Dependências: T02, T03, S07 e contexto financeiro S01
- Paralelização: Com T08; T05 integrada continuamente

## Objetivo

Compor saldo inicial, configuração do household, forecast de S07 e reserva
neutra em um único serviço server-side de disponibilidade.

## Subtarefas

- [x] Fechar a entrada `GetSpendableInput` no servidor, com `asOf`, cenário e
  horizonte estritos, defaults determinísticos e limites de T01.
- [x] Criar a relação effective-dated de configuração do buffer, com FK,
  unicidade por household/data, check de centavos não negativos e migration
  forward-only.
- [x] Implementar as leituras tenant-scoped de abertura `POSTED`/`GENERAL` e
  do buffer efetivo, sem usar o saldo household-wide de S07 como abertura.
- [x] Compor uma única leitura do forecast `s07.v1`, normalizar com T02,
  calcular com T03, usar o `ZeroReserveAdapter` de T08 e retornar só o DTO
  público versionado.
- [x] Integrar os quatro limites de observabilidade de T05 sem enviar valores,
  descrições, SQL ou referências financeiras aos eventos.
- [x] Cobrir isolamento, classes de recurso, configuração effective-dated,
  defaults, déficit, contrato de S07 e a porta de reserva com testes focados e
  integração PostgreSQL opt-in.

## Escopo

- Obter `householdId` somente de `requireFinancialContext`; validar `asOf`,
  cenário e horizonte dentro dos limites fechados em T01.
- Consultar saldo consolidado apenas de entries `POSTED` de contas GENERAL,
  com predicates tenant-scoped em todos os joins; recursos RESTRICTED e
  EXCLUDED ficam fora do global.
- Consumir o contrato S07, a configuração de buffer e a porta de reservas;
  chamar T03 e mapear somente o DTO público versionado.
- Retornar ausência/erro opaco para household inexistente ou não configurado,
  conforme T01; não persistir snapshot de spendable.
- Garantir que cartões/faturas/parcelas são consumidos exclusivamente pela
  fonte consolidada de S07, não por uma segunda query local.

## Critérios de aceite

- [x] Toda leitura é tenant-scoped e cross-tenant não revela existência nem valores.
- [x] Mesmos dados/configuração/entrada retornam o mesmo DTO.
- [x] Saldos `RESTRICTED`/`EXCLUDED` (incluindo benefício/investimento
  configurados como recursos não gerais) não aumentam o global.

## Entregáveis e evidências (2026-09-01)

- [x] [`src/modules/spendable/service.ts`](../../src/modules/spendable/service.ts)
  resolve o contexto por `requireFinancialContext`, valida a entrada fechada,
  calcula `asOf + 1 ... asOf + horizon`, consome S07 uma vez, aplica T02/T03,
  usa a reserva `s09.v1`/zero e serializa apenas `SpendableBreakdown`.
- [x] [`src/modules/spendable/query.ts`](../../src/modules/spendable/query.ts)
  repete `household_id` nos joins/predicados de abertura e configuração,
  soma somente `POSTED` de contas `GENERAL` e escolhe a última configuração
  `effective_from <= asOf`, com fallback explícito zero.
- [x] [`src/db/spendable-schema.ts`](../../src/db/spendable-schema.ts) e
  [`drizzle/20260902005306_s08-spendable-settings.sql`](../../drizzle/20260902005306_s08-spendable-settings.sql)
  publicam `spendable_settings` sem snapshot de spendable.
- [x] [`src/modules/spendable/service.test.ts`](../../src/modules/spendable/service.test.ts)
  cobre defaults, janela S07, buffer, zero reserve, déficit, input forjado,
  erro opaco e resposta cross-tenant.
- [x] [`src/modules/spendable/service.integration.test.ts`](../../src/modules/spendable/service.integration.test.ts)
  prepara PostgreSQL opt-in com dois households, GENERAL/RESTRICTED/EXCLUDED,
  configuração histórica/futura e isolamento; a execução é opt-in via
  `T06_INTEGRATION=1`.
- [x] `T06_INTEGRATION=1 DATABASE_URL=... rtk npm exec vitest -- run
  src/modules/spendable --reporter=dot` — 7 arquivos, 47 testes passaram,
  incluindo 2 testes PostgreSQL de isolamento tenant/configuração effective-dated.
- [x] `rtk npm run typecheck`, lint focado e `rtk git diff --check` passaram.
- [x] `rtk npm run db:check:files`/`drizzle-kit check` passaram com a migration
  e schema T06.

## Fora de escopo

Não foram implementados T07 (breakdown/origem adicional) nem T09 (card/UI);
T06 apenas entrega o DTO e a boundary server-side que esses consumidores usam.
