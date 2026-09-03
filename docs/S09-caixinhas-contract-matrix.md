# S09 — Matriz de dependências, decisões e gates

**Contrato base:** [`ADR-012 — Contrato de Caixinhas, fronteira e integração
S09`](adr/012-s09-caixinhas-contract.md)  
**Porta de integração:** [`reserve-adapter.ts`](../src/modules/spendable/reserve-adapter.ts)  
**Data do gate T01:** 2026-09-02

Esta matriz é o índice operacional de T01. Ela não implementa schema, domínio,
use case, query, provider integrado ou UI. Cada task posterior deve apontar
para esta matriz e para a ADR ao registrar sua própria evidência; uma leitura
verde de uma linha não promove outra task automaticamente.

## 1. Dependências reais e autoridade

| Slice | Fonte real no repositório | O que S09 consome | O que S09 não recria | Gate atual |
| --- | --- | --- | --- | --- |
| S01 — fundação/tenancy | [`src/modules/households/contracts.ts`](../src/modules/households/contracts.ts), [`src/modules/auth/contracts.ts`](../src/modules/auth/contracts.ts), [`docs/tenancy.md`](tenancy.md), [`docs/S01-fundacao-autenticacao.md`](S01-fundacao-autenticacao.md) | `Household`, membership e `FinancialContext` resolvido no servidor | usuário como owner direto, autorização no browser ou novo tenant | Contrato publicado; integração S09 pendente de T05/T06 |
| S02 — contas/categorias | [`src/modules/accounts-categories/contracts.ts`](../src/modules/accounts-categories/contracts.ts), [`src/modules/accounts-categories/validation.ts`](../src/modules/accounts-categories/validation.ts), [`docs/S02-contas-categorias.md`](S02-contas-categorias.md) | `categoryId`, tipo/status de categoria, hierarquia e `household_id`; categorias `EXPENSE` | nova categoria, nova regra de archive/reparenting ou conta duplicada | Contrato publicado; T03/T05 devem provar FKs e isolamento |
| S03 — transação/ledger | [`src/modules/transactions/contracts.ts`](../src/modules/transactions/contracts.ts), [`src/modules/transactions/money.ts`](../src/modules/transactions/money.ts), [`docs/adr/004-s03-transacao-manual-contract.md`](adr/004-s03-transacao-manual-contract.md) | `FinancialEvent`, `AccountEntry`, `POSTED`, `Money`, referências de eventos | saldo de conta, ledger paralelo, ajuste direto ou novo `FinancialEvent` para transferência entre Caixinhas | Contrato publicado; integração de fontes depende dos owners S03 |
| S04 — importação | [`src/modules/transaction-imports/contracts.ts`](../src/modules/transaction-imports/contracts.ts), [`docs/adr/005-s04-importacao-csv-contract.md`](adr/005-s04-importacao-csv-contract.md) | eventos/entries importados pelo contrato canônico do S03, quando presentes | pipeline de importação, reconciliação bancária ou uma fonte de gasto paralela | Dependência indireta; sem gate novo de S09 |
| S05 — revisão/observabilidade | [`docs/adr/006-s05-revisao-transacoes-contract.md`](adr/006-s05-revisao-transacoes-contract.md), [`docs/observability-s05-review.md`](observability-s05-review.md) | histórico/correção e limites de telemetria aplicáveis às boundaries | auditoria por usuário, logs financeiros ou alteração silenciosa de POSTED | Gate transversal de T09/T15 |
| S06 — cartões/parcelas | [`src/modules/credit-cards/contracts.ts`](../src/modules/credit-cards/contracts.ts), [`docs/adr/007-s06-credit-cards-contract.md`](adr/007-s06-credit-cards-contract.md) | compra econômica, parcela e pagamento como conceitos distintos | compra/parcelas como movimentos extras de Caixinha, fatura como gasto duplicado | Contrato publicado; T04/T13 devem provar não dupla contagem |
| S07 — forecast | [`src/modules/forecast/contracts.ts`](../src/modules/forecast/contracts.ts), [`docs/adr/008-s07-forecast-contract.md`](adr/008-s07-forecast-contract.md) | timeline `s07.v1`, `ForecastItem`, referência/reconciliação e cenário | novo forecast, query paralela de recorrências/parcelas ou realização duplicada | Handoff disponível; integração depende de T08 |
| S08 — Spendable | [`src/modules/spendable/reserve-adapter.ts`](../src/modules/spendable/reserve-adapter.ts), [`src/modules/spendable/contracts.ts`](../src/modules/spendable/contracts.ts), [`docs/adr/011-s08-spendable-contract.md`](adr/011-s08-spendable-contract.md), [`docs/S08-disponivel-para-gastar.md`](S08-disponivel-para-gastar.md) | porta `SpendableReserveAdapter`, `s09.v1`, contexto normalizado e ajuste de abertura | fórmula `spendable.v1`, `SpendableEngine`, abertura `GENERAL`, UI ou tabela de snapshot | Porta T08 publicada; provider S09 ainda não integrado |

