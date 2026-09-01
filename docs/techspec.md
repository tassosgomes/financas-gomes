# Gerenciador Financeiro — TechSpec V1

**Status:** Aprovado para implementação
**Versão:** 1.0
**Data:** 29/08/2026

---

## 1. Visão geral

O Gerenciador Financeiro será uma aplicação web pessoal/familiar cujo objetivo principal é responder, de forma confiável:

> **Quanto posso gastar com segurança sem comprometer minhas obrigações atuais e meu futuro financeiro?**

O produto não será apenas um registrador de receitas e despesas. O núcleo técnico deve permitir distinguir:

* patrimônio;
* liquidez;
* dinheiro efetivamente disponível;
* compromissos futuros;
* gastos econômicos;
* fluxo de caixa;
* orçamento por Caixinhas;
* recursos restritos;
* objetivos financeiros;
* projeções conservadoras e esperadas.

A V1 será uma aplicação web desktop-first, com responsividade suficiente para consultas e cadastros simples pelo navegador do celular.

Aplicativo nativo ficará para uma versão posterior.

---

# 2. Princípios arquiteturais

## 2.1 Modular Monolith

A aplicação será um **monólito modular**.

Não haverá microsserviços na V1.

```text
Browser
   ↓
Next.js
   ↓
Application / Domain
   ↓
Drizzle
   ↓
PostgreSQL
```

Separações futuras só acontecerão quando houver necessidade operacional concreta.

---

## 2.2 TypeScript end-to-end

Frontend, backend e domínio utilizarão TypeScript.

Objetivos:

* reduzir troca de contexto;
* compartilhar tipos quando apropriado;
* manter stack pequena;
* facilitar manutenção do projeto.

---

## 2.3 Domínio pragmático

A arquitetura será organizada principalmente por domínio, não por camada técnica global.

Exemplo:

```text
src/
  modules/
    accounts/
    transactions/
    categories/
    budgeting/
    credit-cards/
    recurring/
    forecasting/
    goals/
    households/
```

Módulos complexos podem ter:

```text
domain/
application/
infrastructure/
ui/
```

Módulos simples não precisam seguir essa estrutura artificialmente.

Não adotaremos Clean Architecture, Hexagonal Architecture ou DDD cerimonial.

Entidades ricas serão utilizadas somente onde existirem invariantes relevantes.

---

# 3. Stack

## Runtime e aplicação

* Next.js com App Router
* React
* TypeScript
* Node.js
* `@js-temporal/polyfill` para API Temporal

## Banco

* PostgreSQL
* Neon inicialmente
* Drizzle ORM

## Autenticação

* Better Auth
* Google OAuth na V1

Não haverá autenticação por senha local inicialmente.

## Frontend

* Tailwind CSS
* shadcn/ui
* Base UI
* Lucide
* React Hook Form
* Zod
* Recharts

## Qualidade

* Vitest
* PostgreSQL real para testes de integração
* Testcontainers quando apropriado
* Playwright para fluxos E2E críticos

## Operação

* Vercel
* Neon
* GitHub Actions
* Sentry

---

# 4. Portabilidade

Vercel e Neon são a infraestrutura inicial, não dependências do domínio.

A aplicação deve poder ser executada através de:

```text
docker build
docker compose up
```

permitindo migração futura para:

* Coolify;
* Portainer;
* VPS;
* Railway;
* Fly.io;
* outro PostgreSQL gerenciado.

Nenhuma regra de domínio pode depender da Vercel ou Neon.

---

# 5. Tenancy

## 5.1 Household

A raiz de isolamento de dados será `Household`.

Na UI o termo poderá ser apresentado como:

> **Espaço financeiro**

Estrutura:

```text
User N:N Household
```

através de:

```text
household_members
```

Mesmo que na V1 cada usuário pertença normalmente a apenas um household, o schema suporta múltiplos.

---

## 5.2 Autorização

Todos os membros de um household possuem os mesmos poderes.

Não teremos:

* OWNER;
* ADMIN;
* EDITOR;
* VIEWER;
* permissões por recurso.

Existe confiança mútua entre os membros.

---

## 5.3 Tenant nunca confiado ao client

Nunca:

```ts
createExpense({
  householdId: form.householdId
})
```

O contexto será derivado da sessão:

```ts
const context = await requireFinancialContext();
```

contendo:

```ts
{
  userId,
  householdId
}
```

Toda query deve ser tenant-scoped.

---

## 5.4 Integridade cross-tenant

Além da validação na aplicação, PostgreSQL utilizará FKs compostas quando apropriado.

Exemplo:

```text
(account_id, household_id)
→ accounts(id, household_id)
```

O banco deve impedir que um evento de um household seja associado acidentalmente à conta de outro.

---

## 5.5 RLS

PostgreSQL Row Level Security não será usado na V1.

Proteção será baseada em:

* tenant scope na aplicação;
* composite FKs;
* integration tests;
* browser sem acesso direto ao Postgres.

---

# 6. Autenticação

Fluxo V1:

```text
Google OAuth
    ↓
Better Auth
    ↓
household_members
```

Primeiro acesso:

```text
Login
 ↓
Criar Espaço Financeiro
 ↓
Criar membership
```

Novos membros serão convidados inicialmente através de link copiável.

```text
household_invites
- household_id
- token_hash
- expires_at
- used_at
- created_by
```

Não será necessário serviço de email para convites.

Sessões devem ser persistentes, aproximadamente 30 dias.

MFA será responsabilidade do Google.

---

# 7. Conceitos financeiros fundamentais

O sistema deve separar claramente:

```text
FinancialEvent
AccountEntry
Installment
RecurringOccurrence
Budget/Caixinha
ForecastItem
```

Esses conceitos não são equivalentes.

---

# 8. FinancialEvent

`FinancialEvent` representa **o fato econômico**.

Exemplo:

```text
Notebook
R$ 6.000
10x
29/08/2026
```

