# T10 — Tela de importação, preview e confirmação

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — rota, fluxo upload → prévia → confirmação e validações
  concluídos em 2026-08-30.
- Onda: 3
- Dependências: T05, T06 e T07
- Paralelização: Com T11 após estabilizar o contrato de resultado

## Objetivo

Entregar o caminho do usuário de selecionar conta e arquivo até confirmar uma prévia compreensível.

## Escopo

- Criar rota de importação integrada à navegação de transações.
- Exibir link para documentação/formato e exemplo CSV, seletor de conta e upload com limites visíveis.
- Enviar arquivo ao preview, apresentar totais, amostra/paginação de linhas válidas e erros por linha.
- Exigir confirmação explícita, mostrar a estratégia parcial e desabilitar confirmação se não houver linha válida ou houver bloqueio de duplicidade.
- Controlar loading, cancelamento local, expiração de token e submit único.

## Critérios de aceite

- [x] Usuário vê quantas transações serão criadas antes de confirmar.
- [x] Erros estruturais e por linha são distinguíveis e acionáveis.
- [x] Não há criação de transações ao selecionar/uploadar arquivo.
- [x] UI não permite confirmar para conta inválida, preview expirado ou conjunto bloqueado.

## Subtarefas

- [x] Criar rota de importação e integrá-la à navegação de transações.
- [x] Implementar tela de upload com documentação do formato, exemplo CSV,
  seletor de conta e limites visíveis.
- [x] Implementar fluxo client de preview com loading, cancelamento local,
  expiração e tratamento de erros estruturais/por linha.
- [x] Renderizar totais, linhas válidas e erros por linha, sem recalcular dados
  financeiros no client.
- [x] Implementar confirmação explícita com estratégia parcial, bloqueios e
  submit único/retry seguro usando somente `commandId` e `previewToken`.
- [x] Cobrir rota, navegação e estados upload → prévia → confirmação com testes.
- [x] Validar T10, concluir checklist e registrar handoff para T11/T12/T13.

## Entregas e evidências (2026-08-30)

- [x] Criada a rota autenticada [`src/app/transactions/import/page.tsx`](../../src/app/transactions/import/page.tsx), que carrega contas ativas tenant-scoped e injeta apenas as Server Actions de preview/confirmação.
- [x] Criada a tela client [`csv-import-screen.tsx`](../../src/components/transaction-imports/csv-import-screen.tsx), com documentação e exemplo `s04-csv-v1`, limites de 5 MiB/10.000 registros/16 KiB, seleção de conta, upload, cancelamento local, expiração, paginação, resumo e estratégia parcial explícita.
- [x] A confirmação usa `CsvImportConfirmation` e recebe somente a action T07; o componente gera o payload estrito `{ commandId, previewToken }`, bloqueia conta/prévia inválida, duplicidade, expiração e zero linhas válidas, e impede duplo submit/retry inseguro.
- [x] Adicionado o ponto de navegação `Importar CSV` à lista/sidebar de transações e a rota canônica `TRANSACTION_IMPORT_ROUTE` em [`routes.ts`](../../src/modules/transactions/routes.ts).
- [x] Testes de tela/navegação adicionados em [`csv-import-screen.test.tsx`](../../src/components/transaction-imports/csv-import-screen.test.tsx) e [`transactions-list-screen.test.tsx`](../../src/components/transactions/transactions-list-screen.test.tsx).
- [x] `rtk npm test -- --reporter=dot` — 290 testes passaram e 56 de integração foram ignorados por ausência de configuração/banco.
- [x] `rtk npm run typecheck -- --pretty false` — aprovado.
- [x] ESLint local nos arquivos da T10 — aprovado com `--max-warnings=0 --no-cache`.
- [x] `rtk npm run build` — build Next.js aprovado.

## Handoff para T11/T12/T13

- [x] T11 pode substituir/estender a apresentação do resultado usando
  `toCsvImportResultViewModel`, mantendo o link para `/transactions` e os
  contadores/erros já sanitizados; a tela já diferencia `IMPORTED` de
  `DUPLICATE_DATASET`.
- [x] T12 pode exercitar a rota `/transactions/import`: o upload chama
  `previewCsvImportAction` via `FormData` (`accountId` + `file`), e a
  confirmação chama `confirmCsvImportAction` com apenas `commandId` e
  `previewToken`. A suíte unitária cobre contrato inicial e navegação; o E2E
  deve fornecer sessão, conta ativa e banco/fixtures opt-in.
- [x] T13 deve usar os checks de build/typecheck/lint acima e validar smoke
  publicado com a fixture sintética; nenhuma credencial, CSV bruto ou token é
  renderizado no resultado/log da tela.
