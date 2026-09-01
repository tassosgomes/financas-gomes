# T15 — Testes unitários e integração PostgreSQL

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluído localmente — a matriz T02/T05–T09 foi verificada em
  PostgreSQL real em 2026-08-31. Os gates finais passaram: unitários (72
  arquivos/468 testes), integração agregada (23 arquivos/93 testes) e T09
  dedicado (6/6, habilitado explicitamente), lint, typecheck, build e checks
  de migrations. O release publicado e a observabilidade publicada permanecem
  sob o bloqueio externo registrado em T17.
- Onda: 4
- Dependências: T02–T10; T11–T14 fornecem contratos de UI para testes de boundary
- Paralelização: Unitários podem começar em T03/T04; gate final após todo o backend

## Objetivo

Construir a matriz automatizada que prova precisão, calendário, integridade,
isolamento, atomicidade, idempotência e ausência de dupla contagem do S06.

## Escopo

- Unitários de `Money`, divisão/remainder, limite de N, aggregate e transições
  de parcela.
- Unitários de billing cycle: antes/no/depois do fechamento, vencimento
  menor/igual/maior, fim de mês, fevereiro/bissexto, ano novo, vigência e
  override.
- Testes de validation/commands/actions para valor, datas, IDs, categoria,
  conta de pagamento, cartão arquivado, campos não editáveis e mensagens.
- Integração PostgreSQL de migration, enums, checks, FKs compostas,
  unicidades, intervalos de billing, `RESTRICT`, entries e ausência de saldo
  armazenado.
- Integração de criação de cartão/compra: 1x, múltiplas parcelas, rounding,
  snapshot da regra, rollback de cada etapa, command retry e corrida.
- Integração de projections: fatura atual/futura, obrigação, limite, crédito,
  cancelamento, payment global e não-duplicidade de item/event/entry.
- Integração de pagamento: exatamente duas entries, soma zero, overpayment,
  rollback, cross-tenant, conta inválida e idempotência.
- Integração de edição/cancelamento: histórico, reversal/efeitos
  compensatórios, parcelas futuras canceladas, no máximo um cancelamento e
  nenhuma parcela órfã.
- Testes de redaction/observabilidade de T10 e contratos serializáveis de T11;
  dados de teste devem ser sintéticos e identificáveis como fixtures.

## Critérios de aceite

- [x] Cada critério de aceite do documento S06 possui pelo menos uma asserção
  automatizada na camada adequada.
- [x] Testes comprovam isolamento negativo com dois households para cartão,
  regra, compra, parcela, fatura e pagamento.
- [x] Falhas injetadas não deixam registros parciais nem command reservado
  indevidamente.
- [x] A soma econômica e a soma do schedule são verificadas com `bigint`;
  nenhum teste usa float para decidir resultado.
- [x] Projections não contam evento total, entries e installments duas vezes.
- [x] Suíte roda em PostgreSQL real descartável, sem depender de dados de
  produção ou edição manual do banco.

## Progresso incremental — domínio T03/T04

- [x] T15-A — auditar a matriz mínima do ADR-007 contra os contratos puros de
  billing e parcelas, mantendo eventos, projections, pagamentos e UI fora
  desta etapa.
- [x] T15-B — adicionar matriz table-driven para compra antes/no/depois do
  fechamento, vencimento menor/igual/maior, fevereiro não bissexto/bissexto e
  virada dezembro→janeiro.
- [x] T15-C — adicionar matriz de divisão exata/remainder para 1x, 2x, 3x e
  valores grandes, além do limite operacional de 120 parcelas e rejeição de
  quantidade inválida ou parcela zerada.
- [x] T15-D — verificar materialização imutável, seleção de regra versionada,
  soma `bigint`, publicação, saldo futuro e cancelamento integral do aggregate.
- [x] T15-E — verificar falha fechada para sequência duplicada, snapshot de
  data divergente, estado parcial incompatível e total declarado incorreto.
- [x] T15-F — executar a suíte unitária incremental, lint e typecheck focados;
  registrar resultados abaixo.