O fato econômico é uma compra de R$ 6.000 em agosto, independentemente da forma de pagamento.

Tipos iniciais:

```ts
FinancialEventKind =
  | "OPENING_BALANCE"
  | "INCOME"
  | "EXPENSE"
  | "PURCHASE"
  | "TRANSFER"
  | "REFUND"
  | "ADJUSTMENT"
  | "REVERSAL";
```

Status:

```ts
FinancialEventStatus =
  | "PLANNED"
  | "EXPECTED"
  | "PENDING"
  | "POSTED"
  | "CANCELLED";
```

`FinancialEvent.amount` é sempre absoluto e positivo.

O sinal financeiro pertence aos entries.

Zero não é permitido.

---

# 9. Ledger — AccountEntry

`AccountEntry` representa o efeito de um evento sobre uma conta.

Exemplo:

```text
Pagamento de cartão:

Bradesco        -4.500
Cartão Bradesco +4.500
```

Campos principais:

```text
financial_event_id
account_id
household_id
amount_cents
status
expected_on
posted_on
created_at
```

`amount_cents` possui sinal.

```text
positivo → aumenta posição da conta
negativo → reduz posição da conta
```

Nenhum `AccountEntry` pode existir sem `FinancialEvent`.

Não existe operação:

> ajustar saldo diretamente.

Até um ajuste é representado por:

```text
FinancialEvent(ADJUSTMENT)
+
AccountEntry
```

---

# 10. Saldo

Saldo não será armazenado em `accounts`.

Não haverá:

```text
accounts.balance
```

Saldo é derivado.

```text
balance(account, date) =
Σ POSTED account_entries até date
```

O saldo é uma **posição em determinada data**.

Movimentação de período é outro conceito.

---

# 11. Saldo inicial

Ao cadastrar uma conta com saldo:

```text
Bradesco
Saldo em 29/08: R$ 5.000
```

será criado:

```text
FinancialEvent(OPENING_BALANCE)
AccountEntry(+5000)
```

Saldo inicial negativo também é permitido.

A conta terá:

```text
tracking_started_on
```

Nenhum entry real poderá existir antes dessa data sem fluxo explícito de rebase.

Isso impede que lançamentos retroativos invalidem a âncora inicial informada.

---

# 12. Money

Dinheiro será representado no domínio por:

```ts
Money {
  cents: bigint
}
```

BRL é a única moeda na V1.

A moeda pertence ao household:

```text
base_currency = BRL
```

Na boundary HTTP/UI:

```text
"600000"
```

representa R$ 6.000 em centavos.

Fluxo:

```text
UI string
→ cents string
→ BigInt
→ Money
```

Nunca utilizar `float` para valores monetários.

---

## 12.1 Parcelamento e arredondamento

```text
R$ 100 / 3
```

produz:

```text
33,34
33,33
33,33
```

O remainder é distribuído deterministicamente a partir das primeiras parcelas.

Invariante:

```text
SUM(parcelas) = valor total
```

---

# 13. Datas

Datas financeiras utilizarão semanticamente:

```ts
Temporal.PlainDate
Temporal.PlainYearMonth
```

Persistência:

```text
PostgreSQL DATE
```

Boundary:

```text
YYYY-MM-DD
```

Não utilizaremos JavaScript `Date` diretamente para datas financeiras.

Timestamps técnicos:

```text
created_at
updated_at
```

continuam `timestamptz`.

---

# 14. Accounts

Tipos iniciais:

```ts
AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CASH"
  | "CREDIT_CARD"
  | "BENEFIT"
  | "INVESTMENT"
  | "OTHER";
```

Status:

```text
ACTIVE
ARCHIVED
```

Contas com movimentação nunca sofrem hard delete.

---

# 15. Spendability

Um booleano `includeInSpendable` é insuficiente.

Será utilizado:

```ts
Spendability =
  | "GENERAL"
  | "RESTRICTED"
  | "EXCLUDED";
```

### GENERAL

Recursos normalmente utilizáveis.

Ex.:

* conta corrente;
* dinheiro;
* bônus de uso irrestrito.

### RESTRICTED

Recursos utilizáveis somente em determinados contextos.

Ex.:

* vale-alimentação;
* vale-refeição.

### EXCLUDED

Recursos que não fazem parte do dinheiro disponível.

Ex.:

* FGTS;
* investimentos preservados.

---

# 16. Patrimônio e liquidez

Conta também terá:

```ts
Liquidity =
  | "IMMEDIATE"
  | "LIQUID"
  | "RESTRICTED";
```

E:

```text
include_in_net_worth
```

Os seguintes indicadores são explicitamente diferentes:

```text
NetWorth
LiquidBalance
Spendable
```

Nunca utilizar nomes genéricos como:

```text
availableMoney
```

---

# 17. Benefícios

Uma conta `BENEFIT` pode ter:

```text
FOOD
MEAL
FLEX
OTHER
```

e regras opcionais:

```text
account_spending_rules
(account_id, category_id)
```

Ausência de regra:

> uso irrestrito.

Recursos `RESTRICTED` funcionam como envelopes próprios.

Uma compra paga com recurso restrito **não consome também a Caixinha geral**, evitando double-count.

Exemplo:

```text
Caixinha Restaurante     800
Vale Refeição            500
Total contextual        1300
```

Compra R$ 100 no vale:

```text
Caixinha                  800
Vale                      400
Total                    1200
```

---

# 18. Cartão de crédito

Cartão é uma especialização de `Account`.

```text
accounts.type = CREDIT_CARD
```

Configuração específica:

```text
credit_cards
- account_id
- credit_limit_cents
- default_payment_account_id
```

As regras de fechamento/vencimento são versionadas:

```text
credit_card_billing_rules
- card_id
- closing_day
- due_day
- effective_from
- effective_until
```

Mudanças futuras nunca reinterpretam compras antigas.

---

