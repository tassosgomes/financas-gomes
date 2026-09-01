# T05 — Contratos de UI e componentes de importação

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — contratos serializáveis, componentes reutilizáveis e
  testes de UI concluídos em 2026-08-30.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02–T04

## Objetivo

Preparar componentes acessíveis e contratos serializáveis para upload, prévia e resultado sem acoplar regra financeira ao client.

## Escopo

- Definir view models para preview, erros por linha, bloqueio por duplicidade e relatório final.
- Criar componentes reutilizáveis de seletor de conta, file picker/dropzone, tabela de prévia e sumário de erros/contagens.
- Cobrir estados loading, arquivo inválido, nenhuma linha válida, confirmação em andamento e retry seguro.
- Manter Server Actions como adapters finos; tokens e `commandId` são opacos e gerados/validados conforme o contrato.

## Critérios de aceite

- [x] Componentes não calculam saldo, fingerprint ou classificações financeiras.
- [x] Estados de erro são acessíveis e não expõem dados além do que o usuário enviou.
- [x] O contrato acomoda linhas válidas e inválidas no mesmo preview.

## Subtarefas

- [x] Definir view models serializáveis de preview, confirmação, resultado,
  duplicidade, contagens e erros sanitizados conforme ADR-005.
- [x] Definir o payload mínimo de confirmação e os adapters tipados sem aceitar
  autoridade de conta, household, linhas ou fingerprint no cliente.
- [x] Criar componentes reutilizáveis de seleção de conta, file picker/dropzone,
  tabela de prévia e sumário de erros/contagens com estados acessíveis.
- [x] Cobrir loading, arquivo inválido, nenhuma linha válida, confirmação em
  andamento, retry seguro e bloqueio por duplicidade com testes de UI/contrato.
- [x] Validar os limites de T05, registrar evidências e concluir o status sem
  alterar tasks de outros IDs.

## Entregas e evidências (2026-08-30)

- [x] Contratos `CsvImportPreview`, `CsvImportConfirmationResult`,
  `ConfirmTransactionImportCommand` e `S04Error` em
  [`src/modules/transaction-imports/contracts.ts`](../../src/modules/transaction-imports/contracts.ts),
  com comando estrito de apenas `commandId` e `previewToken`.
- [x] View models e helpers em
  [`src/modules/transaction-imports/ui-contracts.ts`](../../src/modules/transaction-imports/ui-contracts.ts),
  incluindo bloqueios de zero válidas/duplicidade/expiração, mensagens de erro
  allow-listed, IDs opacos e reuso seguro de command em retry.
- [x] Schema estrito de confirmação em
  [`src/modules/transaction-imports/confirmation-validation.ts`](../../src/modules/transaction-imports/confirmation-validation.ts),
  rejeitando tenant, conta, linhas, fingerprint e flags de override.
- [x] Componentes reutilizáveis em
  [`src/components/transaction-imports`](../../src/components/transaction-imports):
  seletor de conta ativa, picker/dropzone, tabela de linhas válidas, sumário de
  contagens/erros e controle de confirmação/retry.
- [x] Testes de contrato e UI em
  [`ui-contracts.test.ts`](../../src/modules/transaction-imports/ui-contracts.test.ts)
  e [`transaction-imports-components.test.tsx`](../../src/components/transaction-imports/transaction-imports-components.test.tsx),
  cobrindo estados acessíveis, dados válidos + inválidos no mesmo preview,
  bloqueios, sanitização e autoridade mínima do command.

## Verificações finais

- [x] `rtk npx vitest run src/modules/transaction-imports --reporter=dot` —
  19 testes aprovados (parser T03, preview adapters e contratos T05).
- [x] `rtk npx vitest run src/modules/transaction-imports/ui-contracts.test.ts src/components/transaction-imports/transaction-imports-components.test.tsx --reporter=dot` — 11 testes aprovados.
- [x] `rtk npm test -- --reporter=dot` — 237 testes aprovados e 44 testes de
  integração ignorados por ausência de banco/configuração de integração.
- [x] `rtk npm run typecheck -- --pretty false` — aprovado.
- [x] `rtk ./node_modules/.bin/eslint src/modules/transaction-imports/contracts.ts src/modules/transaction-imports/ui-contracts.ts src/modules/transaction-imports/ui-contracts.test.ts src/modules/transaction-imports/confirmation-validation.ts src/components/transaction-imports --max-warnings=0 --no-cache` — aprovado.

## Handoff para T10–T11

- T10 pode importar `CsvImportAccountSelector`, `CsvFilePicker`/`CsvDropzone`,
  `CsvImportPreviewTable`, `CsvImportSummary` e `CsvImportConfirmation` do
  índice de componentes. Use `toCsvImportPreviewViewModel(preview)` para
  determinar `canConfirm`/`blockReason`; o servidor continua sendo a autoridade
  final para conta, expiração e token.
- T11 pode usar `toCsvImportResultViewModel(result)` e
  `CsvImportSummary` para distinguir `IMPORTED` de `DUPLICATE_DATASET`, exibir
  contagens e erros por linha sem transportar payload bruto.
- O adapter de confirmação deve aceitar `CsvImportConfirmationAction` e
  `ConfirmTransactionImportCommand`; `commandForCsvImportAttempt` mantém o
  mesmo `commandId` somente para retry do mesmo `previewToken`.
