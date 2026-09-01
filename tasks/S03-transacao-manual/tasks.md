# Tasks — S03: Transação manual end-to-end

## Objetivo

Entregar o fluxo completo para registrar, consultar, editar com segurança e cancelar uma receita ou despesa manual, sempre dentro do espaço financeiro atual e com o saldo derivado do ledger.

O índice detalha o [S03](../../docs/S03-transacao-manual.md), usando `FinancialEvent` e `AccountEntry` conforme a [TechSpec — FinancialEvent](../../docs/techspec.md:338), o [ledger](../../docs/techspec.md:386), os [Application Commands](../../docs/techspec.md:1930) e as regras de [imutabilidade](../../docs/techspec.md:1003). A intenção de produto vem da [PRD — Receitas](../../docs/prd.md:230), [Despesas](../../docs/prd.md:303), [edição e exclusão](../../docs/prd.md:712) e [experiência](../../docs/prd.md:726).

## Premissas e decisões

- S01 e S02 precisam estar concluídos: contexto autenticado, isolamento, contas e categorias ativas, migrations e geração de UUIDv7.
- `transactions` é o nome do módulo e da interface. A fonte de verdade persistida será `financial_events` + `account_entries`; não será criada uma tabela paralela de transações com saldo próprio.
- `FinancialEvent.amount` será positivo e absoluto. O sinal ficará no `AccountEntry`: despesa negativa e receita positiva.
- Conforme a ADR-001 e o plano de S02, `Household/households/household_id` é o nome canônico de domínio e persistência. “Espaço financeiro” é apenas o texto da UI; `financial_space_id` em S03 é um termo conceitual que não deve criar alias nem uma terceira nomenclatura.
- Lançamentos manuais deste slice representam fatos realizados: `POSTED`, com data financeira não futura. Planejado, esperado, recorrência, cartão, parcela, importação e forecast ficam fora do slice.
- Conta é obrigatória. Categoria pode ser nula, mas, quando informada, deve estar ativa, pertencer ao mesmo tenant e ter o mesmo tipo (`EXPENSE` ou `INCOME`) do evento.
- A recomendação para preservar histórico é editar diretamente apenas descrição/categoria. Alteração de valor, conta, data ou tipo não sobrescreve um evento `POSTED`; deve ser tratada como correção futura ou como cancelar e lançar novamente.
- “Remover” significa cancelamento explícito, sem hard delete. Para um evento já `POSTED`, a T07 deve registrar efeito compensatório compatível com `REVERSAL` e manter o histórico visível. A forma exata de status/relação será fechada na T01.
- Distribuição automática em Caixinhas, tags, cartões, transferências, parcelas, recorrências e importação não serão implementadas aqui. A transação apenas preserva a categoria e o evento para os slices consumidores.
- Writes usam commands serializáveis, `Result<T, E>`, contexto derivado da sessão, uma única transaction PostgreSQL e idempotência por `commandId`.

## Ordem de execução

### Onda 0 — Contrato e gates

1. [T01 — Contrato do slice e gate de dependências](001-contrato-e-gate-dependencias_task.md)

T01 é obrigatória. Nenhuma migration deve começar enquanto não forem resolvidas a nomenclatura do tenant, o mapeamento `transactions`/`FinancialEvent` e a política de edição/cancelamento.

### Onda 1 — Fundamentos em paralelo

2. [T02 — Primitivas de domínio e contratos de validação](002-primitivas-dominio-validacao_task.md)
3. [T08 — Erros e observabilidade segura](008-erros-observabilidade_task.md)
4. [T09 — Componentes e contrato do formulário](009-componentes-formulario_task.md)

T02, T08 e T09 podem avançar em paralelo após T01. A integração de T08 com os use cases e de T09 com as rotas depende das ondas seguintes.

### Onda 2 — Persistência e isolamento

5. [T03 — Schema de FinancialEvent, AccountEntry e idempotência](003-schema-financial-event-ledger_task.md)
6. [T04 — Integridade de tenant e referências](004-integridade-tenant-referencias_task.md)

T03 depende de T01/T02. T04 começa após o schema estar definido; a aplicação de migrations deve ser serializada mesmo que o desenvolvimento dos arquivos ocorra em paralelo.

### Onda 3 — Backend vertical

7. [T05 — CreateExpense e CreateIncome](005-use-cases-escrita-manual_task.md)
8. [T06 — Reads, listagem, detalhe e saldo derivado](006-reads-listagem-saldo_task.md)