# 19. Cartão — conceitos distintos

Não haverá função genérica:

```text
getCreditCardBalance()
```

Serão usados conceitos explícitos:

```text
getCurrentStatementAmount()
getProjectedStatementAmount()
getOutstandingCardObligation()
getAvailableCreditLimit()
getCardCreditBalance()
```

---

# 20. Compra à vista no cartão

Compra:

```text
29/08
R$ 100
```

gera:

```text
FinancialEvent(PURCHASE)
AccountEntry(card, -100)
```

O gasto econômico acontece no momento da compra.

O pagamento posterior da fatura não cria nova despesa.

---

# 21. Fatura

`CreditCardStatement` não será persistido na V1.

Fatura será uma projection/read model.

```text
Fatura Outubro
→ entries e installments cujo ciclo vence em outubro
```

Pode existir:

```text
Projetado
Confirmado
```

sem uma entidade contábil própria de fatura.

---

# 22. Pagamento de cartão

Pagamento é uma transferência:

```text
Conta corrente -4500
Cartão         +4500
```

Não:

* cria despesa;
* altera Caixinha;
* precisa apontar para uma parcela específica.

Pagamento maior que a dívida é permitido e pode gerar saldo credor.

---

# 23. Compra parcelada

Uma compra parcelada é:

```text
1 FinancialEvent econômico
+
1 InstallmentPlan
+
N Installments
```

Exemplo:

```text
Notebook
R$ 6.000
10x R$ 600
```

Economicamente:

```text
Gasto em agosto = R$ 6.000
```

Caixinha:

```text
Eletrônicos -= R$ 6.000
```

Fluxo futuro:

```text
10 cobranças de R$ 600
```

---

# 24. Installments

```text
installment_plans
installments
```

Status:

```ts
InstallmentStatus =
  | "PLANNED"
  | "POSTED"
  | "CANCELLED";
```

Não existe `PAID`.

O pagamento ocorre no nível global do cartão, não da parcela individual.

---

# 25. Dívida atual vs comprometimento futuro

Compra parcelada:

```text
Parcela atual             600
Parcelas futuras         5400
```

Não significa que o saldo corrente/fatura atual seja -6000.

As projections devem distinguir:

```text
fatura atual
parcelas futuras
obrigação contratual total
limite comprometido
```

Para patrimônio:

```text
cardNetPosition =
currentPostedCardPosition
- remainingFutureInstallments
```

evitando contar parcelas já postadas duas vezes.

---

# 26. Limite

Limite não possui ledger próprio.

É projection.

Parcelas futuras comprometem limite.

Saldo credor é exibido separadamente e não aumenta automaticamente o limite contratual apresentado.

---

# 27. Override de ciclo

Se o sistema calcular:

```text
vencimento 05/10
```

mas o emissor colocar em:

```text
05/11
```

a compra/parcela pode possuir:

```text
billing_due_on_override
```

Não alteramos a regra global do cartão.

---

# 28. Refund, Reversal e Correction

São conceitos distintos.

## REFUND

Fato econômico posterior legítimo.

```text
compra
→ dinheiro devolvido
```

## REVERSAL

Desfaz efeito de lançamento incorreto.

```text
lançamento não deveria existir daquela forma
```

## CORRECTION

Representa o novo evento correto após reversão.

---

# 29. Imutabilidade financeira

Eventos `POSTED` não terão efeitos financeiros sobrescritos silenciosamente.

Mudança de:

* valor;
* conta;
* data econômica;

utiliza correction/reversal.

Pode ser editado diretamente:

* descrição;
* categoria;
* tags;
* metadata não financeira.

Alterar categoria reclassifica relatórios e Caixinhas historicamente.

---

# 30. Estornos

Estorno pode ser:

* integral;
* parcial;
* EXPECTED;
* POSTED.

Múltiplos estornos são permitidos.

Invariante:

```text
SUM(refunds ativos)
<= valor econômico original
```

Estorno não pode exceder a compra.

---

# 31. Estorno de parcelamento

O sistema não presume comportamento do emissor.

Compra:

```text
R$ 6.000
5 parcelas já pagas
```

São válidos, por exemplo:

### Cenário A

```text
crédito +3000
parcelas futuras CANCELLED
```

### Cenário B

```text
crédito +6000
parcelas futuras continuam PLANNED
```

O sistema representa o que efetivamente ocorreu.

Não redistribui automaticamente estorno parcial entre parcelas.

---

# 32. Transfers

Na V1:

```text
TRANSFER
→ exatamente duas contas
→ contas diferentes
→ SUM(entries) = 0
```

Será utilizado deferred constraint trigger no PostgreSQL para validar soma zero no final da transaction.

O ledger poderá tecnicamente suportar mais entries no futuro, mas `CreateTransfer` V1 não.

---

# 33. Categories

```text
categories
- id
- household_id
- name
- parent_id
- kind
- status
```

```ts
CategoryKind =
  | "EXPENSE"
  | "INCOME";
```

Transferências não possuem categoria.

---

## 33.1 Hierarquia

UI suporta:

```text
Categoria
└── Subcategoria
```

máximo de dois níveis.

Categoria já utilizada não poderá sofrer reparenting.

Pode:

* mudar nome;
* ser arquivada.

---

## 33.2 Categoria opcional

`category_id` pode ser `NULL`.

Cadastro rápido não será bloqueado pela ausência de categoria.

A aplicação poderá indicar:

> lançamentos sem categoria.

---

# 34. Tags

Tags não possuem significado contábil.

```text
tags
financial_event_tags
```

Exemplos:

```text
PIX
Débito
Viagem
Reembolsável
Trabalho
```

Servem para:

* filtro;
* organização;
* classificação.

---

# 35. Caixinhas

Termo oficial da UI:

> **Caixinhas**

Internamente podem ser chamadas `Budget` ou `BudgetEnvelope`.

Uma Caixinha está ligada a uma categoria.

