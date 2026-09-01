# T01 — Contrato do slice e gate de dependências

- Slice: S05 — Revisão e organização das transações
- Status: Concluída
- Onda: 0
- Dependências: S03 e S04 concluídos; S01/S02 disponíveis
- Paralelização: Não; gate que desbloqueia T02–T10

## Objetivo

Eliminar ambiguidades entre PRD, TechSpec, S03, S04 e o documento S05 antes de
alterar o read model, o command de update ou a tela de transações.

## Subtasks

- [x] Ler integralmente S05, o plano de tasks, esta T01, ADR-004, ADR-005 e
  os contratos atuais de tenancy, ledger, importação e transações.
- [x] Confirmar que `financial_events` + `account_entries` continuam sendo a
  fonte de verdade e que S04 já preserva a linhagem em
  `transaction_import_items`.
- [x] Fechar a elegibilidade da fila, `NEEDS_REVIEW`, estados e razão de
  revisão para contagem, filtro, lista e detalhe.
- [x] Fechar origem, shape de `source`, imutabilidade da linhagem e a
  limitação real de não existir descrição bruta separada no S04.
- [x] Fechar campos editáveis/proibidos, command/operação, aliases de S03,
  transaction única e idempotência por `(household_id, commandId)`.
- [x] Fechar filtros, limites, busca, ordenação, cursor, `pageInfo`, summary,
  read models e códigos de erro sem autoridade de tenancy no client.
- [x] Registrar handoff explícito para T02–T13 na ADR-006.
- [x] Executar a verificação de whitespace solicitada nos dois documentos.

## Escopo

- Verificar o contrato entregue por S03: `financial_events` +
  `account_entries`, `requireFinancialContext`, categorias opcionais,
  `application_commands` e edição segura de metadata.
- Verificar o contrato entregue por S04: `origin=IMPORT`,
  `transaction_imports`, `transaction_import_items`, `rowNumber`,
  `externalId`, FKs compostas e ausência de CSV bruto/token no read model.
- Formalizar o conjunto da fila: somente `kind IN (EXPENSE, INCOME)` e
  `origin IN (MANUAL, IMPORT)`; `REVERSAL`/`SYSTEM` são relações/histórico.
- Fixar `NEEDS_REVIEW` como `status=POSTED AND category_id IS NULL` para os
  eventos revisáveis. `CANCELLED` não conta como pendência; categoria
  arquivada preserva a classificação histórica.
- Fixar campos permitidos (`description`, `categoryId`) e proibições (valor,
  data, conta, tipo, status, entry, origem, importação e linhagem). Decidir e
  registrar que a descrição atual é editável, enquanto a linhagem do lote e
  da linha é imutável; S04 não reteve a descrição bruta separadamente.
- Definir os filtros públicos: período, conta, categoria/sem categoria, tipo,
  status, origem, `review` e `search`; definir limites de texto e paginação.
- Definir ordenação estável (`occurredOn DESC, id DESC`), cursor opaco ligado ao
  filtro canônico e resposta com `pageInfo`, `needsReview` e origem.
- Escolher o nome do novo command/operação para eventos `MANUAL` e `IMPORT`,
  preservando aliases públicos de S03 quando isso evitar quebra. O command não
  recebe `householdId`, origem, conta nem dados de importação como autoridade.
- Definir códigos de erro estáveis para cursor, query, evento não revisável,
  categoria incompatível/arquivada, command reutilizado e tenant não
  encontrado.
- Registrar as decisões em `docs/adr/006-s05-revisao-transacoes-contract.md`,
  com handoff explícito para T02–T13.

## Critérios de aceite

- [x] A ADR fecha origem, pendência, campos editáveis, cursor, busca e shape do
  read model sem deixar decisão estrutural para T03–T06.
- [x] O contrato não cria tabela `transactions`, `accounts.balance` ou uma
  segunda linhagem de importação.
- [x] Está explícito que origem/linhagem não são alteradas por revisão e que o
  dado de origem de S04 continua separado dos campos correntes editáveis.
- [x] A definição de pendência é implementável em SQL e consistente entre
  contagem, filtro, item da lista e detalhe.
- [x] O command é serializável, tenant é derivado da sessão e retry por
  `commandId` é idempotente dentro do household.
- [x] T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12 e T13 têm handoff
  definido na ADR ou neste documento.

## Verificações

- [x] Revisar [S05](../../docs/S05-revisao-transacoes.md),
  [ADR-004 de S03](../../docs/adr/004-s03-transacao-manual-contract.md) e
  [ADR-005 de S04](../../docs/adr/005-s04-importacao-csv-contract.md).
- [x] Conferir que o contrato respeita imutabilidade financeira
  ([TechSpec, seção 29](../../docs/techspec.md:1003)) e tenancy
  ([TechSpec, seção 5](../../docs/techspec.md:181)).
- [x] Executar `rtk git diff --check` nos documentos alterados.

## Evidências e limitações

- [x] A ADR-006 documenta a composição canônica do ledger, a origem
  `MANUAL|IMPORT`, a linhagem `transaction_import_items`, os estados de
  revisão, o contrato serializável, os filtros/limites, o cursor, o update e
  os erros/handoffs.
- [x] A implementação atual foi conferida em
  `src/db/financial-events-schema.ts`,
  `src/db/transaction-imports-schema.ts`,
  `src/modules/transaction-imports/confirmation-use-cases.ts`,
  `src/modules/transactions/{contracts,reads,use-cases}.ts` e
  `src/modules/households/{context,tenant-scoped}.ts`.
- [x] A inspeção de `src/db/schema.ts` e das migrations não encontrou tabela
  física `transactions` nem coluna `accounts.balance` nova.
- [x] O comando `rtk git diff --check --
  docs/adr/006-s05-revisao-transacoes-contract.md
  tasks/S05-revisao-transacoes/001-contrato-e-gate-revisao_task.md` terminou
  sem diagnóstico de whitespace. Como os documentos estão não rastreados no
  worktree atual, a checagem adicional `rtk git diff --no-index --check` teve
  código 1 apenas pela diferença em relação a `/dev/null`, também sem
  diagnóstico de whitespace.

Limitações concretas para o handoff: os reads atuais ainda filtram
`origin=MANUAL`, não implementam cursor/review/source e o update atual ainda
é manual-only. Além disso, `transaction_import_items` já possui unicidade por
`(import_id, row_number)`, mas a inspeção não encontrou a unicidade por
`(household_id, financial_event_id)` exigida para garantir uma linhagem por
evento; T03 deve materializá-la e testá-la. Portanto, a conclusão desta T01
é contratual/gate: T02–T13 ainda precisam implementar e verificar o
comportamento descrito na ADR-006.

## Fora de escopo

Não implementar motor de regras, IA, reconciliação, cancelamento de evento
importado, auditoria granular ou restauração da descrição bruta do CSV.
