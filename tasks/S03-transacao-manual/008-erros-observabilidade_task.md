# T08 — Erros e observabilidade segura

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — erros, redaction e observabilidade de create/update/cancel verificados em 2026-08-29; gates globais com bloqueios externos registrados abaixo.
- Onda: 1
- Dependências: T01
- Paralelização: Pode ser executada em paralelo com T02–T07; a instrumentação dos use cases integra depois de T05/T07

## Objetivo

Dar feedback compreensível ao usuário e diagnosticar falhas sem enviar dados financeiros sensíveis para logs ou Sentry.

## Escopo

- Mapear erros esperados de validação, tenant, conta/categoria, data, idempotência, estado e não encontrado para mensagens estáveis de UI.
- Manter `Result<T, E>` para falhas esperadas; deixar exceptions para bugs, indisponibilidade do banco e falhas inesperadas.
- Instrumentar create, update e cancel com operação, tipo, event ID opaco, duração e resultado técnico.
- Adicionar breadcrumbs/contexto do fluxo sem valor, descrição, nome de conta/categoria, notas, cookies, tokens ou payload financeiro.
- Enviar falhas inesperadas de persistência ao Sentry com ambiente/release e IDs opacos quando disponíveis.
- Definir redaction/testes para impedir logging acidental do command completo.
- Documentar a diferença entre erro de negócio exibível e erro técnico monitorado.

## Critérios de aceite

- [x] Cada erro esperado tem mensagem acionável e não expõe SQL/stack.
- [x] Os adapters de create/update/cancel enviam falhas inesperadas relevantes
  ao Sentry com contexto técnico seguro.
- [x] Logs e breadcrumbs não contêm amount, descrição, conta, categoria ou payload financeiro.
- [x] Existe teste automatizado de redaction para logs, contexto Sentry e erros esperados.
- [x] Idempotência e falhas de persistência têm contexto suficiente para diagnóstico.

## Subtarefas

- [x] Estendida a allow-list compartilhada para `transaction`, `cancel`,
  `transactionKind` e `eventId` opaco, sem aceitar payloads arbitrários.
- [x] Criado adaptador S03 para os nomes de operação da ADR-004, duração,
  resultado técnico, correlação e captura segura de falhas inesperadas.
- [x] Mapeados os 19 códigos de erro esperados para mensagens estáveis e
  campos públicos; detalhes de banco/stack permanecem fora do contrato.
- [x] Adicionados testes de logs/Sentry e redaction sem dados financeiros.
- [x] Documentada a diferença entre erro de negócio exibível e falha técnica
  monitorada em `docs/observability.md`.
- [x] Integrados `logS03TransactionOperation` e
  `reportS03UnexpectedError` aos adapters dos ports de create/update/cancel;
  os use cases T05/T07 mantêm falhas técnicas fora de `S03Result` conforme o
  contrato, deixando a captura na boundary server-side.

## Verificações

- [x] `npm test -- --run src/modules/observability` — 11 testes passaram.
- [x] ESLint focado nos arquivos de T08 — concluído sem warnings/erros.
- [!] `npm run typecheck` — falha em arquivos paralelos de UI (`transaction-detail-screen.tsx`):
  `AccountBalanceReadModel` não exportado, incompatibilidade de `CategoryReadModel`
  e parâmetro `current` implícito; nenhum erro nos arquivos de T08.
- [!] `npm run lint` global — quatro warnings nos mesmos arquivos paralelos
  (`transaction-detail-screen.tsx` e `app/transactions/[id]/page.tsx`), sem
  warnings nos arquivos de T08.
- [x] `npm test` completo — 201 testes passaram e 40 testes de integração
  opcionais foram pulados; nenhum teste de observabilidade falhou.
- [!] `npm run build` — bloqueado por imports Node (`fs`, `dns`, `net`, `tls`)
  da cadeia `pg` introduzida pela UI paralela de detalhe; não alcança os
  adapters de T08. Permanece também o warning operacional de múltiplos
  lockfiles.
