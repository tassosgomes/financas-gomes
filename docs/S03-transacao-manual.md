# S03 — Transação manual end-to-end

## Objetivo

Entregar o primeiro fluxo financeiro real de ponta a ponta: registrar uma movimentação manual e vê-la refletida no sistema.

## Valor entregue

O usuário consegue registrar, consultar, editar e remover/cancelar uma receita ou despesa manual, vinculada à estrutura financeira existente.

## Fluxo principal

1. Usuário escolhe criar uma transação.
2. Informa os campos necessários da movimentação.
3. Seleciona conta e categoria quando aplicável.
4. Salva.
5. A transação aparece na listagem.
6. Usuário consegue abrir e editar o lançamento.

## Escopo

- Receita e despesa manual.
- Data da transação.
- Valor monetário preciso.
- Descrição.
- Conta.
- Categoria conforme regras do PRD.
- Edição.
- Remoção segura conforme regra definida para histórico.
- Listagem ordenada e utilizável.
- Filtros mínimos úteis, sem virar uma busca avançada.

## Fora de escopo

- Importação em lote.
- Cartão/fatura/parcelamento.
- Regras automáticas de categorização.
- Recorrência automática, se houver, fica para slice posterior.

## Dependências

- S01.
- S02.

## Dados / domínio

Entidade central:

- `transactions`

Requisitos estruturais:

- UUIDv7.
- `financial_space_id`.
- referência à conta.
- referência à categoria quando aplicável.
- tipo da transação.
- valor em representação monetária segura, sem float binário.
- data efetiva.
- origem = manual.

## Backend

- Criar transação com validação.
- Listar transações do espaço atual.
- Atualizar transação.
- Remover/cancelar de acordo com estratégia de histórico.
- Garantir que conta/categoria usadas pertencem ao mesmo espaço financeiro.

## Frontend

- Formulário de lançamento.
- Listagem de transações.
- Edição.
- Feedback de sucesso/erro.
- Empty state.

## Critérios de aceite

- [ ] Usuário registra uma despesa manual válida.
- [ ] Usuário registra uma receita manual válida.
- [ ] Valor é persistido sem perda de precisão.
- [ ] A transação aparece na listagem imediatamente após criação.
- [ ] Usuário consegue editar uma transação.
- [ ] Não é possível referenciar conta/categoria de outro espaço.
- [ ] Operação inválida retorna erro compreensível e não deixa registro parcial.
- [ ] Remoção/cancelamento segue a regra de preservação de histórico definida.

## Testes

- Unitários de valor/data/validação.
- Integração CRUD.
- Integração cross-space negativa.
- E2E: criar → listar → editar → remover/cancelar.

## Observabilidade

- Capturar falhas de persistência.
- Adicionar breadcrumbs/contexto para fluxo de criação/edição sem registrar informações financeiras sensíveis em excesso.

## Tarefas internas sugeridas

1. Criar model/migration de transação.
2. Implementar tipo monetário e validações.
3. Implementar create/list/update/delete-or-cancel.
4. Criar formulário.
5. Criar listagem.
6. Criar edição.
7. Cobrir integridade de referências.
8. Criar testes E2E.

## Definition of Done

É possível usar a aplicação publicada para registrar e manter uma movimentação financeira real sem acessar banco, scripts ou ferramentas administrativas.
