# T13 — Testes unitários e de integração

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — testes unitários, integração PostgreSQL e gate CI verificados em 2026-08-29.
- Onda: 6
- Dependências: T02–T07; fixtures de S01/S02
- Paralelização: O desenho e a escrita podem acompanhar o backend; execução final ocorre antes de T15

## Objetivo

Provar as invariantes do domínio e a atomicidade da persistência em PostgreSQL real.

## Escopo

- Reutilizar a infraestrutura Vitest/PostgreSQL real de S01; não usar SQLite como substituto.
- Criar fixtures determinísticas para dois tenants, usuários, contas, categorias ativas/inativas e categorias de receita/despesa.
- Cobrir unitariamente:
  - `Money` e precisão;
  - parsing/validação de data;
  - commands serializáveis;
  - sinais de receita/despesa;
  - regras de categoria e estados;
  - política de edição/cancelamento.
- Cobrir por integração:
  - migrations, FKs e checks;
  - criação de receita e despesa;
  - soma de saldo derivado;
  - valor zero/negativo e data futura;
  - conta inexistente, inativa, anterior a `tracking_started_on` e cross-tenant;
  - categoria nula, incompatível, inativa e cross-tenant;
  - rollback depois de falha entre inserts;
  - idempotência e command conflitante;
  - listagem, detalhe e filtros tenant-scoped;
  - edição de descrição/categoria;
  - cancelamento, reversal compensatório e bloqueio de cancelamento duplicado.
- Garantir isolamento/recriação do banco entre testes e ausência de dependência em dados reais.

## Critérios de aceite

- [x] Todos os critérios de aceite negativos de S03 têm teste automatizado: validações de `Money`/data/command e referências estão nos testes unitários de T02/T04; checks/FKs estão em T03/T13; create está em T05; reads/isolamento estão em T06; manutenção está em T07.
- [x] Há teste que comprova não haver registros parciais em falha entre inserts: T05 injeta falha no insert do entry e T07 injeta falha no entry do reversal, verificando rollback de commands, eventos e entries.
- [x] Há teste que comprova retry sem duplicidade: T05 cobre retry/conflicto de create e T07 cobre retry/conflicto de update/cancelamento, incluindo command ID independente por tenant.
- [x] Há teste que comprova neutralização do saldo após cancelamento: T07 confirma entries opostos e soma `0`; T06 confirma saldo derivado e histórico com reversal.
- [x] Há teste que comprova isolamento entre dois tenants: T04, T05, T06 e T07 exercitam queries/writes com IDs cross-tenant e respostas opacas.
- [x] A suíte roda de forma reproduzível localmente e no CI: `npm test` cobre unitários sem banco; `npm run test:integration` ativa todos os grupos PostgreSQL S03 e os grupos existentes sobre serviço descartável; o job de integração do CI usa esse script.

## Subtarefas e evidências

- [x] Criado contrato de fixtures determinísticas em [`src/test/s03-fixtures.ts`](../../src/test/s03-fixtures.ts), com dois usuários/tenants, contas `ACTIVE`/`ARCHIVED`, `tracking_started_on` e categorias `EXPENSE`/`INCOME` ativas/arquivadas, incluindo referência cross-tenant.
- [x] Adicionada suíte unitária [`foundation.test.ts`](../../src/modules/transactions/foundation.test.ts) (5 testes), verificando isolamento dos fixtures, vocabulários de evento, política de edição/cancelamento e comandos JSON-safe sem autoridade de tenant/status/origem ou campos financeiros não editáveis.
- [x] Mantidos como evidência de T02 os testes unitários existentes de [`domain.test.ts`](../../src/modules/transactions/domain.test.ts) e [`validation.test.ts`](../../src/modules/transactions/validation.test.ts), cobrindo `Money`, precisão em centavos, `Temporal.PlainDate`, datas futuras/limites, schemas estritos e erros estáveis.
- [x] Mantidos como evidência de T03 os testes PostgreSQL de [`financial-events.integration.test.ts`](../../src/db/financial-events.integration.test.ts), cobrindo migration, `bigint`, sinais, checks, FKs compostas, reversal único e `ON DELETE RESTRICT`.
- [x] Mantidos como evidência de T04 os testes unitários e PostgreSQL de [`references.test.ts`](../../src/modules/transactions/references.test.ts) e [`references.integration.test.ts`](../../src/modules/transactions/references.integration.test.ts), cobrindo contexto server-side, referências tenant-scoped, estados/categorias e ausência de registros após falha de validação.
- [x] Integrados os cenários de T05 em [`use-cases.integration.test.ts`](../../src/modules/transactions/use-cases.integration.test.ts): receita/despesa, sinais, datas futuras, referências inválidas, atomicidade, retry idempotente e command conflitante.
- [x] Integrados os cenários de T06 em [`reads.test.ts`](../../src/modules/transactions/reads.test.ts) e [`reads.integration.test.ts`](../../src/modules/transactions/reads.integration.test.ts): filtros, ordenação, listagem/detalhe, histórico, saldo derivado, sinais e isolamento.
- [x] Integrados os cenários de T07 em [`maintenance.integration.test.ts`](../../src/modules/transactions/maintenance.integration.test.ts): edição de descrição/categoria, `NULL`, conflitos de estado, cancelamento, reversal, rollback, retry e neutralização.
- [x] Coberto explicitamente o check de valor negativo em [`t13-foundation.integration.test.ts`](../../src/db/t13-foundation.integration.test.ts); o check de zero já é exercitado em T03 e a fronteira `Money` cobre valores não positivos.
- [x] Conectadas as flags `T03_INTEGRATION`–`T07_INTEGRATION` e `T13_INTEGRATION` ao script `test:integration`, mantendo a execução serial contra PostgreSQL descartável e habilitando o gate no CI.

## Verificações finais

- [x] `npm test`: 196 testes passaram; 40 testes de integração foram pulados quando executado sem flags/banco.
- [x] `npm run test:integration` com PostgreSQL 16 descartável (`DATABASE_URL` e `MIGRATION_DATABASE_URL` em `localhost:5433`): 40 testes passaram em 11 arquivos, incluindo 22 testes S03 (T03–T07 e T13).
- [x] `npm run lint`: concluído sem warnings/erros.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run db:check:files`: concluído sem divergências.
- [x] Migrations e fixtures foram recriadas/limpas pelos hooks das suítes; a execução combinada não dependeu de dados financeiros pré-existentes.

## Bloqueios

Nenhum bloqueio técnico restante para T13. A suíte de integração continua deliberadamente opt-in e requer PostgreSQL descartável/configuração `DATABASE_URL`; o CI já fornece esse serviço e chama `npm run test:integration`.
