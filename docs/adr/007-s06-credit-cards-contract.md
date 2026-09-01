# ADR-007 — Contrato de cartões, faturas e parcelas do S06

- **Status:** Aceito
- **Data:** 2026-08-30
- **Escopo:** T01 do slice S06 — Cartões, faturas e compras parceladas
- **Dependências:** S01, S02, S03, ADR-004 e ADR-006 da TechSpec

## Contexto e decisão

O documento específico do S06 e as seções 18–27 e 117 da TechSpec prevalecem
sobre a formulação histórica do PRD que tratava cartão apenas como tag. O
cartão será uma conta `accounts.type=CREDIT_CARD`, com configuração 1:1 em
`credit_cards`; não haverá tabela `transactions`, `credit_card_statements` ou
`accounts.balance`. Fatura, limite, obrigação e crédito são projections.

A relação canônica é `Account → Purchase → InstallmentPlan → Installments`.
`FinancialEvent` continua sendo o fato econômico: cada compra cria exatamente
um evento `PURCHASE`, com `amount_cents` absoluto e positivo. À vista e 1x são
aliases de um plano com exatamente uma parcela; N>1 cria o mesmo evento, um
plano e exatamente N parcelas. Cada parcela referencia sua compra e seu plano.
O total econômico é usado uma vez (inclusive no handoff de Caixinhas); o
schedule representa somente o fluxo de cobrança.

## Billing, dinheiro e ledger

Uma regra de billing é selecionada pela data da compra, com intervalo
`effective_from <= occurred_on < effective_until`; regras futuras nunca
reinterpretam um schedule materializado. Dias são `Temporal.PlainDate`/
`PlainYearMonth`, persistidos como `DATE`, sem `Date`, timezone ou float.
O próprio dia do fechamento entra na próxima fatura: com fechamento 10,
compras em 09/08/2026 entram no ciclo que fecha 10/08, e compras em 10 ou
11/08 entram no ciclo que fecha 10/09. Dia inexistente é normalizado para o
último dia do mês. O vencimento usa o primeiro dia normalizado estritamente
posterior ao fechamento (dia de vencimento menor/igual ao fechamento rola
para o mês seguinte). Cada parcela congela ciclo, fechamento, vencimento,
dias configurados e identificador da regra. `billing_due_on_override`, se
usado, pertence somente à parcela autorizada, deve ser uma data válida após o
fechamento e não altera a regra global nem outras compras.

Valores atravessam boundaries como strings decimais de centavos e no domínio
são `bigint`/`Money`. A divisão é inteira e determinística, distribuindo o
remainder pelas primeiras parcelas: `10000 / 3 = [3334,3333,3333]`; sempre
`SUM(installments)=purchase.amount_cents`.

O evento `PURCHASE` é `POSTED` quando a compra é registrada. Cada parcela tem
um único `AccountEntry` negativo do cartão: `EXPECTED` com `expected_on` para
um lançamento futuro, ou `POSTED` com `posted_on` quando publicado. Entries
esperados não entram no saldo; entries publicados podem ser promovidos sem
criar novo evento. Projections usam parcelas como fonte exclusiva das linhas
de fatura e usam entries somente para estado/posição; nunca somam evento,
entry e parcela juntos.

Parcelas só transitam `PLANNED → POSTED` ou `PLANNED/POSTED → CANCELLED` no
cancelamento do aggregate. Não existe `PAID` nem mutação de parcela isolada.

## Fatura, limite e pagamento

As leituras são explícitas: `getCurrentStatementAmount`,
`getProjectedStatementAmount`, `getOutstandingCardObligation`,
`getAvailableCreditLimit` e `getCardCreditBalance`. Uma linha de fatura tem
`referenceId`, compra, parcela, sequência, centavos, ciclo, vencimento e
estado `PROJECTED|CONFIRMED`; compra 1x aparece uma vez e N aparece uma vez
por ciclo. Fatura atual, próxima, parcelas futuras, obrigação contratual
bruta, obrigação pendente, limite comprometido/disponível, posição corrente e
crédito são campos distintos.

Pagamento é `TRANSFER`: um evento, duas entries do mesmo household (origem
negativa e cartão positiva), soma zero, sem `statementId` ou `installmentId`.
Pagamentos são créditos globais; a projection calcula estado de fatura por
ciclo, em ordem de vencimento, sem marcar parcela como paga. Parcial, total,
pagamento fora de ordem e overpayment são determinísticos. O crédito é
`max(credits - outstanding, 0)` e aparece separado; não aumenta silenciosamente
o limite contratual. Não há parcelamento de fatura, juros ou rotativo.

## Estados, edição e cancelamento

`POSTED` financeiro é imutável. Atualização permite somente descrição,
categoria compatível e metadata; valor, cartão, data econômica, quantidade,
sequência, billing snapshot e entries retornam `NON_EDITABLE_FIELD`.

