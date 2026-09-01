# T06 — Preview autenticado e tenant-scoped

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — preview autenticado, staging tenant-safe e verificações locais concluídos em 2026-08-30.
- Onda: 2
- Dependências: T02, T03, S01 e S02
- Paralelização: Com T09

## Subtarefas

- [x] Implementar use case/port de preview com contexto financeiro resolvido no servidor e conta ativa tenant-scoped.
- [x] Aplicar parser/fingerprint T03 e persistir apenas staging normalizado com token hash e expiração.
- [x] Consultar fingerprint confirmado somente no household/conta atuais e retornar preview serializável com contagens/erros sanitizados.
- [x] Expor Server Action fina para upload sem aceitar household, linhas ou fingerprint como autoridade do cliente.
- [x] Cobrir autenticação, isolamento entre households, expiração/consumo (consumo integrado no handoff T07), duplicidade, arquivo estrutural inválido e ausência de escrita no ledger.

## Objetivo

Implementar a action/use case que recebe o arquivo, valida a conta no contexto da sessão e devolve uma prévia segura sem gravar eventos financeiros.

## Escopo

- Derivar `FinancialContext` no servidor e validar que a conta existe, está ativa e pertence ao household atual.
- Aplicar parser T03 e calcular totais/candidatos/fingerprint sem confiar em metadados do browser.
- Consultar importação prévia tenant-scoped para sinalizar ou bloquear conjunto repetido antes da confirmação.
- Criar token de prévia de uso único/expirável, vinculado ao contexto, conta e conteúdo normalizado; persistir apenas o necessário.
- Retornar preview serializável, com erros acionáveis e sem escrever `FinancialEvent`/`AccountEntry`.

## Critérios de aceite

- [x] Preview de CSV válido não altera ledger nem saldo.
- [x] Conta de outro household é rejeitada antes de parse/persistência relevante.
- [x] Token é aleatório, hash-only, vinculado ao household/conta e expira em 15 minutos; consumo por confirmação fica no T07.
- [x] Arquivo estruturalmente inválido não gera token confirmável.

## Subtarefas e evidências

- [x] Criado [`use-cases.ts`](../../src/modules/transaction-imports/use-cases.ts), com `createCsvImportPreviewUseCase`, `previewCsvImport`, contexto validado, conta `ACTIVE` revalidada com lock e recálculo server-side do fingerprint.
- [x] Criado [`adapters.ts`](../../src/modules/transaction-imports/adapters.ts), com allow-list estrita de `accountId`/arquivo, suporte a `FormData`, mapeamento seguro de erros e resolução via `requireFinancialContext()`.
- [x] Criada a action [`transaction-imports.ts`](../../src/app/actions/transaction-imports.ts), que recebe somente a seleção da conta e o upload; campos de household, linhas e fingerprint são rejeitados.
- [x] Staging guarda somente `sha256(token)`, contexto, fingerprint, metadados técnicos, candidatos normalizados e erros sanitizados; o token bruto e o CSV não são persistidos.
- [x] Fingerprint confirmado é consultado por `(householdId, accountId, fingerprint)` e retorna `ALREADY_IMPORTED`/`existingImportId` sem revelar lotes de outro household.
- [x] Preview sem linhas válidas retorna relatório tokenless; falha estrutural retorna erro estável sem inserir staging.
- [x] Testes adicionados em [`preview-adapters.test.ts`](../../src/modules/transaction-imports/preview-adapters.test.ts) e [`preview.integration.test.ts`](../../src/modules/transaction-imports/preview.integration.test.ts), cobrindo boundary da action, autoridade tenant, token hash, expiração, duplicidade e não-escrita do ledger.

## Handoff para T07, T10 e T12

- [x] T07: consumir `transactionImportStaging` com `hashCsvImportPreviewToken(previewToken)`, sempre filtrando `householdId`; validar `expiresAt`/`consumedAt`, revalidar conta e apagar staging somente na transaction de confirmação bem-sucedida.
- [x] T07: usar `candidateRows`, `errors`, `datasetFingerprint`, `processedRows`, `validRows`, `invalidRows`, `sourceColumns` e metadados técnicos como fonte server-side; não aceitar conta, tenant, linhas ou fingerprint do command.
- [x] T10: chamar `previewCsvImportAction` (ou alias `previewTransactionImportAction`) com `{ accountId, file }` ou `FormData`; renderizar `CsvImportPreview`, bloquear token vazio/duplicidade e enviar confirmação somente com `{ commandId, previewToken }`.
- [x] T12: executar a suíte opt-in `T06_INTEGRATION=1`; fixtures de preview devem verificar zero `financial_events`/`account_entries`, isolamento cross-household, token hash-only, TTL de 15 minutos e duplicate status.

## Verificações

- [x] `rtk npx vitest run src/modules/transaction-imports/preview-adapters.test.ts --config vitest.config.mts`: 7 testes passaram.
- [x] `rtk npx vitest run src/modules/transaction-imports/preview-adapters.test.ts src/modules/transaction-imports/csv-parser.test.ts --config vitest.config.mts`: 13 testes passaram.
- [x] `preview.integration.test.ts` está pronto para PostgreSQL descartável e protegido por `T06_INTEGRATION=1` (não executado neste ambiente sem `DATABASE_URL`).
- [ ] `rtk npm run typecheck`/suíte global permanecem dependentes de correções em arquivos T12 não relacionados (erros em `t12-schema.test.ts` e `t12-fixture-matrix.test.ts`); não alterados nesta task.