Uma categoria possui no máximo uma Caixinha ativa.

---

# 36. Rollover

Caixinhas acumulam saldo entre períodos.

Exemplo:

```text
Agosto:

aporte       +1000
gasto         -700
saldo          300

Setembro:

saldo anterior 300
aporte        1000
disponível    1300
```

Saldo negativo também é carregado.

---

# 37. Saldo da Caixinha

Não será persistido.

```text
budgetBalance =
Σ allocations
- Σ netExpenses
```

Não existe:

```text
budget.balance
```

---

# 38. Allocation rules

Aportes mensais precisam preservar histórico.

```text
budget_allocation_rules
- budget_id
- amount_cents
- effective_from
- effective_until
```

Exemplo:

```text
Jan-Jun 1000
Jul+    1500
```

---

# 39. Vigência da Caixinha

Caixinha possui:

```text
active_from
archived_on
```

Se uma Caixinha específica de Restaurante for criada em outubro, gastos anteriores continuam pertencendo à Caixinha pai que existia naquela época.

A regra:

> Caixinha mais específica vence

é avaliada conforme a configuração vigente na data econômica do gasto.

---

# 40. Compra parcelada e Caixinha

Compra de R$ 6.000 em agosto:

```text
Caixinha -= 6000 em agosto
```

não:

```text
600 por mês
```

Caixinha acompanha decisão de consumo.

Forecast acompanha fluxo futuro.

---

# 41. Estorno e Caixinha

Movimentação da Caixinha acompanha a data real do estorno.

Relatórios econômicos podem associar o estorno ao evento original para apresentar gasto líquido corrigido.

---

# 42. Recorrências

```text
RecurringRule
→ regra

RecurringOccurrence
→ ocorrência específica

FinancialEvent
→ realização
```

Frequências V1:

```text
MONTHLY
YEARLY
```

Regras de dia:

```text
FIXED_DAY
FIRST_BUSINESS_DAY
LAST_BUSINESS_DAY
```

Não utilizaremos cron ou RRULE genérica no domínio.

---

# 43. Business Calendar

```text
holidays
- household_id
- date
- name
```

Dia útil:

```text
segunda a sexta
e
não está em holidays
```

Calendário trabalha com `Temporal.PlainDate`.

Feriados serão cadastrados manualmente na V1.

Automação/API fica para depois.

---

# 44. Ocorrências recorrentes virtuais

Ocorrências normais não precisam ser persistidas.

Forecast gera virtualmente:

```text
Salário
01/09
01/10
03/11
...
```

Persistimos occurrence quando existe exceção:

* valor alterado;
* data alterada;
* skipped;
* cancelled;
* realização;
* realização parcial.

---

# 45. Occurrence key

Identidade estável:

```text
recurring_rule_id
+
occurrence_key
```

Exemplo mensal:

```text
2026-09
```

Permite reconciliação entre previsão e evento real.

---

# 46. Alteração de recorrência

Mudança futura não reescreve histórico.

V1:

```text
regra antiga
→ end_on

nova regra
→ start_on
```

Não construiremos infraestrutura genérica de versionamento.

Overrides antigos continuam válidos.

---

# 47. Receita incerta

Uma receita prevista pode existir sem participar do forecast conservador.

Exemplo:

```text
PLR esperada R$ 20.000
```

Pode ter:

```text
include_in_conservative_forecast = false
```

Se realizar parcialmente:

```text
esperado   20.000
realizado  12.000
restante    8.000
```

O realizado é derivado de FinancialEvents relacionados.

Não armazenamos `realizedAmount`.

---

# 48. Forecast Engine

O Forecast Engine será puro.

Arquitetura:

```text
Domain sources
      ↓
ForecastTimelineBuilder
      ↓
ForecastItem[]
      ↓
ForecastEngine
```

O engine não conhece:

* PostgreSQL;
* Drizzle;
* cartão;
* salário;
* recorrência;
* meta.

Recebe apenas itens normalizados.

---

# 49. ForecastItem

Conceitualmente:

```ts
ForecastItem {
  date
  amount
  direction
  source
  certainty
  referenceId
}
```

Fontes:

```text
RECURRING
PLANNED_EVENT
INSTALLMENT
CREDIT_CARD_PAYMENT
GOAL
```

---

# 50. Cenários

Dois cenários:

```text
CONSERVATIVE
EXPECTED
```

### Conservative

Inclui:

* receitas marcadas como confiáveis;
* todas as despesas/obrigações conhecidas.

### Expected

Inclui:

* todas as receitas previstas;
* todas as despesas conhecidas.

Na V1 não existirão despesas planejadas “opcionais”.

Se uma despesa entrou no forecast, é considerada compromisso.

---

# 51. Timeline

Forecast é internamente event-based.

Eventos do mesmo dia são agregados antes de alterar saldo.

Exemplo:

```text
01/09
+15000
-3000
-2000
------
+10000
```

Evita mínimos artificiais por ordem intraday.

---

# 52. Forecast consolidado e por conta

Serão calculados:

```text
Household Forecast
Account Forecast
```

Consolidado responde:

> Há dinheiro suficiente?

Por conta responde:

> O dinheiro estará na conta correta?

Pode haver alerta:

> Bradesco ficará negativo em 10/09 apesar de existir saldo em outra conta.

---

# 53. Spendable Engine

Tudo que reduz spendable deve entrar primeiro no forecast.

Assim:

```text
rawSpendable =
minimumProjectedBalance
- operationalBuffer
```

```text
displaySpendable =
max(0, rawSpendable)
```

Se negativo:

```text
Pode gastar: R$ 0
Déficit para preservar reserva: R$ X
```

---

# 54. Horizonte

Default:

```text
90 dias
```

Configurável.

Página de projeção pode mostrar:

* 30 dias;
* 60 dias;
* 90 dias;
* 6 meses;
* 12 meses.

