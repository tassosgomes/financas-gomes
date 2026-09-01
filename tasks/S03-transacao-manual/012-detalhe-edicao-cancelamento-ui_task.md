# T12 — Detalhe, edição e cancelamento na UI

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — rota de detalhe, manutenção segura, cancelamento com histórico e verificações concluídos em 2026-08-29.
- Onda: 5
- Dependências: T06, T07 e T09
- Paralelização: Pode ser executada em paralelo com T10 e T11 após os contratos do backend

## Objetivo

Permitir consultar e manter um lançamento sem induzir o usuário a uma exclusão destrutiva ou a uma alteração financeira silenciosa.

## Escopo

- Implementar `/transactions/[id]` com evento econômico, entry, conta, categoria, status e histórico de cancelamento/reversal.
- Implementar edição dos campos autorizados pela T01/T07, inicialmente descrição e categoria.
- Exibir valor, data, tipo e conta como somente leitura para eventos `POSTED`, com orientação clara para correção/cancelar-e-lançar novamente se aplicável.
- Implementar action de cancelamento com confirmação explícita, explicando preservação do histórico e efeito no saldo.
- Exibir estado cancelado e o evento compensatório sem permitir segundo cancelamento.
- Revalidar detalhe, listagem e saldo após sucesso; preservar filtros ao voltar para `/transactions`.
- Tratar não encontrado, tenant inválido, conflito de estado e falha inesperada de forma consistente com T08.
- Não criar modal genérico para correções complexas, refunds ou parcelamentos.

## Critérios de aceite

- [x] Usuário abre um lançamento a partir da listagem — T11 aponta para `transactionDetailHref`, preservando a query de filtros no link de `/transactions/[id]`.
- [x] Usuário edita descrição/categoria e vê o resultado persistido — `TransactionDetailScreen` usa `TransactionForm` em modo `edit` e envia somente o command T07 de metadata; a resposta atualiza o detalhe e chama `router.refresh()`.
- [x] Usuário cancela com confirmação e vê status/histórico atualizado — `CancelTransactionConfirmation` exige confirmação explícita e a resposta de T07 atualiza o evento para `CANCELLED`, exibe o reversal e informa a neutralização do saldo.
- [x] O saldo líquido reflete o cancelamento — a rota lê `transactionReadAccess.balance` por `accountId`/data e a tela aplica temporariamente o efeito oposto do entry enquanto a revalidação busca o saldo derivado do ledger.
- [x] O usuário não recebe uma ação de hard delete para evento `POSTED` — a UI oferece somente edição de descrição/categoria e cancelamento com reversal, com orientação para cancelar-e-lançar novamente quando o campo financeiro precisar mudar.
- [x] Um ID de outro tenant se comporta como não encontrado — a leitura T06 é tenant-scoped e a rota converte `EVENT_NOT_FOUND` em estado seguro de “Lançamento não encontrado”, sem expor a existência do ID.

## Subtarefas e evidências

- [x] Criada a rota Server Component [`page.tsx`](../../src/app/transactions/[id]/page.tsx), com leitura tenant-scoped do detalhe, contas/categorias para edição e saldo derivado; falhas de contexto, leitura e não encontrado têm estados seguros.
- [x] Criado [`transaction-detail-screen.tsx`](../../src/components/transactions/transaction-detail-screen.tsx), mostrando evento econômico, entry assinado, conta, categoria, status, saldo e histórico original/reversal em layout responsivo.
- [x] Integrados os actions de manutenção T07 em [`src/app/actions/transactions.ts`](../../src/app/actions/transactions.ts) e no adapter T08/T12, sem tenant no payload; update/cancel invalidam listagem, detalhe e projeção de saldo após sucesso.
- [x] Implementada confirmação específica de cancelamento, sem hard delete, com mensagem de preservação do histórico e efeito compensatório; eventos `CANCELLED` exibem o reversal e não oferecem segundo cancelamento nem edição.
- [x] Implementado [`transaction-maintenance-attempt.ts`](../../src/components/transactions/transaction-maintenance-attempt.ts) para manter `commandId` em retry idêntico e iniciar novo comando quando a metadata muda.
- [x] Separados formatadores client-safe em [`transaction-detail-utils.ts`](../../src/components/transactions/transaction-detail-utils.ts), evitando empacotar o cliente com o driver PostgreSQL usado pelas queries server-side.
- [x] Adicionada cobertura em [`transaction-detail-screen.test.tsx`](../../src/components/transactions/transaction-detail-screen.test.tsx), [`transaction-maintenance-attempt.test.ts`](../../src/components/transactions/transaction-maintenance-attempt.test.ts) e na suíte de adapter de manutenção, cobrindo detalhe, campos somente leitura, confirmação, histórico/reversal, ausência de hard delete, retry e erros esperados.

## Verificações

- [x] `npm test -- --run src/components/transactions/transaction-maintenance-attempt.test.ts src/components/transactions/transaction-detail-screen.test.tsx`: 5 testes passaram.
- [x] `npm test`: 206 testes passaram; 40 integrações opt-in permaneceram puladas sem PostgreSQL externo.
- [x] `npm run typecheck`: concluído sem erros.
- [x] ESLint focado nos arquivos da T12, adapter e actions: concluído sem warnings/erros.
- [x] `npm run build`: build Next.js concluiu compilando `/transactions/[id]`; permanece apenas o warning operacional preexistente sobre múltiplos lockfiles/workspace root.