### Fonte de movimento usada pelo provider

O provider S09 lê dados tenant-scoped antes da porta e monta um `ReserveBox`
com um stream normalizado. O stream pode conter:

1. movimentos persistidos de `CONTRIBUTION`/`WITHDRAWAL`;
2. efeitos de despesa de categoria, normalizados como `WITHDRAWAL` com a
   referência opaca do evento econômico;
3. refund efetivo, normalizado como `CONTRIBUTION` com a referência do refund;
4. correções compensatórias, mantendo a referência de linhagem.

Compra parcelada usa uma única despesa pelo valor econômico total na data da
compra. Parcela, fatura e pagamento de cartão continuam no S06/S07 e não são
adicionados ao stream como novas despesas de Caixinha. Transferência entre
Caixinhas é par −/+ e não passa pelo ledger bancário.

## 2. Decisões fechadas por T01

| Tema | Decisão | Prova primária | Tasks que devem consumir |
| --- | --- | --- | --- |
| Nome | UI: Caixinha; domínio: `Budget`; persistência canônica: `budgets`/`budget_movements`; porta: `ReserveBox` | [ADR-012 §Vocabulário](adr/012-s09-caixinhas-contract.md#vocabulário-público-e-interno) | T02, T03, T05, T08, T10–T12 |
| Associação | uma categoria `EXPENSE` por Caixinha; no máximo uma Caixinha vigente por categoria; subcategoria mais específica vence | [ADR-012 §Categoria](adr/012-s09-caixinhas-contract.md#categoria-e-associação-temporal) | T02–T07, T10–T14 |
| Categoria arquivada | não apaga nem fecha Caixinha; impede novas associações/atribuições automáticas, preserva histórico; movimento explícito em Caixinha ativa segue permitido | [ADR-012 §Categoria](adr/012-s09-caixinhas-contract.md#categoria-e-associação-temporal) | T03–T06, T11–T15 |
| Vigência | `[activeFrom, closedOn)`; início inclusivo, encerramento exclusivo para proteção | [ADR-012 §Ciclo de vida](adr/012-s09-caixinhas-contract.md#ciclo-de-vida) | T02–T05, T08, T13–T15 |
| Reabertura | não reabre o aggregate; cria nova Caixinha/referência com `activeFrom >= closedOn` | [ADR-012 §Ciclo de vida](adr/012-s09-caixinhas-contract.md#ciclo-de-vida) | T03, T06, T11, T13–T15 |
| Movimento no fechamento | `effectiveOn=closedOn` é histórico válido e não protege; data posterior é inválida; command interativo após fechamento falha | [ADR-012 §Ciclo de vida](adr/012-s09-caixinhas-contract.md#ciclo-de-vida) | T02, T05–T08, T13–T15 |
| Sinal | amount sempre positivo; `CONTRIBUTION` soma e `WITHDRAWAL` subtrai | [ADR-012 §Movimentos](adr/012-s09-caixinhas-contract.md#movimentos-e-correções) | T02, T03, T07, T08, T10, T13 |
| Correção | append-only por movimento compensatório; transferência gera par atômico; retry usa `(household_id, commandId)` | [ADR-012 §Correção](adr/012-s09-caixinhas-contract.md#correção-refund-e-idempotência) | T02, T06, T07, T13–T15 |
| Saldo/rollover | `Σ contributions − Σ withdrawals`, em `bigint`; rollover é saldo anterior, positivo ou negativo; nada persistido | [ADR-012 §Saldo](adr/012-s09-caixinhas-contract.md#saldo-rollover-e-despesas) | T02, T03, T05, T08, T13 |
| Compra/refund | compra parcelada reduz pelo total na data econômica; refund soma na data efetiva e mantém origem | [ADR-012 §Associação de despesas](adr/012-s09-caixinhas-contract.md#associação-de-despesas) | T04, T05, T07, T08, T13–T15 |
| Alocação | `amount_cents` effective-dated é nominal/comprometido e também o peso para distribuição realizada; proporção é normalizada e não armazenada como regra paralela | [ADR-012 §Alocação](adr/012-s09-caixinhas-contract.md#alocação-de-receita-realizada) | T03, T04, T07, T13–T15 |
| Receita | somente `INCOME` realizada/`POSTED`; prevista não cria aporte; soma distribuída = receita, com remainder determinístico | [ADR-012 §Quando ocorre](adr/012-s09-caixinhas-contract.md#quando-ocorre-e-como-arredonda) | T04, T07, T13, T14 |
| Meta | progresso vem exclusivamente do saldo da Caixinha; alvo/data opcionais em par; sugestão usa ceil inteira e não vira forecast/command | [ADR-012 §Metas](adr/012-s09-caixinhas-contract.md#metas-progresso-e-aporte-sugerido) | T02, T04, T05, T10–T14 |
| Spendable | `appliedOpeningAdjustment` entra antes do mínimo; `protectedCents` não é subtraído depois; negativo/fechado protegem zero | [ADR-012 §s09.v1](adr/012-s09-caixinhas-contract.md#contrato-s09v1-e-porta-s08) | T05, T07, T08, T13–T15 |
| Tenancy | contexto server-side; porta sem household/user/account/saldo/timeline/autorização do browser; referência estrangeira é ausência opaca | [ADR-012 §Contexto aceito](adr/012-s09-caixinhas-contract.md#contexto-aceito) | todas as boundaries T05–T15 |

## 3. Matriz de cenários normativos

Todos os valores são centavos. `protected` é a proteção global antes da
fórmula de Spendable; `applied` é o ajuste signed que entra na abertura.

| Cenário | Dados e cálculo | Resultado obrigatório | Evidência posterior |
| --- | --- | --- | --- |
| Aportes múltiplos | `+10000`, `+2500`, `-3000` | saldo `9500`, proteção `9500`; cada referência permanece | T02/T13 unitário |
| Retirada libera uma vez | aporte `+10000` já refletido; retirada `2500` não refletida | saldo `7500`, `applied=+2500`; não devolver retirada também no forecast | T07/T08/T13 |
| Transferência | origem `-30000`, destino `+30000`, mesmo command | duas referências únicas, efeito bancário `0`, sem receita/despesa | T07/T13/T14 |
| Rollover positivo | agosto `+10000-7000=3000`; setembro aporte `+10000` | saldo de setembro `13000`; `3000` não desaparece | T02/T04/T13 |
| Rollover negativo | agosto `-2000`; setembro sem aporte | saldo permanece `-2000`, proteção `0`, histórico explica déficit | T02/T05/T08/T13 |
| Encerramento | saldo `5000`, `closedOn=2026-09-10` | corte 09/09 protege `5000`; corte 10/09 ou posterior protege `0`, referências continuam | T02/T05/T08/T13/T14 |
| Movimento no fechamento | movimento de `1000` em `closedOn` | entra no balanço histórico daquele corte, mas não na proteção; após `closedOn` nenhum efeito novo | T02/T07/T08 |
| Receita realizada | `I=1150000`, pesos `50,20,20,10` | contribuições `575000,230000,230000,115000`; soma `1150000` | T04/T07/T13/T14 |
| Receita prevista | `EXPECTED=300000`, sem realização | nenhum movimento automático; cenário de forecast segue regra S07 | T04/T07/T13 |
| Despesa por categoria | `EXPENSE=60000` na subcategoria vigente | uma retirada `-60000` na Caixinha mais específica; categoria arquivada depois não reescreve | T04/T05/T13 |
| Compra parcelada | compra econômica `600000` em 10x `60000` | Caixinha reduz `600000` uma vez na compra; parcelas são forecast, não 10 retiradas | T04/T08/T13 |
| Refund | despesa `600000` em 29/08; refund `100000` efetivo em 05/09 | saldo reduz pela despesa e recebe `+100000` somente a partir de 05/09 | T04/T05/T13 |
| Proteção não refletida | contribuição efetiva `100000`, nenhuma referência refletida | componente `BOX_BALANCE`, `protected=100000`, `applied=-100000`; S08 aplica antes do mínimo | T08/T13/T14 |
| Proteção refletida | contribuição `100000` já em `POSTED`/forecast | mesma proteção explicável, `applied=0`; nenhum ajuste duplicado | T07/T08/T13 |
| Negativo/fechado no provider | saldo `-2000` ou corte `>=closedOn` | aparece no balanço S09, sem componente protegido e sem aumento do global | T05/T08/T13/T14 |
| Recursos classificados | abertura `GENERAL=100000`, `RESTRICTED=900000`, `EXCLUDED=500000` | S08 recebe somente `100000`; filtro não é recriado pelo S09 | T08/T13/T15 |

## 4. Gates por task

| Task | Pré-condição para iniciar | Evidência mínima para fechar | Estado nesta T01 |
| --- | --- | --- | --- |
| [T02 — domínio](../tasks/S09-caixinhas/002-dominio-saldo-rollover_task.md) | ADR-012 e tipos de dinheiro/data/ref explícitos | testes puros de saldo, vigência, rollover, negativo e validações | Aberta; não iniciada |
| [T03 — schema](../tasks/S09-caixinhas/003-schema-migrations-integridade_task.md) | nomes e invariantes temporais da ADR | migration/check, FKs compostas, unicidade, sem `balance`/snapshot, rollback | Aberta; não iniciada |
| [T04 — alocação](../tasks/S09-caixinhas/004-regras-vigencia-alocacao_task.md) | regra de pesos/amounts e arredondamento desta ADR | fixtures de passado/presente/futuro/ausência, soma exata, refund/parcelas | Aberta; não iniciada |
| [T05 — reads](../tasks/S09-caixinhas/005-reads-tenant-safe-saldo-progress_task.md) | T02–T04 e contexto S01/S02 | reads tenant-safe, cutoff/rollover/progresso e nenhuma persistência de saldo | Aberta; não iniciada |
| [T06 — CRUD](../tasks/S09-caixinhas/006-use-cases-crud-lifecycle_task.md) | schema/reads e lifecycle da ADR | commands atômicos/idempotentes, close histórico, errors e revalidação | Aberta; não iniciada |
| [T07 — movimentos](../tasks/S09-caixinhas/007-movimentos-aportes-retiradas-transferencias_task.md) | lifecycle, saldo e regras | aportes/retiradas, correção, transferência par, retries e rollback | Aberta; não iniciada |
| [T08 — provider](../tasks/S09-caixinhas/008-adapter-s09-integracao-spendable_task.md) | reads/movimentos e porta S08 | provider tenant-safe, cinco cenários, serialização `s09.v1`, sem mudar fórmula | Aberta; preparação de mapping/adapter comprovada; integração vertical aguarda T07 |
| [T09 — observabilidade](../tasks/S09-caixinhas/009-observabilidade-segura_task.md) | códigos/limites da ADR | allow-list/redaction e testes sem dados financeiros | Aberta; não iniciada |
| [T10 — UI contracts](../tasks/S09-caixinhas/010-contratos-ui-componentes_task.md) | DTOs de domínio e estados da ADR | view models serializáveis, estados negativo/fechado/indisponível, sem cálculo | Aberta; não iniciada |
| [T11 — UI CRUD](../tasks/S09-caixinhas/011-ui-lista-criacao-manutencao_task.md) | T06/T10 | browser cria/edita/encerra sem autoridade de tenant e sem hard delete | Aberta; não iniciada |
| [T12 — UI movimentos](../tasks/S09-caixinhas/012-ui-movimentos-progresso-impacto_task.md) | T07/T08/T10 | aporte/retirada/transferência, saldo/progresso/impacto e estados acessíveis | Aberta; não iniciada |
| [T13 — testes](../tasks/S09-caixinhas/013-testes-unitarios-integracao_task.md) | T02–T09 | unitário + PostgreSQL real + provider, cinco cenários e redaction | Aberta; não iniciada |
| [T14 — E2E](../tasks/S09-caixinhas/014-testes-e2e_task.md) | T11–T13 | fluxo browser real, impacto, histórico, erro, isolamento A/B | Aberta; não iniciada |
| [T15 — release](../tasks/S09-caixinhas/015-validacao-release-handoff_task.md) | T09/T13/T14 | check/migration/integration/E2E/build/smoke e handoff S10 | Aberta; não iniciada |

## 5. Critérios de aceite de `docs/S09-caixinhas.md`

| Critério do documento | Task/teste que prova | Evidência exigida |
| --- | --- | --- |
| criar uma Caixinha | T06/T11/T13/T14 | command e fluxo autenticado, nome/categoria válidos |
| reservar valor | T07/T12/T13/T14 | movimento `CONTRIBUTION` positivo, referência única e saldo derivado |
| saldo consistente | T02/T05/T13 | replay em ordem diferente produz mesmo saldo/refs |
| reserva deixa de ser livre quando protegido | T08/T13/T14 | `protected`/`applied` e Spendable reconciliados uma vez |
| retirada ajusta saldo/disponibilidade | T07/T08/T12–T14 | `WITHDRAWAL`, release/reflection e ausência de dupla entrada |
| encerramento preserva histórico | T02/T05/T06/T11/T13/T14 | cortes antes/depois de `closedOn`, sem hard delete |

## 6. Gate T01 e pendências explícitas

O gate de contrato T01 está apto a ser concluído quando os links, a ADR, o
handoff e a revisão estática abaixo estiverem verdes. As pendências seguintes
não são falhas da especificação; são gates downstream:

- T02–T15 permanecem abertos e não devem ser marcados como concluídos por esta
  matriz.
- Persistência real, FKs, partial/temporal indexes, queries e testes
  PostgreSQL ainda não existem como evidência de S09.
- O provider integrado do S09 ainda não substitui o zero no serviço S08.
- UI, acessibilidade, E2E e observabilidade S09 ainda não têm implementação.
- A promoção global do S08 tem um gate externo documentado em
  [`tasks/S08-disponivel-para-gastar/013-validacao-release-handoff-s09_task.md`](../tasks/S08-disponivel-para-gastar/013-validacao-release-handoff-s09_task.md):
  a última execução registrou `24 passed`, `1 failed` em
  `tests/e2e/forecast.spec.ts:423` (S07/T12). T01 não altera esse slice nem
  usa essa falha para declarar um contrato S09 inválido.

## 7. Comandos de revisão do gate

Os comandos executados e seus resultados são registrados na
[T01](../tasks/S09-caixinhas/001-contrato-e-gate-de-dependencias_task.md). O
gate exige, no mínimo:

```text
rtk git diff --check
rtk npm exec vitest -- run src/modules/spendable/reserve-adapter.test.ts --reporter=dot
rtk npm exec eslint -- src/modules/spendable/reserve-adapter.ts src/modules/spendable/reserve-adapter.test.ts --max-warnings=0
rtk npm exec tsc -- --noEmit --pretty false
```

Esses comandos verificam a porta existente e a compatibilidade pré-S09; não
substituem os testes de T02–T15.