T05 e T06 podem ser desenvolvidas em paralelo após T04: T05 depende da escrita transacional; T06 depende do modelo de leitura e dos índices. T08 continua em paralelo.

### Onda 4 — Histórico e interface de manutenção

9. [T07 — Edição segura e cancelamento](007-edicao-cancelamento-seguro_task.md)

T07 depende de T03, T04 e T05. Ela é o gate para o fluxo completo de editar/cancelar.

### Onda 5 — UI de uso

10. [T10 — Fluxo de criação de receita/despesa](010-fluxo-criacao-ui_task.md)
11. [T11 — Listagem, filtros e empty state](011-listagem-filtros-ui_task.md)
12. [T12 — Detalhe, edição e cancelamento na UI](012-detalhe-edicao-cancelamento-ui_task.md)

T10 e T11 podem ser executadas em paralelo depois de T05/T06 e T09. T12 depende de T06/T07/T09 e pode avançar em paralelo com T10/T11.

### Onda 6 — Verificação e entrega

13. [T13 — Testes unitários e de integração](013-testes-unitarios-integracao_task.md)
14. [T14 — E2E do fluxo crítico](014-testes-e2e_task.md)
15. [T15 — Validação de release e produção](015-validacao-release_task.md)

T13 pode ser escrita incrementalmente junto com o backend, mas sua execução final depende de T02–T07. T14 depende das telas e actions de T10–T12. T15 é serial e só fecha o slice após CI, migration controlada e smoke test publicado.

## Matriz de dependências

| ID | Task | Dependências | Paralelização principal |
|---|---|---|---|
| T01 | Contrato e gate | S01, S02 | — |
| T02 | Primitivas e validação | T01 | Com T08 e T09 |
| T03 | Schema e migrations | T01, T02 | Desenvolvimento pode separar; migration final serial |
| T04 | Tenant e referências | T03, S01, S02 | Com preparação de T05/T06 |
| T05 | Escrita manual | T02, T03, T04 | Com T06 |
| T06 | Reads/listagem/saldo | T03, T04 | Com T05 |
| T07 | Edição/cancelamento | T03, T04, T05 | Antes da UI de manutenção |
| T08 | Erros/observabilidade | T01 | Com T02–T07; integração após use cases |
| T09 | Form components | T01, T02 | Com backend |
| T10 | Criação UI | T05, T09 | Com T11 e T12 quando contratos existirem |
| T11 | Listagem UI | T06, T09 | Com T10 |
| T12 | Detalhe/manutenção UI | T06, T07, T09 | Com T10/T11 |
| T13 | Unitários/integração | T02–T07 | Pode ser escrita durante backend |
| T14 | E2E | T10–T12 | Depois das telas; antes de T15 |
| T15 | Release | T08, T13, T14 | Fechamento serial |

## Caminho crítico

`T01 → T02 → T03 → T04 → (T05 + T06) → T07 → (T10 + T11 + T12) → T14 → T15`

T08 e T13 são gates de qualidade que podem evoluir em paralelo, mas precisam estar concluídas antes do fechamento. A execução de migrations, deploy e smoke test permanece serializada.

## Definition of Done do slice

- [ ] Receita e despesa manual válidas são criadas como `FinancialEvent` + `AccountEntry`.
- [ ] Valores usam centavos/`Money` sem float e datas usam `PlainDate`/`DATE`.
- [ ] Conta/categoria são validadas contra o tenant e categoria incompatível/inativa é rejeitada.
- [ ] O saldo é derivado dos entries; não existe `accounts.balance` mantido pela aplicação.
- [ ] A criação é atômica, idempotente e não deixa registros parciais em falhas.
- [ ] A transação aparece imediatamente em `/transactions`, com filtros úteis e empty state.
- [ ] Edição de campos permitidos funciona sem sobrescrever efeitos financeiros `POSTED`.
- [ ] Cancelamento preserva histórico e neutraliza o efeito financeiro sem hard delete.
- [ ] O fluxo E2E cobre criar → listar → editar → cancelar e receita/despesa.
- [ ] Testes comprovam isolamento cross-tenant, constraints, precisão, rollback e idempotência.
- [ ] Logs/breadcrumbs/Sentry não contêm valor, descrição, nome de conta ou payload financeiro.
- [ ] O fluxo é validado na aplicação publicada sem depender de scripts ou acesso administrativo ao banco.