Alterar visualização para 12 meses não muda automaticamente o horizonte utilizado pelo indicador principal de spendable.

---

# 55. Operational Buffer

Configuração absoluta:

```text
operational_buffer_cents
```

Exemplo:

```text
R$ 5.000
```

Não teremos buffer percentual ou baseado em meses de despesa na V1.

---

# 56. Spendable contextual

Exemplo:

```text
globalSpendable = 3000
Caixinha Restaurante = 800
```

```text
restaurantSpendable =
min(3000, 800)
```

Recursos restritos aplicáveis são apresentados separadamente.

```text
Caixinha geral       800
Vale refeição        500
Total contextual    1300
```

Sem double-count.

---

# 57. Forecast explicável

O resultado nunca deve ser apenas:

```text
R$ 2.345
```

Deve permitir explicar:

```text
Saldo atual                    12.000
Menor saldo projetado           7.345
Reserva operacional            -5.000
-------------------------------------
Pode gastar                     2.345
```

Também deve ser possível identificar quais eventos causam o ponto mínimo.

Explicabilidade é requisito de domínio.

---

# 58. Metas

Tipos conceituais:

```text
MONTHLY_CONTRIBUTION
TARGET_AMOUNT
```

Uma meta pode combinar:

```text
target_amount
target_date
committed_monthly_amount
```

Exemplo:

```text
Reserva

target         50.000
targetDate     31/12/2027
committed      1.500/mês
```

---

# 59. Metas vinculadas a contas

Relacionamento:

```text
financial_goal_accounts
```

Uma meta pode possuir várias contas.

```text
currentAmount =
SUM(linked account balances)
```

Uma conta poderá participar de no máximo uma meta ativa na V1, evitando double-count de progresso.

---

# 60. Meta sem conta

Metas sem conta vinculada podem possuir:

```text
goal_contributions
```

Não duplicamos contribuições quando o progresso já é derivado de contas vinculadas.

---

# 61. Aporte comprometido

Somente aporte **comprometido** entra no forecast.

Aporte sugerido não.

Exemplo:

```text
sugerido      2000
comprometido  1500
```

Forecast:

```text
-1500
```

---

# 62. Goal realization

Se meta mensal de R$ 3.000 gera item virtual e ocorre transferência real de R$ 3.000:

```text
virtual occurrence
→ substituída pelo evento real
```

Nunca contar os dois.

Eventos reais poderão ser relacionados à meta.

---

# 63. Aporte sugerido

V1:

```text
remaining =
target - current

suggestedMonthly =
remaining / remainingMonths
```

Sem:

* juros compostos;
* inflação;
* retorno esperado.

---

# 64. Status de metas

Persistidos:

```text
ACTIVE
COMPLETED
ARCHIVED
```

Derivados:

```text
ON_TRACK
BEHIND
ACHIEVED
```

Atingir o valor alvo não conclui automaticamente a meta.

Usuário decide concluir.

---

# 65. Patrimônio

Patrimônio é derivado.

```text
netWorth(asOf) =
Σ posições das contas incluídas
```

Para cartão, utiliza obrigação contratual total correta, incluindo parcelas futuras ainda comprometidas.

Não existirão snapshots obrigatórios na V1.

---

# 66. Investimentos V1

`AccountType.INVESTMENT` existe.

Mas não teremos:

* ativos;
* quantidade;
* preço médio;
* cotação;
* dividendos;
* benchmark;
* rentabilidade por ativo.

Usuário informa posição manualmente.

Atualização:

```text
saldo 150k
novo saldo 157.5k
```

gera:

```text
ADJUSTMENT +7.5k
```

---

# 67. Aporte vs valorização

Aporte:

```text
Conta corrente -3000
Investimento   +3000
```

é `TRANSFER`.

Não altera patrimônio.

Valorização:

```text
Investimento +500
```

é `ADJUSTMENT`.

Não aparece como receita operacional.

---

# 68. FGTS

FGTS não terá domínio específico.

Exemplo:

```text
type               OTHER
liquidity          RESTRICTED
spendability       EXCLUDED
includeInNetWorth  true
```

Pode ser atualizado por `ADJUSTMENT`.

UI poderá indicar quando saldo manual está desatualizado através da data do último lançamento.

---

# 69. Application Commands

Operações importantes serão use cases explícitos.

Exemplos:

```text
CreateAccount
CreateOpeningBalance
CreateExpense
CreateIncome
CreateTransfer

CreateCreditCardPurchase
CreateInstallmentPurchase

RegisterRefund
ConfirmRefund

CorrectFinancialEvent
ReverseFinancialEvent

CreateRecurringRule
RealizeRecurringOccurrence

CreateBudget
CreateBudgetAllocationRule

CreateFinancialGoal
RegisterGoalContribution
```

Não haverá Command Bus ou CQRS infrastructure.

---

# 70. Server Actions

Server Actions serão adapters finos.

```text
UI
 ↓
Server Action
 ↓
Zod
 ↓
FinancialContext
 ↓
Use Case
 ↓
Domain
 ↓
Repository / Drizzle
```

Server Actions não implementam regra financeira.

---

# 71. Commands serializáveis

Exemplo:

```ts
{
  commandId: string,
  amountCents: string,
  occurredOn: "2026-08-29"
}
```

Objetos de domínio não cruzam boundaries React/Next.

---

# 72. Idempotência

Writes financeiros são idempotentes.

Tabela:

```text
application_commands
- household_id
- command_id
- operation
- resource_id
- created_at
```

Constraint:

```text
UNIQUE(household_id, command_id)
```

A gravação ocorre na mesma transaction do use case.

Retry não duplica lançamento.

---

# 73. Transaction boundaries

Use case controla atomicidade.

Exemplo de compra parcelada:

```text
financial_event
installment_plan
installments
entries
command
```

Tudo dentro de:

```text
db.transaction()
```

Tudo ou nada.

