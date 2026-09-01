# T10 — Fluxo de criação de receita/despesa

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — fluxo de criação, actions, revalidação e verificações concluídos em 2026-08-29.
- Onda: 5
- Dependências: T05 e T09
- Paralelização: Pode ser executada em paralelo com T11 e T12 quando os contratos das actions estiverem estáveis

## Objetivo

Conectar o formulário ao backend e entregar os caminhos rápidos de adicionar receita e despesa.

## Escopo

- Criar a rota/tela de novo lançamento no módulo `/transactions` e os pontos de entrada “Adicionar receita” e “Adicionar despesa”.
- Implementar Server Action fina:
  - recebe apenas command serializável;
  - valida Zod;
  - resolve o contexto da sessão;
  - chama `CreateExpense` ou `CreateIncome`;
  - traduz `Result` em sucesso/erro.
- Gerar/preservar `commandId` por tentativa para evitar duplicidade em retry.
- Após sucesso, revalidar a listagem e redirecionar ou mostrar confirmação com o lançamento criado.
- Exibir erros de campo e de negócio sem resetar dados úteis do formulário.
- Não fazer fetch geral no browser, não implementar lógica financeira na Server Action e não usar atualização otimista que possa mascarar falha de persistência.

## Critérios de aceite

- [x] É possível abrir o formulário diretamente para despesa ou receita — `/transactions/new?kind=EXPENSE` e `/transactions/new?kind=INCOME` selecionam a operação; a home e a listagem expõem os CTAs “Adicionar despesa”/“Adicionar receita”.
- [x] Criação válida resulta em feedback de sucesso e item visível na listagem — `TransactionCreateScreen` confirma o read model criado e oferece o link para `/transactions`; a action revalida a rota canônica após o commit.
- [x] Duplo submit/retry não duplica o evento — `commandForTransactionAttempt` preserva o mesmo `commandId` para retry idêntico, inicia novo ID quando o payload é corrigido e o port T05 mantém a idempotência `(household_id, commandId)`.
- [x] Erro do backend é mostrado de forma compreensível — o `TransactionForm` aplica erro de campo e geral sem resetar os valores; o adapter traduz o `Result` pelo vocabulário seguro do T08.
- [x] Usuário não consegue escolher tenant no payload — as actions recebem somente o command serializável estrito, validam antes de resolver contexto e `householdId`/status/origem/sinal continuam server-side no T05.
- [x] A listagem é revalidada imediatamente após o sucesso — `createExpenseAction`/`createIncomeAction` chama `revalidatePath("/transactions")` somente depois do resultado bem-sucedido do port.

## Subtarefas

- [x] Criadas as rotas autenticadas [`/transactions/new`](../../src/app/transactions/new/page.tsx) e layout do módulo, com leitura server-side de contas/categorias ativas e seleção segura de `kind`.
- [x] Criados os pontos de entrada reutilizáveis [`TransactionCreateEntryPoints`](../../src/components/transactions/transaction-create-entry-points.tsx) na home, na tela de criação e compatíveis com a listagem T11.
- [x] Implementado [`TransactionCreateScreen`](../../src/components/transactions/transaction-create-screen.tsx) sobre o contrato T09, mantendo opções fora do browser fetch, estados de sucesso/cancelamento e dados úteis do formulário em erros.
- [x] Implementado o adapter [`adapters.ts`](../../src/modules/transactions/adapters.ts), que valida Zod antes do contexto, escolhe exclusivamente `createExpense`/`createIncome` do port T05, converte erros e integra `logS03TransactionOperation`/`reportS03UnexpectedError` sem payload financeiro.
- [x] Implementadas as Server Actions [`transactions.ts`](../../src/app/actions/transactions.ts), recebendo apenas commands serializáveis e invalidando `/transactions` após sucesso.
- [x] Implementada a política de tentativa em [`transaction-create-attempt.ts`](../../src/components/transactions/transaction-create-attempt.ts), preservando `commandId` em retries idênticos e renovando-o quando os dados mudam.
- [x] Adicionadas coberturas do adapter e da política de `commandId` em [`adapters.test.ts`](../../src/modules/transactions/adapters.test.ts) e [`transaction-create-attempt.test.ts`](../../src/components/transactions/transaction-create-attempt.test.ts).

## Verificações

- [x] `npm test` — 193 testes passaram; 39 testes de integração opcionais foram pulados por dependerem de PostgreSQL/ambiente externo.
- [x] `npm run typecheck` — concluído sem erros.
- [x] `./node_modules/.bin/eslint` nos arquivos da T10 — concluído sem erros ou warnings.
- [x] `npm run build` — build Next.js concluído; as rotas `/transactions` e `/transactions/new` foram compiladas; permanece apenas o warning operacional preexistente sobre múltiplos lockfiles e inferência de workspace root.