- [x] T15-H — cobrir contratos de update metadata/cancelamento de compra,
  campos não editáveis e isolamento do boundary em
  `purchase-maintenance.test.ts` (7 testes aprovados); reversal única,
  preservação de histórico, rollback, concorrência, retry e isolamento
  tenant-safe de persistência foram concluídos na suíte PostgreSQL T15-G.
- [x] T15-G — integrar a matriz com PostgreSQL, rollback, isolamento,
  idempotência, projections, pagamento e o restante do backend quando T02 e
  T05–T10 estiverem estáveis. As integrações S06 habilitadas registraram 16
  testes aprovados (T02 5, T06 4, T05/T08 3 e T07 projections 4), e a suíte
  dedicada de manutenção T09 registrou 6/6; o guard padrão do runner é
  documentado abaixo, sem deixar cobertura relevante sem execução.
- [x] T15-I — executar integração PostgreSQL do CRUD de cartão de T05,
  cobrindo retry idempotente, metadata, vigência/arquivamento de regra,
  conta inválida sem registro parcial e isolamento entre dois households (2
  testes em `src/modules/credit-cards/use-cases.integration.test.ts`).
- [x] T15-J — executar integração PostgreSQL do pagamento de T08, cobrindo
  exatamente duas entries, soma `bigint` zero, retry, reuso incompatível de
  command e isolamento tenant-safe (1 teste no mesmo arquivo).
- [x] T15-K — revalidar a integração PostgreSQL de compra parcelada de T06;
  os 4 testes existentes foram aprovados junto da suíte de banco descartável.
- [x] T15-L — revalidar os contratos de boundary de UI de T12/T13/T14; a suíte
  atual de componentes aprovou 29 testes em 9 arquivos, incluindo os 4 testes
  de detalhe de compra T14-E, estados/serialização e schedule parcelado com
  soma `bigint`.
- [x] T15-M — validar projections T07 em PostgreSQL real: 4 testes cobrem
  não-duplicidade event/entry/installment, fatura atual/futura, posição e
  obrigação, pagamento global parcial, overpayment/crédito, competência vazia
  de virada de ano e cross-tenant.

## Verificações

- Executar testes unitários focados e `rtk npm test`.
- Executar integração com PostgreSQL descartável e migrations limpas,
  registrando quantidade de testes, migrations e ausência de pendências.
- Executar `rtk npm run typecheck`, lint e `rtk npm run db:check:files`.
- Revisar cobertura por matriz de T01 e atualizar handoffs somente se uma
  decisão precisar ser formalmente alterada.

### Evidência incremental T15 — 2026-08-31

- [x] `rtk npm test -- --run src/modules/credit-cards/billing-cycle.test.ts
  src/modules/credit-cards/installments.test.ts
  src/modules/credit-cards/t15-domain-matrix.test.ts` — 3 arquivos e 47
  testes aprovados.
- [x] `rtk npm exec eslint -- src/modules/credit-cards/billing-cycle.ts
  src/modules/credit-cards/billing-cycle.test.ts
  src/modules/credit-cards/installments.ts
  src/modules/credit-cards/installments.test.ts
  src/modules/credit-cards/t15-domain-matrix.test.ts` — sem erros ou warnings.
- [x] Auditoria histórica: os dois diagnósticos reportados em
  `purchase-use-cases.ts` (builder `.for("update")` e retorno do factory sem
  `update`/`cancel`) foram corrigidos; a execução isolada de typecheck passou
  em 2026-08-31.
- [x] `rtk npm run typecheck` — execução global revalidada após T14-E, sem
  diagnósticos; os erros históricos de `React.useRouter` em
  `billing-screen.tsx` e do factory de T09 não reproduzem.
- [x] `rtk npm run build` — execução revalidada após T14-E, com bundle e rota
  dinâmica de detalhe `/credit-cards/[id]/purchases/[purchaseId]` gerados;
  o erro histórico de reexport Server Action não reproduz.
- [x] `rtk npm run lint` — execução global revalidada sem erros ou warnings; os
  avisos históricos de `financial-events-schema.ts` e `transactions/reads.ts`
  não reproduzem.
