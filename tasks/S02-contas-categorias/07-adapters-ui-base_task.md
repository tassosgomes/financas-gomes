# T07 — Criar Server Actions, adapters e base de UI

## Status

Concluída — adapters, rotas e UI compartilhada entregues em 2026-08-29;
contratos T03 disponíveis e portas reais de T05/T06 conectadas.

## Objetivo

Preparar a integração frontend–backend e os componentes compartilhados que serão usados pelas telas de contas e categorias.

## Dependências

- T01 concluída;
- T03 concluída;
- T04 concluída;
- layout autenticado do S01 disponível.

## Pode ser paralelizada?

Sim. Pode iniciar antes de T05 e T06 usando os contratos definidos em T01, mas a integração final depende dos use cases reais.

## Escopo

1. Criar Server Actions finas seguindo:

   `UI → Server Action → Zod → FinancialContext → Use Case → Drizzle`.

2. Garantir que actions:
   - não contenham regra financeira ou de tenancy;
   - não aceitem `householdId` como autoridade;
   - convertam erros esperados em mensagens/códigos de formulário;
   - preservem payloads serializáveis.
3. Preparar rotas e navegação:
   - `/accounts`;
   - área de categorias dentro de Configurações, conforme a navegação definida;
   - links a partir do shell autenticado.
4. Criar componentes comuns:
   - formulário com React Hook Form + Zod;
   - estados vazio, carregando e erro;
   - tabela/lista simples;
   - badge de status;
   - confirmação de arquivamento;
   - feedback de sucesso sem dados sensíveis.
5. Manter Server Components como padrão e Client Components somente nos formulários/interações necessárias.

## Critérios de conclusão

- [x] actions são adapters sem regra de negócio; elas validam o payload,
  resolvem o contexto server-side e delegam a portas de use case;
- [x] validação ocorre no client e no servidor, reutilizando os schemas Zod do
  contrato T03;
- [x] componentes podem ser usados pelas duas telas (formulário RHF, tabela ou
  lista, badge, confirmação de arquivamento e feedback);
- [x] estados vazio, erro e carregamento estão definidos e são acessíveis;
- [x] rotas canônicas `/accounts` e `/settings/categories` aparecem no shell
  autenticado, com aliases compatíveis sob `/app`;
- [x] integração pode ser trocada de mock para use case sem redesenhar os
  formulários, por meio de `S02UseCasePorts`;
- [x] conectar as portas aos use cases reais de T05/T06; a composição padrão
  usa `accountsUseCases` e `categoryUseCasePort` e continua substituível em
  testes.
- [x] boundary dos adapters foi comprovado com testes de validação, contexto,
  isolamento de autoridade e mapeamento de erros; a prova E2E com PostgreSQL
  permanece coberta pelas tasks de integração do slice.

## Subtarefas verificadas

- [x] Criadas portas explícitas de contas/categorias e factory de handlers; a
  action não aceita `householdId` como autoridade.
- [x] Schemas de command/query são aplicados antes de `requireFinancialContext`;
  erro esperado atravessa somente o envelope serializável `S02Result`.
- [x] Erros de contexto e de use case são convertidos para códigos/mensagens
  allow-listed, sem detalhes do banco ou payload financeiro.
- [x] Mock de metadata é substituível por `configureS02UseCasePorts`, sem
  implementar saldo, ledger ou regras financeiras na camada de UI.
- [x] Criados estados vazios, carregando, erro e sucesso; o sucesso recebe
  texto estável e não renderiza payload sensível.
- [x] Criados formulário React Hook Form + Zod, tabela/lista, badge de status e
  confirmação explícita de arquivamento.
- [x] Rotas autenticadas canônicas, estados de carregamento e links do shell
  foram preparados para contas e categorias em Configurações.
- [x] Integração com os use cases reais de T05/T06 foi conectada por portas
  compatíveis; o adapter não precisou conhecer Drizzle.
- [x] Gate de conclusão formal atendido após T03 ser marcado concluído; E2E e
  persistência completa seguem nos gates próprios de T11/T13.

## Referências

- [`Server Actions`](../../docs/techspec.md#70-server-actions);
- [`Frontend architecture`](../../docs/techspec.md#81-frontend-architecture);
- [`Forms`](../../docs/techspec.md#83-forms);
- [`Settings`](../../docs/techspec.md#95-settings).
