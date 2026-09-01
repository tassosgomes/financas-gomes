# T12 — Testes unitários, integração e E2E

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — testes unitários, integração PostgreSQL e E2E isolado validados em 2026-08-30; handoff entregue para T13.
- Onda: 4
- Dependências: T03, T06–T11
- Paralelização: Escrita incremental; execução final após a UI

## Subtarefas

- [x] Mapear os critérios de aceite de S04 para testes unitários, integração e E2E, distinguindo os gates disponíveis dos bloqueados por T06–T11.
- [x] Consolidar e executar a cobertura independente do parser, normalização, fingerprint, fixtures e limites (T03/T04).
- [x] Consolidar e executar a cobertura independente do schema/migrations, FKs compostas, isolamento e constraints no PostgreSQL (T02).
- [x] Consolidar e executar a cobertura de observabilidade segura, classificação de erros esperados e redaction (T09).
- [x] Executar os testes entregues por T07 para confirmação, persistência parcial, rollback, retry por command e isolamento de household.
- [x] Cobrir o use case/adapter de preview: autenticação, tenant isolation, staging, expiração/consumo e ausência de escrita no ledger (T06/T07).
- [x] Cobrir confirmação transacional e estratégia parcial: ledger, rollback, commandId e relatório (T07/T08).
- [x] Cobrir concorrência/retry e reimportação por fingerprint sem duplicidade, incluindo tentativa cross-household de consulta/confirm (T08).
- [x] Executar os testes entregues por T08 para relatório persistido, reordenação, duplicidade de conjunto e corrida de confirmações.
- [x] Executar os testes entregues por T10 para estados de upload, preview, confirmação explícita, contas e navegação da tela.
- [x] Implementar e executar o fluxo E2E isolado: conta → upload → preview → confirmação → resultado → transações, além de arquivo inválido e reenvio (T10/T11).
- [x] Executar os gates finais de T12 e registrar evidências, bloqueios e hand-offs sem alterar tasks de outros IDs.

## Progresso e evidências (2026-08-30)

- [x] Criada [`t12-fixture-matrix.test.ts`](../../src/modules/transaction-imports/t12-fixture-matrix.test.ts), que materializa CSV, HEX e as quatro receitas determinísticas do catálogo T04, exercitando as 38 fixtures, sinais, contagens, fingerprint e multiplicidade.
- [x] Criada [`transaction-imports.t12-schema.test.ts`](../../src/db/transaction-imports.t12-schema.test.ts), verificando o contrato Drizzle de lotes, staging e linhagem: colunas sem saldo/valor financeiro, FKs tenant-safe, índices de idempotência e checks de contagem/expiração.
- [x] Criada [`s04-t12-redaction.test.ts`](../../src/modules/observability/s04-t12-redaction.test.ts), verificando que IDs opacos e contagens agregadas atravessam a fronteira e que CSV, descrição, valor, filename, token e request body não atravessam.
- [x] Suítes independentes T12 (41 fixtures + 3 schema + 1 redaction) e parser T03 (8 unitários): 53 testes focados passaram; `npm run typecheck`, `npm run lint -- --no-cache` e `npm test -- --reporter=dot` passaram (282 testes unitários no total; 49 testes de integração opt-in permaneceram pulados).
- [x] Gates PostgreSQL opt-in executados no banco descartável `financas_gomes_test`: T02 passou 4/4 testes e T06 passou 5/5 testes; hooks removeram os dados dos IDs sintéticos ao final de cada suíte.
- [x] Hand-off T07 consumido: adapters T07/T06 passaram 11 testes unitários; PostgreSQL T02/T06/T07 passou 16/16 testes, incluindo dois households, contagens `valid/invalid`, eventos `IMPORT`, entries assinados, `application_commands`, retry concorrente e rollback por trigger.
- [x] Hand-offs T08/T10 consumidos: relatório/idempotência passou 3 testes unitários e 2 integrações; a tela/componentes passou 7 testes unitários adicionais. O conjunto focado desta retomada passou 66/66 testes, com typecheck e lint verdes.
- [x] PostgreSQL T02/T06/T07/T08 executado novamente no banco descartável: 18/18 testes passaram, incluindo reenvio ordenado, snapshot de relatório após limpeza do staging, corrida de fingerprint e isolamento de consulta.
- [x] Suíte unitária completa após T08/T10: 293 testes passaram e 58 integrações opt-in foram ignoradas sem configuração explícita; T12 não converteu skips em conclusão.
- [x] T11 consumido: contrato de resultado, retry seguro, duplicidade, reidratação e navegação prontos para o E2E; fluxo isolado em validação.
- [x] E2E S04 dedicado em banco separado `financas_gomes_t12_e2e`: os cenários de fluxo parcial (2 importadas + 1 erro), relatório/reidratação, navegação filtrada, reenvio bloqueado sem novo lote e arquivo estruturalmente inválido passaram 2/2.
- [x] Suíte E2E crítica completa no mesmo banco isolado: autenticação, S02, S03 e S04 passaram 7/7 em 3,0 min.
- [x] Integração completa com migrations aplicadas no banco separado `financas_gomes_t12_integration`: 15 arquivos e 58 testes passaram, incluindo T02/T06/T07/T08, isolamento, rollback, retry, concorrência e relatório.
- [x] Gates de schema/migration: `db:migrate:status` reportou 11 aplicadas, 0 pendentes e 0 divergentes; `db:check:files` reportou configuração Drizzle consistente.

