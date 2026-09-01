# T09 — Componentes e contrato do formulário

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — implementação e verificações concluídas em 2026-08-29.
- Onda: 1
- Dependências: T01 e T02; dados de S02 para opções
- Paralelização: Pode ser executada em paralelo com backend e T08

## Objetivo

Criar a ilha de UI reutilizável para cadastro e edição com baixa carga cognitiva e os mesmos contratos de validação do servidor.

## Escopo

- Usar React Hook Form + Zod no formulário.
- Implementar `MoneyInput` no formato local esperado, convertendo para string de centavos; não usar `input type="number"` como modelo monetário.
- Implementar `DateInput` com boundary `YYYY-MM-DD`.
- Criar seleção de tipo receita/despesa, conta ativa e categoria filtrada pelo tipo.
- Permitir categoria vazia quando a regra do domínio aceitar.
- Não oferecer contas/categorias arquivadas para novos lançamentos.
- Definir campos, labels, placeholders, limites de descrição e acessibilidade conforme T01.
- Prever estados de carregamento, submit duplicado, erro de campo, erro geral e formulário vazio por ausência de contas.
- Manter client island pequena; dados e opções podem vir de Server Components.

## Critérios de aceite

- [x] O usuário consegue alternar entre receita e despesa sem categoria incompatível disponível — os radios de tipo limpam a categoria selecionada quando ela deixa de ser compatível e `filterActiveCategories` aplica o tipo/status.
- [x] A visualização monetária brasileira não perde centavos ao submeter — `MoneyInput` usa texto + `inputMode="decimal"`, máscara sem `Number`/float e entrega `amountCents` decimal; coberto por `money-input.test.ts`.
- [x] Data inválida/futura recebe erro compreensível — `DateInput` mantém `YYYY-MM-DD`, usa limite superior do dia de negócio e o schema compartilhado reporta mensagens de data inválida/futura; coberto por `transaction-form-contract.test.ts`.
- [x] Categoria é opcional e a lista exclui categorias inativas — valor vazio vira `null`, categorias `ARCHIVED` não são oferecidas em novos lançamentos e o filtro por tipo é coberto por `transaction-form.test.ts`.
- [x] O mesmo payload serializável validado no browser pode ser revalidado no servidor — `toCreateManualTransactionCommand` remove apenas o seletor de tipo da UI, anexa o `commandId` na boundary e o resultado é aceito pelo `createExpenseCommandSchema` em teste.
- [x] O componente é utilizável em desktop e em viewport móvel sem exigir experiência mobile-first — layout responsivo (`grid sm:grid-cols-2`, ações empilhadas em telas estreitas), labels/descriptions/erro de campo e foco nativo acessível.

## Subtarefas

- [x] Definido o contrato serializável do formulário em [`form-contract.ts`](../../src/modules/transactions/form-contract.ts), compartilhando as primitivas de validação de T02 e mantendo o tipo da operação como decisão da action.
- [x] Implementado [`MoneyInput`](../../src/components/transactions/money-input.tsx) com formatação brasileira, conversão exata para centavos e sem `input type="number"`.
- [x] Implementado [`DateInput`](../../src/components/transactions/date-input.tsx) com boundary ISO, `maxDate` para futuro e `minDate` para a âncora opcional da conta.
- [x] Implementado [`TransactionForm`](../../src/components/transactions/transaction-form.tsx) para cadastro/edição, campos imutáveis somente leitura, seleção de tipo, opções tenant-scoped recebidas por props e categoria opcional filtrada.
- [x] Incluídos estados de carregamento, submit duplicado, erro de campo/geral, cancelamento e ausência de contas ativas.
- [x] Adicionadas exportações de conveniência em [`components/transactions/index.ts`](../../src/components/transactions/index.ts) para integração das telas T10–T12.

## Verificações

- [x] `npx vitest run src/components/transactions`: 9 testes passaram.
- [x] `npm test`: 166 testes passaram; 18 testes de integração opcionais foram ignorados por dependerem de PostgreSQL/ambiente externo.
- [x] `npm run lint`: concluído sem erros ou warnings.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run build`: build Next.js concluído; permanece apenas o warning operacional preexistente sobre múltiplos lockfiles e inferência de workspace root.