Repositories não abrem transactions independentes.

---

# 74. Aggregates

Aggregates existem por invariantes, não por árvore de FK.

Exemplo:

```text
CreditCardPurchase
└── InstallmentPlan
    └── Installments
```

`Account` não faz parte desse aggregate.

Não carregaremos estruturas OO gigantes.

---

# 75. Persistência

Aggregates complexos podem utilizar Repository.

Configurações/CRUD simples podem utilizar Drizzle diretamente.

Não existirá repository só por simetria arquitetural.

---

# 76. Reads

Reads serão otimizados independentemente do domínio OO.

```text
Writes
→ use cases + domain

Reads
→ Drizzle / SQL / read models
```

Mesmo banco, mesmo deploy.

Não é CQRS infraestrutural.

---

# 77. Erros

Erros esperados utilizam:

```ts
Result<T, E>
```

Exceptions ficam para:

* bugs;
* banco indisponível;
* falhas inesperadas.

Erros técnicos inesperados vão para Sentry.

---

# 78. Concorrência

Estratégia:

* PostgreSQL transactions;
* constraints;
* optimistic locking somente onde necessário.

Não haverá campo `version` em todas as tabelas preventivamente.

---

# 79. UUID

IDs principais:

```text
UUIDv7
```

Geráveis antes do INSERT e temporalmente ordenáveis.

---

# 80. Validação

Três níveis:

```text
UI/Form
→ Zod

Domain
→ invariantes

PostgreSQL
→ constraints
```

Duplicação deliberada quando aumenta segurança.

---

# 81. Frontend architecture

Regra:

```text
Server Component
→ padrão

Client Component
→ somente quando necessário
```

Client islands serão pequenos.

Não haverá fetch geral de dashboard no browser.

---

# 82. Estado

V1 começa sem:

* Redux;
* Zustand;
* Jotai;
* TanStack Query.

Hierarquia:

```text
dados do servidor → Server Components
filtros           → URL/searchParams
form              → RHF
estado local      → useState
sessão            → server auth
```

---

# 83. Forms

```text
React Hook Form
+
Zod
```

Zod também roda novamente no servidor.

---

# 84. MoneyInput

Componente próprio.

```text
"6.000,00"
→ "600000"
→ BigInt
→ Money
```

Não usar `input type=number` como abstração monetária principal.

---

# 85. DateInput

Boundary sempre:

```text
YYYY-MM-DD
```

Domain:

```text
Temporal.PlainDate
```

---

# 86. Navegação V1

Sidebar:

```text
Visão geral
Transações
Contas
Cartões
Caixinhas
Projeção
Metas

Configurações
```

Home autenticada será:

```text
/
```

e representa a Visão Geral.

---

# 87. Dashboard

Prioridade é decisão, não BI.

Conteúdo inicial:

```text
Pode gastar com segurança
Cenário esperado

Saldo disponível
Patrimônio

Próximos compromissos
Próximas receitas

Forecast 90 dias

Caixinhas

Faturas

Alertas
```

Alertas são determinísticos na V1.

---

# 88. Transações

`/transactions`

Filtros:

* período;
* conta;
* categoria;
* tipo;
* status;
* origem;
* tags.

Filtros permanecem na URL.

---

# 89. Detalhe de evento

`/transactions/[id]`

Mostra:

* evento econômico;
* parcelas;
* estornos;
* relações;
* histórico relevante;
* ações disponíveis.

Correções complexas não ficam escondidas em um modal genérico.

---

# 90. Accounts

`/accounts`

Agrupamentos possíveis:

```text
Disponíveis
Restritos
Investimentos
Passivos
```

`/accounts/[id]` mostra:

* saldo;
* disponibilidade;
* patrimônio;
* movimentações;
* configurações.

---

# 91. Credit Cards UI

`/credit-cards/[id]`

Mostra:

* fatura atual;
* próxima fatura;
* limite;
* comprometimento;
* fechamento;
* vencimento;
* parcelamentos;
* estornos esperados;
* compras recentes.

---

# 92. Caixinhas UI

`/budgets`

A UI utiliza o termo **Caixinhas**.

Mostra:

```text
Saldo acumulado
Aporte do mês
Gasto do mês
```

---

# 93. Forecast UI

`/forecast`

Permite explorar:

```text
30d
60d
90d
6m
12m
```

e:

```text
Conservador
Esperado
```

Inclui gráfico + timeline explicável.

---

# 94. Goals UI

`/goals`

Mostra:

* progresso;
* valor alvo;
* prazo;
* aporte comprometido;
* aporte sugerido;
* on-track/behind.

---

# 95. Settings

```text
Espaço financeiro
Membros
Categorias
Recorrências
Calendário
Preferências
```

Recorrências e feriados não ocupam navegação principal.

---

# 96. Onboarding

Primeiro acesso:

```text
1. Criar espaço financeiro
2. Cadastrar primeira conta
3. Informar saldo inicial
4. Cadastrar cartão opcional
5. Configurar receita recorrente
6. Configurar reserva operacional
```

Não será obrigatório concluir tudo antes de usar o produto.

---

# 97. Mobile

V1:

* desktop-first;
* responsividade simples;
* cadastro/consulta viáveis no navegador móvel.

Não haverá:

* app nativo;
* PWA avançado;
* offline;
* experiência mobile-first.

App fica para V2/V3.

---

# 98. CSV

V1 terá exportação CSV.

A exportação respeitará filtros da tela de transações.

Não haverá pipeline genérica de importação CSV na V1.

Importação, reconciliação e MCP ficam para evolução posterior.

---

# 99. Metadata externa

Mesmo sem integração V1, eventos poderão possuir metadata opcional:

```text
external_source
external_id
```

Isso prepara Open Finance/MCP/importações futuras.

---

# 100. Reconciliação futura

Arquitetura deve permitir futuramente:

```text
lançamento manual
+
lançamento bancário
→ mesma realidade financeira
```

