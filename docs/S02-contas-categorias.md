# S02 — Contas e categorias

## Contrato de implementação

O contrato fechado de campos, commands, read models, erros e fronteira do
slice está em [`ADR-003 — Contrato de contas e categorias do S02`](adr/003-s02-contas-categorias-contract.md).
As tasks do S02 devem tratar esse ADR como fonte local de decisões; mudanças
estruturais precisam atualizá-lo antes de alterar schema ou payloads.

## Objetivo

Permitir que o usuário represente a estrutura mínima necessária para organizar seu dinheiro antes de registrar movimentações reais.

## Valor entregue

O usuário consegue cadastrar e manter suas contas financeiras e categorias, que serão reutilizadas nos fluxos de transação manual e importação.

## Fluxo principal

1. Usuário acessa configurações financeiras.
2. Cadastra uma conta.
3. Cadastra ou utiliza categorias disponíveis.
4. Edita informações quando necessário.
5. As entidades passam a estar disponíveis nos demais fluxos do produto.

## Escopo

- CRUD mínimo de contas.
- CRUD mínimo de categorias definido para a V1.
- Associação obrigatória ao espaço financeiro.
- Estados ativo/inativo quando remoção física puder quebrar histórico.
- Validações de nome e campos obrigatórios.
- Listagens simples.

## Fora de escopo

- Sincronização automática com bancos.
- Open Finance.
- Hierarquias complexas de categorias, salvo se já exigidas pelo PRD.
- Permissões por usuário.

## Dependências

- S01 concluído.

## Dados / domínio

Entidades mínimas:

- `accounts`
- `categories`

A modelagem deve preservar histórico: entidades já referenciadas por transações não devem ser apagadas de forma a invalidar dados existentes.

## Backend

- Criar/listar/editar/desativar contas.
- Criar/listar/editar/desativar categorias.
- Queries sempre limitadas ao espaço financeiro atual.
- Validação server-side.

## Frontend

- Tela/lista de contas.
- Formulário de conta.
- Tela/lista de categorias.
- Formulário de categoria.
- Empty states e erros básicos.

## Critérios de aceite

- [ ] Usuário cria pelo menos uma conta.
- [ ] Usuário cria e edita uma categoria.
- [ ] Usuário não enxerga contas/categorias de outro espaço financeiro.
- [ ] Não é possível salvar entidade sem campos obrigatórios.
- [ ] Desativar uma entidade não quebra registros históricos.
- [ ] Entidades inativas deixam de ser oferecidas para novos lançamentos, quando aplicável.

## Testes

- Unitários de validação.
- Integração de CRUD e isolamento.
- E2E básico de criação de conta e categoria.

## Observabilidade

- Erros inesperados de CRUD no Sentry.
- Log/contexto suficiente para identificar entidade e operação sem expor dados sensíveis desnecessários.

## Tarefas internas sugeridas

1. Criar migrations de contas e categorias.
2. Criar regras de validação.
3. Implementar operações backend.
4. Implementar telas e formulários.
5. Tratar desativação versus deleção.
6. Cobrir isolamento por espaço financeiro.
7. Criar testes.

## Definition of Done

O usuário consegue preparar no sistema as contas e categorias necessárias para lançar uma transação real, com dados isolados pelo espaço financeiro.