`CancelCreditCardPurchase` bloqueia o aggregate e, em uma transaction, marca o
evento `CANCELLED`, cancela todas as parcelas futuras e preserva purchase,
plano, parcelas e entries. Entries publicados não são sobrescritos: cria-se
no máximo uma `REVERSAL` compensatória para os efeitos publicados. Entries
esperados cancelados permanecem históricos e são excluídos das projections.
Pagamentos já registrados permanecem transfers; não se cria refund implícito.
Retry devolve o resultado original; outro command após cancelamento retorna
conflito estável e nunca cria segunda reversal ou órfão.

## Tenancy, commands e atomicidade

`requireFinancialContext()` resolve o `household_id` no servidor. Commands
jamais aceitam tenant, autorização, status, origem, sinais, limite calculado,
datas/ciclos derivados ou IDs de parcela para pagamento. Todos os FKs e joins
incluem `household_id`; ID inexistente ou de outro household responde como
ausente, sem vazamento. Writes usam UUIDv7, `Result<T,E>`, payload
serializável, códigos estáveis (`CARD_NOT_FOUND`, `CARD_ARCHIVED`,
`PURCHASE_NOT_FOUND`, `INVALID_AMOUNT`, `INVALID_BILLING_DAY`,
`INVALID_INSTALLMENT_COUNT`, `NON_EDITABLE_FIELD`, `COMMAND_ID_REUSED` e
`CONFLICT`) e `application_commands` com `UNIQUE(household_id, command_id)`.

Para as compras e pagamentos iniciados pelo usuário, `origin=MANUAL` é
suficiente e o produtor permanece distinguível pelo `kind` e pela operação do
command; `origin=SYSTEM` fica reservado aos fatos compensatórios, como
`REVERSAL`. As operações são `credit_card.create`, `credit_card.update`,
`credit_card.archive`, `credit_card.billing_rule.create`,
`credit_card.billing_rule.update`, `credit_card.purchase.create`,
`credit_card.purchase.update_metadata`, `credit_card.purchase.cancel` e
`credit_card.payment.create`. Cada use case valida contexto, grava command e
seus fatos na mesma `db.transaction()`; falha faz rollback completo. Retries
com payload diferente falham.

## Handoff explícito

| Tasks | Contrato a consumir |
|---|---|
| T02 | tabelas/FKs/checks de cartões, compras, planos, parcelas e entries; vínculo obrigatório purchase↔plan tenant-safe; sem fatura persistida |
| T03 | `resolveBillingCycle`, vigência, normalização de dias e override congelável |
| T04 | `allocateInstallments`, soma exata, sequência 1..N e transições sem `PAID` |
| T05 | CRUD de cartão, regra versionada, arquivamento e `credit_card.create` |
| T06 | `purchase.create`: um evento, N parcelas/entries, snapshot e transaction atômica |
| T07 | projections de fatura/obrigação/limite/crédito; não-duplicidade e pagamentos globais |
| T08 | `payment.create` como transferência de duas entries, sem parcela/statement |
| T09 | metadata editável e cancelamento unitário com reversal/rollback/idempotência |
| T10 | operações e redaction sem valor, descrição, limite, datas financeiras ou payload |
| T11 | Zod, commands/read models serializáveis, preview server-side e estados acessíveis |
| T12–T14 | telas e actions para cartão, compra, fatura e pagamento global; nenhuma ação de parcela |
| T15–T16 | matriz automatizada e E2E de datas, rounding, isolamento, rollback, retry e cancelamento |
| T17 | gates de release, migration, observabilidade e checklist do S06 |

## Matriz mínima de casos-limite

| Caso | Resultado obrigatório |
|---|---|
| fechamento 10; compra 09/10/11 | 09→ciclo que fecha 10/08; 10 e 11→ciclo que fecha 10/09 |
| fechamento 31 em fevereiro | fechamento 28/29; sem rollover implícito; vencimento estritamente posterior |
| vencimento 05/20 com fechamento 10 | 05 rola ao mês seguinte; 20 permanece após o fechamento |
| dezembro→janeiro e regra futura | datas e snapshot estáveis, sem reclassificação |
| `10000/3`, N=1, N alto e N inválido | remainder nas primeiras; soma T; N zero/negativo rejeitado |
| parcela planejada/publicada/cancelada | obrigação inclui só ativa; histórico permanece; nunca `PAID` |
| pagamento parcial/total/overpayment/fora de ordem | estado global por ciclo; crédito separado; sem alocação por parcela |
| cancelamento com entries esperados/publicados/pagamento prévio | futuro sai da projection; posted é compensado; transfer não é apagado |
| retry, payload incompatível, household cruzado, cartão arquivado | resultado original, `COMMAND_ID_REUSED`, ausência segura ou erro de estado |

Esta ADR é o gate semântico para T02–T17; refund parcial, `Expected Refund`,
correction genérica, reconciliação, integração com operadora e cancelamento
parcial ficam em slice posterior. A UI do S06 não renderiza nem promete
`Expected Refund` antes do slice de estornos/correções.
