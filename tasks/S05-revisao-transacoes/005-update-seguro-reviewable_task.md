# T05 — Update seguro de transação revisável

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento — T05-A/T05-B, testes dedicados, integração PostgreSQL e lint concluídos; narrowing S03/S05 após enums ampliados verificado, publicação/commit permanece pendente e o typecheck global está bloqueado por S06
- Onda: 2
- Dependências: T02, T03 e S03
- Paralelização: Com T04 e T10; action de T06 depende desta task

## Subtasks

- [x] Revisar ADR-006, contrato S05, schemas atuais, linhagem S04 e helpers seguros de S03.
- [x] T05-A — publicar helpers puros de boundary, política e idempotência canônica em `review-use-cases.ts`.
  - [x] Boundary: `parseReviewUpdateCommand` delega ao schema estrito S05 e rejeita campos extras/proibidos.
  - [x] Policy: `assertReviewableUpdatePolicy` restringe POSTED/EXPENSE|INCOME/MANUAL|IMPORT e exige uma linhagem para IMPORT.
  - [x] Hash: `canonicalReviewUpdatePayload` e `hashReviewUpdateCommand` excluem `commandId` e campos derivados/protegidos.
  - [x] Integração do `buildReviewUpdateSet` na escrita persistente em T05-B.
- [x] T05-B — implementar `UpdateReviewableTransaction` com transaction única, lock tenant-scoped, linhagem IMPORT, categoria e idempotência persistida no worktree.
  - [x] Factory/port com Database injetável, reserva/retry de `application_commands`, lock tenant-scoped e update exclusivo de metadata.
  - [x] Validação de categoria, linhagem IMPORT e retorno S05 serializável mínimo.
  - [ ] Publicação/commit (não realizado no worktree compartilhado).
  - [x] Validação pela suíte dedicada executada: unitários e integração PostgreSQL passaram.
- [x] Criar testes unitários e integração dedicada para categoria nula, origem/linhagem IMPORT, rollback, retry, isolamento tenant e campos proibidos.
- [x] Rodar testes focados e lint dos arquivos T05/T06.
- [x] Rodar `rtk git diff --check`; nenhum whitespace foi reportado (o worktree mantém os arquivos como não rastreados).
- [!] Rodar typecheck curto/global: os quatro módulos S05 não têm diagnósticos após o narrowing; `rtk npm run typecheck` global permanece não verde por erros externos em `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts` (S06).

### Checkpoint 2026-08-30

T05-A foi publicado em `src/modules/transactions/review-use-cases.ts` sem
acesso ao banco: a boundary estrita, a política de evento/linhagem e o hash
canônico foram concluídos. A aplicação do update set em transaction, lock,
categoria, linhagem persistida, idempotência, testes e typecheck permanecem
pendentes para T05-B/T11. A única verificação desta etapa foi
`rtk git diff --check`.

### Checkpoint 2026-08-30 — pausa solicitada

T05-A permanece preservado e publicado. T05-B foi estendido localmente no
mesmo arquivo com factory/port, transaction tenant-scoped, reserva de
`application_commands`, retry, lock do evento, validação de categoria e
linhagem e retorno S05 mínimo. A publicação foi interrompida antes da suíte
dedicada, do `git diff --check` final e de qualquer integração PostgreSQL;
por isso T05-B permanece aberto e não é considerado concluído. A única
verificação nova comprovada neste checkpoint é `rtk npm run typecheck`, com
exit 0.

### Fechamento 2026-08-30

T05-B permanece implementado no worktree e foi marcado como concluído somente
no nível de implementação; a task geral continua em andamento porque não há
testes dedicados, integração PostgreSQL, lint ou commit/publicação. O check de
whitespace foi executado nos dois arquivos autorizados com
`rtk git diff --check --no-index /dev/null <arquivo>`: ambos retornaram exit 1
por serem arquivos não rastreados, sem qualquer diagnóstico de whitespace.
O typecheck curto registrado acima passou com exit 0.

### Auditoria final 2026-08-30

Os testes dedicados agora comprovam o contrato implementado: `rtk npm exec
vitest -- run src/modules/transactions/review-use-cases.test.ts
src/modules/transactions/review-adapters.test.ts` passou com 14 testes, e a
suíte PostgreSQL opt-in `rtk bash -lc 'DATABASE_URL=... T05_INTEGRATION=1 rtk
npm exec vitest -- run --config vitest.integration.config.mts
src/modules/transactions/review-use-cases.integration.test.ts'` passou com 5
testes. O lint dos arquivos T05/T06 passou com exit 0 e `rtk git diff --check`
não reportou whitespace.