Não haverá implementação completa dessa pipeline no lançamento inicial.

---

# 101. Ajuste de saldo

Se saldo real divergir do calculado e usuário decidir aceitar a diferença:

```text
FinancialEvent(ADJUSTMENT)
```

Nunca:

```text
UPDATE account SET balance = ...
```

---

# 102. Observabilidade

Sentry será usado desde V1.

Permitido:

* IDs opacos;
* tipo de evento;
* use case;
* duração;
* stack técnica.

Não deve ser enviado:

* valor monetário;
* descrição;
* nome de conta;
* notas;
* cookies;
* tokens;
* Authorization;
* payload financeiro completo.

Logs servem para operar software, não reproduzir a vida financeira do usuário.

---

# 103. Logs

Exemplo adequado:

```json
{
  "event": "financial_event_created",
  "eventId": "...",
  "kind": "EXPENSE",
  "durationMs": 42
}
```

Evitar conteúdo financeiro sensível.

---

# 104. Rate limiting

Não será introduzido Redis/Upstash preventivamente.

Rate limiting específico será utilizado quando surgirem endpoints públicos próprios, como:

* webhook;
* API;
* MCP.

---

# 105. Banco local

Desenvolvimento utiliza PostgreSQL real em Docker.

Não utilizaremos SQLite local.

```text
LOCAL      → PostgreSQL Docker
PRODUCTION → Neon PostgreSQL
```

---

# 106. Ambientes

Inicialmente:

```text
LOCAL
PRODUCTION
```

Vercel Preview serve como ambiente efêmero.

Não haverá staging permanente inicialmente.

---

# 107. Migrations

Schema Drizzle versionado.

Migrations ficam no Git.

Nenhuma alteração manual de produção através do dashboard como processo normal.

Migrations serão forward-oriented.

Estratégia quando necessário:

```text
expand
deploy compatível
migrate data
contract
```

---

# 108. PostgreSQL avançado

Drizzle não limita o uso do PostgreSQL.

SQL manual em migrations é permitido para:

* constraint triggers;
* composite constraints;
* índices parciais;
* features avançadas.

O ORM não define o menor denominador comum da arquitetura.

---

# 109. Deploy e migration

Migration não roda no boot da aplicação.

Pipeline:

```text
CI
↓
migration controlada
↓
deploy
```

Nunca:

```text
server start → migrate()
```

---

# 110. CI

Pull requests executam:

```text
lint
typecheck
unit tests
integration tests
build
```

Poucos testes E2E críticos via Playwright.

Vercel produz Preview Deployment.

Fluxo:

```text
branch
→ PR
→ CI
→ merge main
→ migration
→ production deploy
```

Mesmo com um único desenvolvedor.

---

# 111. Seed

Dois conceitos:

```text
db:seed
db:seed:demo
```

Dataset demo deve possuir:

* contas;
* cartão;
* benefício;
* salário;
* despesas;
* parcelamento;
* Caixinhas;
* metas;
* forecast.

Nunca utilizar dados financeiros reais para desenvolvimento.

---

# 112. Dados de produção

Proibido como processo normal:

* baixar produção para desenvolvimento;
* usar household real para testes;
* copiar payload financeiro para issue;
* enviar informações financeiras para logs/Sentry.

Bugs devem ser reproduzidos com dados fictícios.

---

# 113. Backup

V1:

```text
Neon recovery/PITR
+
exportação CSV manual
```

Backup lógico externo:

```text
pg_dump → R2/S3
```

fica no backlog.

Não será implementado apenas para satisfazer arquitetura preventiva.

---

# 114. Índices iniciais

Exemplos:

```text
account_entries
(household_id, account_id, posted_on)

financial_events
(household_id, occurred_on)

financial_events
(household_id, category_id, occurred_on)

budget allocations/rules
(household_id, category_id, period)

recurring occurrences
(expected_on)
```

Novos índices devem preferencialmente ser motivados por queries reais e `EXPLAIN ANALYZE`.

---

# 115. Deletes

Default de FK:

```text
RESTRICT
```

`CASCADE` somente quando entidade filha não possui significado independente.

Nunca:

```text
account DELETE
→ cascade entries
```

Contas/categorias usadas são arquivadas.

---

# 116. Testes

Maior investimento será no domínio.

## Unitários

* Money;
* allocate;
* billing cycle;
* parcelamento;
* refund;
* correction;
* business calendar;
* Caixinha rollover;
* ForecastEngine;
* Spendable;
* metas.

## Integração

PostgreSQL real:

* constraints;
* tenant isolation;
* deferred transfer trigger;
* rollback;
* Drizzle queries;
* idempotência.

## E2E

Poucos fluxos críticos:

* login;
* criar conta;
* criar despesa;
* compra parcelada;
* dashboard.

---

# 117. Vertical slices de implementação

## Slice 0 — Bootstrap

```text
Next.js
Tooling
Docker/Postgres
Drizzle
Better Auth
Google OAuth
Household
CI
Vercel/Neon
Sentry
```

## Slice 1 — Ledger básico

```text
Conta
Saldo inicial
Despesa simples
Saldo derivado
Extrato
```

## Slice 2 — Categorias e Caixinhas

```text
Categorias
Subcategorias
Caixinhas
Rollover
Allocation rules
```

## Slice 3 — Cartão à vista

```text
Cadastro
Billing rules
Compra
Fatura projetada
Pagamento
Limite
```

## Slice 4 — Parcelamento

```text
InstallmentPlan
Installments
Comprometimento
Faturas futuras
```

## Slice 5 — Recorrências e Forecast

```text
RecurringRule
Calendar
Overrides
ForecastTimelineBuilder
ForecastEngine
```

## Slice 6 — Spendable

```text
Operational Buffer
Conservative Forecast
Expected Forecast
Spendable Engine
Account forecast
```

## Slice 7 — Metas e patrimônio