- [x] A matriz não usa `Date`, timezone ou `float` para decidir valores; datas
  são civis e valores permanecem strings/`bigint` até a asserção.
- [x] `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  T05_INTEGRATION=1 T08_INTEGRATION=1 npm exec vitest run --config
  vitest.integration.config.mts src/modules/credit-cards/use-cases.integration.test.ts
  --reporter=dot` — 3 testes aprovados em PostgreSQL descartável, com
  migrations aplicadas e fixtures sintéticas de dois households.
- [x] `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  T02_INTEGRATION=1 T06_INTEGRATION=1 npm exec vitest run --config
  vitest.integration.config.mts src/db/credit-cards.integration.test.ts
  src/modules/credit-cards/purchase-use-cases.integration.test.ts --reporter=dot`
  — 9 testes aprovados (5 de T02 e 4 de T06).
- [x] `rtk npm test -- --run src/components/credit-cards --reporter=dot` — 9
  arquivos e 29 testes de componentes T11–T14 aprovados, incluindo os testes
  T14-E.
- [x] ESLint focado no novo teste de integração e nos componentes T12/T13 — sem
  erros ou warnings.
- [x] A cobertura PostgreSQL/backend de projections e cancelamento/reversal
  completo de T09 foi integrada: `projections.integration.test.ts` (4 testes)
  e `purchase-maintenance.integration.test.ts` (6 testes) passaram juntos;
  T15-M e T15-G estão evidenciados no banco descartável.
- [x] Auditoria T09/T06: lint focado sem erros ou warnings; testes unitários
  focados (30 testes em 4 arquivos, incluindo 7 de manutenção) aprovados;
  integração PostgreSQL T09/T07 (10 testes) e `db:check:files` passaram.
- [x] `rtk npm run typecheck` — revalidado após T14-E sem diagnósticos; os
  erros históricos de T09/T07 e `React.useRouter` não reproduzem.
- [x] `rtk env
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  npm run test:integration` — execução concluída com 23 arquivos/93 testes
  aprovados; `purchase-maintenance.integration.test.ts` (T09) ficou skipped
  pelo guard (6 testes). T02-F agora restringe a leitura aos households dos
  fixtures e preserva a asserção de quatro regras; T07 passou 4/4. As suítes
  S06 habilitadas passaram 16 testes (T02 5, T06 4, T05/T08 3 e T07
  projections 4).
- [x] A correção de isolamento T02-F foi validada também no banco de teste
  com rows residuais de outro household: probe focalizado 5/5 e integração
  agregada 23/23 arquivos aprovados, sem alteração de tenancy ou constraints.
- [x] `rtk npm run lint` — a observação histórica sobre o warning de T16 foi
  superada pela remoção da variável não utilizada; o lint global final passou
  sem erros ou warnings.

### Fechamento local T15 — 2026-08-31

- [x] `rtk npm test -- --reporter=dot` — 72 arquivos passaram, com 468 testes
  aprovados; 24 arquivos/99 testes de integração permaneceram skipped apenas
  porque o comando unitário não habilita banco.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run test:integration -- --reporter=dot` — 23 arquivos/93 testes passaram; o único arquivo skipped no runner padrão foi T09 por seu guard explícito.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test T09_INTEGRATION=1 ./node_modules/.bin/vitest run src/modules/credit-cards/purchase-maintenance.integration.test.ts --config vitest.integration.config.mts --reporter=dot` — 1 arquivo/6 testes passaram, cobrindo update, cancelamento/reversal, retry/conflito, concorrência, rollback, isolamento e projeção/pagamento.
- [x] `rtk npm run typecheck`, `rtk npm run lint` e `rtk npm run build` — todos passaram; o build compilou as rotas dinâmicas sem erro de tipo/lint.
- [x] `rtk npm run db:check`, `rtk npm run db:check:files` e `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run db:migrate:status` — schema consistente; `Everything's fine` e 16 migrations aplicadas, 0 pendentes, 0 divergentes.

## Fora de escopo

Testar integração real com banco/operadora, valores financeiros reais,
performance de S07 ou E2E completo (T16).