`rtk npm run typecheck` havia passado após a sincronização de T04 antes do
alargamento de enums. Na reexecução atual, não há diagnósticos nos módulos T05
reparados, mas o processo global permanece não verde por erros externos em S06
e UI de cartões. Nenhum commit/publicação foi feito no worktree compartilhado.

### Retificação de compatibilidade de enums — 2026-08-30

- [x] T05 mantém a política fechada `POSTED` + `EXPENSE|INCOME` + `MANUAL|IMPORT`; os tipos persistidos mais amplos de S06 são rejeitados antes do update e não alteram a linhagem nem os campos financeiros.
- [x] `review-use-cases.ts` e `use-cases.ts` não apresentam mais os erros de TypeScript causados por `PLANNED|EXPECTED|PENDING|PURCHASE|TRANSFER`; o narrowing foi feito por guards de runtime, sem cast permissivo.
- [!] A execução atual de `rtk npm run typecheck` ainda falha fora de T05, em `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts` (S06), além de componentes de cartões; o reparo/autorização desses módulos permanece externo a esta task.

## Objetivo

Permitir que a revisão altere classificação e descrição de eventos manuais ou
importados sem sobrescrever efeitos financeiros ou apagar rastreabilidade.

## Escopo

- Implementar `UpdateReviewableTransaction` (nome final definido em T01/T02)
  para `financialEventId` pertencente ao household resolvido e com origem
  `MANUAL` ou `IMPORT`.
- Aceitar somente `description` e `categoryId`; exigir ao menos um campo
  presente. `categoryId: null` remove a classificação e devolve o item a
  `NEEDS_REVIEW` quando o evento estiver `POSTED`.
- Reusar a normalização de descrição de S03 e validar limite, controles e
  whitespace; validar categoria `ACTIVE`, mesmo household e mesmo tipo do
  evento. Categoria arquivada ou de tipo diferente deve falhar sem escrita.
- Permitir update somente de evento econômico `POSTED` revisável. Evento
  `CANCELLED`, `REVERSAL`, `SYSTEM` ou tipo fora de `INCOME`/`EXPENSE` não é
  alvo deste slice; manter cancelamento/reversal nas APIs próprias de S03.
- Ler/lockar o evento na transaction, revalidar a existência da linhagem
  importada quando `origin=IMPORT` e atualizar apenas metadata do evento e
  `updated_at`. Não tocar em amount, occurred date, account entry, status,
  origin, import batch/item, row ou external ID.
- Registrar `application_commands` na mesma transaction, com operação própria
  e hash canônico do payload. Retry do mesmo command retorna o mesmo read
  model; reuso com payload/operação diferente retorna `COMMAND_ID_REUSED`.
- Retornar o read model atualizado com source e `reviewState`, para que a UI
  não precise fazer uma segunda leitura insegura.
- Manter aliases de update manual de S03 somente se delegarem ao contrato
  comum sem ampliar silenciosamente campos ou permitir origem `SYSTEM`.

## Critérios de aceite

- [x] Categoria de evento `IMPORT` pode ser alterada sem recriar evento/entry e
  `origin=IMPORT` continua persistido.
- [x] Update de descrição importada não altera `transaction_import_items` nem
  remove `importId`, `rowNumber` ou `externalId` do detalhe.
- [x] Update com `categoryId=null` é aceito quando o command é válido e marca o
  evento como pendente; nenhum valor financeiro muda.
- [x] Conta/categoria/evento de outro tenant, categoria arquivada,
  incompatibilidade de tipo e evento não revisável falham sem registros
  parciais.
- [x] Retry idempotente não cria outro command/evento/entry; concorrência não
  cria duas alterações financeiras nem quebra a integridade da linhagem.
- [x] Campos proibidos enviados pelo cliente são rejeitados pelo boundary e
  não são ignorados de forma que pareça sucesso.

## Handoff

- T06 usa o port do use case e mapeia `Result` para a Server Action.
- T08/T09 usam o resultado para refresh/reidratação sem montar um novo payload.
- T11 cobre manual/importado, rollback, idempotência, tenant e preservação de
  origem/linhagem.

## Verificações

- [x] Unitários de command, descrição, categoria nula e regras de review.
- [x] Integração PostgreSQL com transaction/rollback, FKs compostas,
  `application_commands`, retry, origem `IMPORT` e snapshot antes/depois.
- [x] Lint dos módulos tocados.
- [!] `rtk npm run typecheck` tinha passado na evidência anterior; a execução
  atual confirma zero erros nos módulos T05, mas não fecha globalmente por S06
  (`financial-events-schema.ts`/`observability/s06.ts`) e UI de cartões.
