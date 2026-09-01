# T11 — Resultado, erros acionáveis e navegação para transações

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — resultado, duplicidade, erros acionáveis, retry seguro,
  navegação e reidratação do relatório concluídos em 2026-08-30.
- Onda: 3
- Dependências: T05 e T08
- Paralelização: Com T10

## Objetivo

Apresentar o efeito da confirmação de modo auditável e útil, sem esconder ignorados ou erros.

## Escopo

- Exibir sumário de importadas, inválidas, ignoradas por duplicidade e erros técnicos recuperáveis.
- Apresentar erros de linha com número/mensagem, sem duplicar conteúdo financeiro desnecessário em toast ou URL.
- Oferecer retorno à tela e link para `/transactions` filtrada por conta/período/origem quando suportado por S03.
- Tratar conjunto já importado e retry como resultado idempotente, não como sucesso ambíguo.

## Critérios de aceite

- [x] Resultado responde claramente o que foi e não foi criado.
- [x] Usuário consegue chegar aos lançamentos recém-importados.
- [x] Estado de falha de confirmação mantém instrução segura para retry sem produzir duplicação.

## Subtarefas

- [x] Mapear o contrato de resultado T05/T08 e os estados do fluxo T10.
- [x] Implementar tela de resultado para importação nova e conjunto já importado,
  com contagens e erros por linha acionáveis.
- [x] Implementar estados de falha recuperável e retry seguro, preservando o
  mesmo `commandId`/`previewToken` quando aplicável.
- [x] Integrar navegação para `/transactions` com filtros de conta/período/origem
  suportados, sem expor payload financeiro em URL/toast.
- [x] Cobrir resultado, duplicidade, erros, retry e navegação em testes de UI.
- [x] Validar T11, atualizar este checklist/status e registrar handoff para T12/T13.

## Entregas e evidências (2026-08-30)

- [x] Criado `CsvImportResult` em
  [`src/components/transaction-imports/csv-import-result.tsx`](../../src/components/transaction-imports/csv-import-result.tsx),
  com estados explícitos `imported`/`duplicate`, contagens completas,
  instrução sobre o que foi criado, consulta aos lançamentos e link para
  reabrir o relatório durável por `importId`.
- [x] Integrado o resultado ao fluxo T10 em
  [`csv-import-screen.tsx`](../../src/components/transaction-imports/csv-import-screen.tsx),
  preservando as linhas da prévia para derivar conta/período e mantendo o
  comando opaco para retry. O relatório também pode ser reidratado pela rota
  `/transactions/import?importId=...` por meio da action de relatório T08.
- [x] Criado `CsvImportRetryNotice` com mensagens allow-listed, orientação
  segura para retry idempotente e instrução de gerar nova prévia quando o token
  expirou, foi consumido ou não foi encontrado. Nenhum payload financeiro,
  token ou fingerprint é colocado em toast/URL.
- [x] Erros por linha continuam sanitizados pelo contrato T05 e agora exibem
  número, mensagem estável, campo amigável e orientação de correção; resultados
  `DUPLICATE_DATASET` mostram que nenhuma nova transação foi criada e preservam
  apenas o `existingImportId` opaco.
- [x] Adicionados testes em
  [`csv-import-result.test.tsx`](../../src/components/transaction-imports/csv-import-result.test.tsx),
  cobrindo resultado importado, conjunto repetido, erros/retry, navegação
  codificada e integração com relatório reidratado.

## Verificações

- [x] `rtk npx vitest run src/components/transaction-imports/csv-import-result.test.tsx src/components/transaction-imports/csv-import-screen.test.tsx src/components/transaction-imports/transaction-imports-components.test.tsx --reporter=dot` — 13 testes aprovados.
- [x] `rtk npm test -- --reporter=dot` — 299 testes aprovados; 58 testes de
  integração opt-in ignorados por ausência de banco/configuração.
- [x] `rtk npm run typecheck -- --pretty false` — aprovado.
- [x] `rtk proxy npm run build` — build Next.js aprovado; permanece apenas o
  warning preexistente de múltiplos lockfiles.
- [x] ESLint direto foi tentado nos arquivos da T11, mas o repositório já
  possui `.eslintrc.json` incompatível com o ESLint instalado (`ignorePatterns`
  no nível superior). O build/typecheck passou e nenhum arquivo de configuração
  fora do escopo da T11 foi alterado.

## Handoff para T12/T13

- T12 pode usar `CsvImportResult`, `CsvImportRetryNotice`,
  `csvImportTransactionsHref` e `csvImportResultHref` para validar resultado
  importado, `DUPLICATE_DATASET`, erros por linha, retry e ausência de dados
  sensíveis. A rota `/transactions/import?importId=<id>` consulta o relatório
  tenant-scoped T08 e trata ID inválido/cross-household como ausência.
- A navegação gera `accountId`, `from` e `to` somente quando há dados server-side
  da prévia; `origin=IMPORT` não é inventado enquanto a listagem S03 continuar
  restrita a `MANUAL` (o link usa apenas os filtros atualmente suportados).
  T12 deve manter essa condição ao escrever o E2E e validar a exibição dos
  lançamentos quando o suporte de origem estiver disponível.
- T13 deve repetir typecheck/build, confirmar o warning de lint/configuração sem
  introduzir alteração fora de T11, e executar o smoke de retry/duplicidade com
  a fixture sintética após habilitar o banco de integração.