```text
FinancialGoal
Goal accounts
Goal contributions
NetWorth
Investimentos manuais
FGTS
```

## Slice 8 — Estornos e correções

```text
Refund
Expected Refund
Reversal
Correction
Partial refund
Installment cancellation
```

## Slice 9 — Exportação e polish

```text
CSV
Alertas
Onboarding
Empty states
Responsividade
UX refinements
```

---

# 118. Non-goals V1

Não fazem parte da V1:

* microsserviços;
* app nativo;
* mobile-first;
* PWA offline;
* Open Finance;
* integração automática bancária;
* importação genérica CSV;
* MCP financeiro;
* IA para categorização;
* event sourcing;
* CQRS infraestrutural;
* General Ledger contábil completo;
* multi-currency;
* RBAC;
* auditoria formal;
* PostgreSQL RLS;
* módulo completo de investimentos;
* cotação de ativos;
* dividendos;
* rentabilidade por ativo;
* backup lógico externo automático;
* staging permanente;
* sistema sofisticado de feature flags;
* observabilidade distribuída completa;
* Command Bus;
* monorepo;
* BI/report builder.

---

# 119. Evoluções V2+

Possíveis evoluções:

```text
App mobile
MCP
Importação bancária
Open Finance
Reconciliação automática
Regras automáticas de categorização
IA para classificação
Backup S3/R2
Módulo completo de investimentos
Busca global
Command Palette
Automação de feriados
Multi-household UI
Multi-currency
Cenários financeiros avançados
```

---

# 120. ADRs principais

## ADR-001 — Modular Monolith

Escolhido por simplicidade e baixa necessidade operacional.

## ADR-002 — PostgreSQL como source of truth

Domínio relacional, transacional e dependente de constraints fortes.

## ADR-003 — Ledger derivado

Saldo nunca é source of truth.

## ADR-004 — FinancialEvent separado de AccountEntry

Separa fato econômico de liquidação financeira.

## ADR-005 — Cartão como Account

Permite unificação de transferências, pagamentos e patrimônio.

## ADR-006 — Fatura como projection

Evita entidade prematura sem comportamento próprio necessário.

## ADR-007 — Parcelamento como evento econômico único + schedule

Evita confundir consumo com fluxo de caixa.

## ADR-008 — Histórico financeiro append/correct

Eventos POSTED não são silenciosamente reescritos.

## ADR-009 — Caixinhas acumulativas

Envelope budgeting com rollover positivo e negativo.

## ADR-010 — Forecast puro

ForecastEngine não acessa persistência.

## ADR-011 — Spendable derivado do menor saldo futuro

O indicador leva em conta compromissos, não somente saldo atual.

## ADR-012 — Tenant via Household

Usuário não é owner direto dos dados financeiros.

## ADR-013 — Google OAuth via Better Auth

Reduz superfície de autenticação na V1.

## ADR-014 — Server-first Next.js

Server Components e Server Actions por padrão.

## ADR-015 — Drizzle não limita PostgreSQL

SQL avançado pode ser usado diretamente quando apropriado.

## ADR-016 — Vercel/Neon são infraestrutura, não arquitetura

Aplicação permanece executável por Docker/PostgreSQL padrão.

---

# 121. Invariantes críticas

O sistema deve preservar, no mínimo:

```text
1. Todo AccountEntry pertence a um FinancialEvent.

2. Saldo é sempre derivado de entries.

3. Entry POSTED não pode estar no futuro.

4. AccountEntry não pode preceder tracking_started_on.

5. TRANSFER possui exatamente duas contas na V1.

6. SUM(entries de TRANSFER) = 0.

7. InstallmentPlan:
   SUM(parcelas) = valor total.

8. Refunds nunca excedem o valor econômico original.

9. Um evento não pode receber dois reversals efetivos.

10. Eventos e contas relacionados pertencem ao mesmo household.

11. Uma categoria utilizada não pode ser reparented.

12. Uma conta participa de no máximo uma meta ativa.

13. Eventos monetários possuem amount > 0.

14. Datas financeiras utilizam DATE/PlainDate.

15. Dinheiro nunca utiliza float.

16. CommandId é idempotente dentro do household.

17. POSTED financeiro é corrigido por reversal/correction,
    não por overwrite silencioso.

18. Pagamento de cartão não é despesa.

19. Transferência para investimento não é despesa.

20. Valorização patrimonial não é receita operacional.

21. Compra parcelada afeta Caixinha pelo valor econômico total.

22. Recursos RESTRICTED não reduzem simultaneamente a
    Caixinha GENERAL.

23. Forecast não duplica previsão e realização.

24. Goal forecast não duplica aporte virtual e transferência real.

25. Alterações de billing/recurrence/budget respeitam vigência
    temporal e não reinterpretam silenciosamente o passado.
```

---

# 122. Critério arquitetural de sucesso

A arquitetura V1 será considerada bem-sucedida se permitir responder de forma consistente e explicável:

```text
Quanto tenho?

Quanto devo?

Quanto está comprometido?

Quanto gastei?

Quando o dinheiro realmente sairá?

Quanto tenho reservado em cada Caixinha?

Quanto posso gastar com segurança?

O que acontecerá com meu caixa nos próximos 90 dias?

Meu patrimônio está crescendo?

Estou cumprindo meus aportes e objetivos?
```

Sem misturar esses conceitos em um único “saldo”.

---

# 123. Estado final da TechSpec

Esta especificação está **fechada para início da implementação**.

Alterações estruturais posteriores devem ser tratadas como decisões arquiteturais explícitas, preferencialmente registradas como ADRs, principalmente quando afetarem:

* ledger;
* semântica financeira;
* invariantes;
* tenancy;
* cálculo de Forecast;
* cálculo de Spendable;
* histórico financeiro.

Detalhes locais de implementação podem evoluir durante os vertical slices desde que preservem as decisões e invariantes definidas neste documento.