### Bloqueios e hand-offs

- [!] Ressalva preexistente de T04, sem bloqueio do gate T12: o catálogo tem cinco expectativas que não coincidem com o parser T03 — `invalid-header` contém coluna desconhecida (`CSV_UNKNOWN_COLUMN`), `field-too-large` é erro por linha, NUL é rejeitado como `CSV_INVALID_UTF8` no limite de bytes, `empty-row` também recebe erros de campos vazios e `mixed-valid-invalid` aponta linha 4 embora o erro esteja na linha 3. A suíte mantém overrides explícitos somente para essas divergências; T13 deve reconciliar manifesto/contrato.
- [x] Preview, confirmação, relatório/idempotência e UI de T10/T11 estão cobertos; E2E isolado, integrações e migrations passaram. Gate de T12 entregue a T13.

### Handoff para T13

- [x] T12 concluída: `npm test` passou 299 testes (58 integrações opt-in ignoradas nesse modo), `npm run test:integration` passou 58/58, E2E dedicado passou 2/2 e a suíte crítica passou 7/7.
- [x] Critérios de aceite T12 atendidos: matriz parser/limites, FKs/constraints, observabilidade/redaction, cross-household preview/confirm/report, concorrência/retry sem duplicidade e fluxo conta → upload → preview → confirmação → resultado → transações.
- [!] Ressalva preexistente de T04: as cinco expectativas divergentes estão cobertas por overrides explícitos na matriz T12; T13 deve decidir/reconciliar manifesto e parser antes do release, sem reabrir a evidência E2E.
- [!] O E2E foi executado localmente contra PostgreSQL descartável com fake auth; T13 permanece responsável por repetir os gates no pipeline/alvo de release e pelo smoke publicado.

## Objetivo

Comprovar comportamento financeiro, segurança de tenant e experiência crítica de ponta a ponta.

## Escopo

- Unitários do parser/normalização/fingerprint: válidos, cabeçalho, datas, centavos, vazios, quotes, encoding e limites.
- Integração PostgreSQL: FKs compostas, tenant isolation, rollback, `application_commands`, conflito de fingerprint e criação correta de evento/entry.
- Confirmar que preview não escreve ledger e que linhas inválidas seguem a estratégia parcial documentada.
- E2E: selecionar conta → upload válido → preview → confirmar → resultado → transações; cobrir arquivo inválido e reenvio do mesmo conjunto.
- Usar fixtures sintéticas e testar que logs/Sentry não recebam conteúdo financeiro.

## Critérios de aceite

- [x] Todos os critérios de aceite de S04 têm teste mapeado e executado no ambiente adequado.
- [x] Há teste de tentativa cross-household para preview, confirmação e consulta de lote.
- [x] Há teste de concorrência/retry que prova ausência de duplicidade.
- [x] E2E usa banco isolado e não depende de estado de produção.
