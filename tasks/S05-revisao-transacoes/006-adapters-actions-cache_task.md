# T06 — Server Actions, adapters e revalidação

- Slice: S05 — Revisão e organização das transações
- Status: Concluída tecnicamente — adapters/actions/revalidação, integração UI,
  geração/bloqueio de `commandId`, testes focados e lint concluídos; os
  módulos S05 permanecem sem diagnóstico após o alargamento de enums, mas o
  typecheck global está bloqueado por S06; E2E de T12 e publicação/validação
  de T13 permanecem pendentes
- Onda: 3
- Dependências: T02, T04 e T05; contexto de S01
- Paralelização: Pode começar com scaffolding após T02/T05; integração serial com T08/T09

## Subtasks

- [x] T06-A — adaptar list/detail/summary/update ao fluxo `Zod → FinancialContext → use case`, com payloads e retornos serializáveis.
- [x] T06-B — expor Server Actions e aliases S05 sem acessar banco diretamente na camada de componente; aliases reexportados foram convertidos em wrappers `async` para atender à regra do Next em módulos `use server`.
- [x] T06-C — revalidar lista, detalhe e resumo somente após update confirmado; preservar falhas sem invalidar cache.
- [x] Integrar geração/bloqueio de `commandId` na camada de UI (T08/T09); as actions recebem o command já gerado pela tentativa.

## Objetivo

Expor leitura e update do S05 por boundaries finas, mantendo sessão,
validação, erros e cache sob responsabilidade do servidor.

## Escopo

- Criar/ajustar Server Actions para listar, detalhar, obter resumo e atualizar
  transação revisável, seguindo o fluxo `Zod → FinancialContext → use case`.
- Receber apenas valores serializáveis; nunca receber `householdId`, origem
  confiável, `source`, conta de destino, linha CSV, token ou objeto Drizzle.
- Resolver `requireFinancialContext()` no servidor e encaminhar a query/ID
  como entrada não confiável aos reads tenant-scoped.
- Revalidar `/transactions` e `/transactions/[id]` somente após sucesso
  confirmado. Preservar filtros, `review`, `search` e cursor no href/estado de
  navegação; não apagar o contexto ao voltar do detalhe.
- Separar erros de domínio esperados de falhas inesperadas. Mensagem pública
  deve ser acionável e sanitizada; falha inesperada deve ser reportada ao
  contrato de T10 e relançada/encapsulada conforme a convenção existente.
- Gerar `commandId` no início de cada tentativa de UI e impedir duplo submit;
  retry explícito deve reutilizar o command somente quando representa a mesma
  tentativa.
- Manter adapters de S03 compatíveis e adicionar nomes/aliases de S05 sem
  duplicar regra de domínio ou acessar banco diretamente no componente.

## Critérios de aceite

- [x] Uma chamada sem sessão não executa query nem update financeiro.
- [x] Um ID/conta/categoria fornecido pelo browser é sempre revalidado pelo
  contexto do servidor.
- [x] Sucesso de update invalida lista, detalhe e resumo; falha não mostra
  sucesso nem descarta filtros ativos.
- [x] Erros esperados retornam códigos estáveis; exceções técnicas não expõem
  SQL, payload, descrição, valor ou nome de conta.
- [x] Actions não serializam `bigint`, `Date`, `Temporal` ou records do ORM.
- [x] Tests de adapter cobrem payload desconhecido, command duplicado,
  categoria nula, erro esperado e falha técnica redigida.

## Handoff

- T08 injeta a action de update no editor rápido da lista.
- T09 injeta a mesma action no detalhe e recebe o read model completo.
- T10 integra request/operation IDs e revalidação sem logar conteúdo sensível.
- T12 usa as actions reais no fluxo E2E.

## Verificações

- [x] Testes focados dos adapters/actions.
- [x] `rtk npm run lint` nos arquivos tocados.
- [!] `rtk npm run typecheck`: nenhum erro nos módulos S05 consumidos por T06; o gate global não fecha por diagnósticos externos em `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts` (S06), além de UI de cartões.
- [x] `rtk npm run build` passou com exit 0 na evidência anterior à ampliação
  dos enums, após a correção da boundary de aliases S05; as rotas
  `/transactions` e `/transactions/[id]` foram compiladas e geradas.
- [!] O build/typecheck não foi reexecutado nesta rodada curta; a execução
  atual do typecheck já identifica somente bloqueios externos a T06 em S06 e
  UI de cartões, sem diagnóstico nos módulos S05 consumidos por T06.

### Auditoria final 2026-08-30

`rtk npm exec vitest -- run src/modules/transactions/review-use-cases.test.ts
src/modules/transactions/review-adapters.test.ts` passou com 14 testes; a
integração PostgreSQL opt-in de T05 passou com 5 testes. O lint dos arquivos
T05/T06 passou com exit 0 e `rtk git diff --check` não reportou whitespace.

O typecheck foi reexecutado após a sincronização de T04: os módulos S05
consumidos por T06 não apresentam diagnóstico, mas o comando global não fecha
por erros externos em `src/db/financial-events-schema.ts` e
`src/modules/observability/s06.ts` (S06), além de diagnósticos de UI de
cartões. A integração opt-in pertinente de T04/T05 e o teste de preview
autenticado de T06 permanecem como evidências históricas registradas acima.
Não foi feito commit/publicação no worktree compartilhado.

### Retificação do gate de tipos — 2026-08-30

- [x] A fronteira T06 continua compilável quanto aos quatro módulos S05 reparados (`reads.ts`, `review-reads.ts`, `review-use-cases.ts` e `use-cases.ts`).
- [!] A conclusão do typecheck global depende de correções externas de S06; T06 não altera `financial-events-schema.ts` nem `observability/s06.ts`.

### Fechamento da fronteira de commandId na UI — 2026-08-30

O teste de interação de T09 reproduziu dois `submit` no mesmo turno e
confirmou que o formulário de detalhe emitia duas chamadas antes da
re-renderização de `isSubmitting`. O guard síncrono em `TransactionForm` agora
impede a segunda chamada; a suíte focada passou com 4 testes, incluindo
`commandId` opaco, payload somente de metadata e botão bloqueado enquanto a
action aguarda. O quick-edit de T08 já possuía o mesmo guard e sua cobertura
continua passando.

### Correção da boundary — 2026-08-30

O build reproduzia `Only async functions are allowed to be exported in a "use
server" file` no reexport de `src/app/actions/transactions.ts`. Os dez aliases
S05 permanecem disponíveis no mesmo módulo, mas agora são funções `async`
explícitas que encaminham para `transaction-review`; nenhum contrato de
payload, contexto financeiro ou retorno de T06 foi alterado.
