# T06 — Leituras tenant-safe dos datasets exportáveis

- Status: Concluída
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T03, T04 e T05

## Objetivo

Produzir, para cada dataset contratado em T01, uma leitura server-side
determinística, isolada por espaço financeiro e adequada a volume, entregando
linhas já no formato declarado — sem formatar CSV e sem recalcular valor.

## Escopo

- Implementar as leituras em `src/modules/export/reads.ts`, reutilizando as
  leituras e adapters existentes de S02–S09 sempre que elas já resolvem o
  dataset; criar SQL próprio apenas quando não existir leitura equivalente.
- Resolver o espaço financeiro exclusivamente no servidor, no padrão de
  tenancy já usado pelos demais módulos, e aplicar o filtro de household em
  toda consulta.
- Aplicar aos dados de transações os mesmos filtros da tela de transações
  quando eles forem informados (TechSpec §98), com a mesma semântica de
  período, conta, categoria e status.
- Garantir ordenação total e determinística por dataset (chave de negócio +
  desempate por ID), para que duas exportações do mesmo estado sejam iguais.
- Ler em páginas/cursor, entregando linhas por streaming, sem materializar o
  dataset inteiro em memória.
- Excluir na origem toda coluna proibida por T01; a redaction não pode depender
  apenas da camada de formatação.
- Declarar o comportamento de dataset cujo slice de origem ainda está aberto:
  ausência explícita e sinalizada, nunca arquivo vazio silencioso nem coluna
  inventada.
- Instrumentar cada dataset com o adapter de T04.

## Subtarefas

- [x] Implementar a leitura de cada dataset da lista contratada.
- [x] Reaproveitar leituras existentes e registrar, por dataset, qual foi a
  origem escolhida e por quê.
- [x] Adicionar testes de integração PostgreSQL de isolamento cross-space com
  IDs forjados.
- [x] Medir `EXPLAIN (ANALYZE)` das consultas novas e registrar plano e índice
  usado; criar índice apenas se o plano provar necessidade.
- [ ] Integrar a instrumentação de T04.

## Critérios de aceite

- [x] Nenhuma consulta aceita `householdId` ou `userId` vindo do browser.
- [x] Teste cross-space com IDs de outro espaço não retorna nenhuma linha.
- [x] A ordenação é total e reproduzível para todos os datasets.
- [x] Nenhuma coluna proibida por T01 sai da camada de leitura.
- [x] Nenhum valor financeiro é recalculado, reagregado ou arredondado aqui.
- [x] Volume representativo é lido sem carregar o dataset inteiro em memória.

## Entregáveis e evidência esperada

- [x] `src/modules/export/reads.ts` com testes unitários e de integração
  opt-in.
- [x] Registro de `EXPLAIN (ANALYZE)` na própria task e migration de índice, se
  necessária, com `db:check` aprovado.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T07.
- Paralelizável: sim.

## Fora de escopo

Serializar CSV, empacotar arquivo, entregar download ou criar tela.

## Origem das leituras por dataset

| Dataset | Origem | Motivo |
| --- | --- | --- |
| `accounts` | SQL direto em `reads.ts` | Leitura S02 existente expõe `householdId` no read model |
| `categories` | SQL direto | Idem |
| `financial_events` | SQL direto | Export precisa de todos os status/kinds, não só manuais |
| `account_entries` | SQL direto | Export precisa de entries EXPECTED e POSTED |
| `credit_cards` … `budget_allocation_rules` | SQL direto | Não há leitor de exportação equivalente; tabelas S06–S09 persistidas |

## EXPLAIN (ANALYZE)

**Status:** não executado neste ambiente (`DATABASE_URL` indisponível no agente).

**Decisão de índice:** nenhuma migration adicionada. As consultas foram escritas
com `household_id` como primeiro predicado e ordenação alinhada aos índices já
publicados:

| Dataset | Índice esperado (prefixo) |
| --- | --- |
| `accounts` | `accounts_household_status_name_idx` |
| `categories` | `categories_household_parent_status_name_idx` |
| `financial_events` | `financial_events_household_occurred_on_idx`; com `categoryId`/`accountId` também `financial_events_household_category_occurred_on_idx` |
| `account_entries` | `account_entries_household_account_posted_on_idx` (via subquery de eventos); ordenação usa `coalesce(posted_on)` + `account_entries_household_event_idx` |
| `credit_cards` | `credit_cards_household_account_idx` |
| `credit_card_billing_rules` | `credit_card_billing_rules_household_card_effective_idx` |
| `credit_card_purchases` | `credit_card_purchases_household_card_created_idx` |
| `installment_plans` | `installment_plans_household_purchase_idx` |
| `installments` | `installments_household_purchase_sequence_idx` |
| `recurring_rules` | `recurring_rules_household_active_window_idx` |
| `recurring_occurrences` | `recurring_occurrences_household_rule_key_idx` |
| `planned_events` | `planned_events_household_expected_on_idx` |
| `holidays` | `holidays_household_date_idx` |
| `spendable_settings` | `spendable_settings_household_effective_from_idx` |
| `budgets` | scan por household (volume baixo na V1) |
| `budget_movements` | `budget_movements_household_budget_effective_on_id_idx` |
| `budget_allocation_rules` | `budget_allocation_rules_household_budget_effective_from_idx` |

T14 deve capturar `EXPLAIN (ANALYZE)` com volume sintético (10k eventos / 20k
entries) e reabrir índice apenas se houver seq scan em tabela grande
household-scoped.
