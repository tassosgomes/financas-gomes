# Tasks — S06: Cartões, faturas e compras parceladas

## Objetivo

Entregar o slice de cartões de crédito ponta a ponta: o usuário cadastra um
cartão, registra uma compra à vista ou parcelada, entende a fatura atual e as
futuras, registra o pagamento da fatura e consegue corrigir/cancelar a compra
sem destruir o histórico nem operar uma parcela isoladamente.

Este plano foi derivado de [`docs/S06-cartoes-faturas-parcelas.md`](../../docs/S06-cartoes-faturas-parcelas.md), do PRD e da TechSpec. As tasks
devem preservar os contratos já entregues por S01–S03 e usar o mesmo ledger,
`household_id`, `Money`, `PlainDate`, UUIDv7 e `application_commands`.

## Decisões normativas do plano

- O S06 é a decisão específica posterior que detalha cartões; portanto, para
  este slice, a seção 7.4 do PRD (cartão representado somente como tag e sem
  fatura/limite) é um requisito histórico superado pelo escopo do S06 e pelas
  seções 18–27 e 117 da TechSpec. O cartão será `accounts.type = CREDIT_CARD`;
  a tag não será uma segunda fonte de verdade.
- S01, S02 e S03 são dependências obrigatórias conforme o documento do S06.
  S04 e S05 permanecem na ordem global do produto, mas não são pré-requisitos
  de domínio para este slice; quando seus módulos existirem, a implementação
  deve preservar `origin` e a revisão de transações.
- `FinancialEvent` continua sendo o fato econômico. Uma compra parcelada é um
  evento `PURCHASE` único, ligado a um `InstallmentPlan` e a exatamente N
  `Installments`. O schedule guarda o compromisso futuro e cada parcela fica
  vinculada à compra originadora; o impacto econômico da compra para futuras
  Caixinhas é o total, não a soma mensal das parcelas.
- Fatura, limite, comprometimento e saldo credor são read models/projections;
  não criar `credit_card_statements` como entidade contábil na V1. A mesma
  parcela não pode ser somada duas vezes quando houver entry no ledger e linha
  de projeção.
- Pagamento de cartão é uma transferência: conta de origem negativa e cartão
  positivo. Não cria despesa, não altera Caixinha e não recebe `installmentId`;
  pagamento isolado de parcela não existirá.
- Valores cruzando boundaries são strings de centavos e no domínio são
  `bigint`/`Money`; datas financeiras são `YYYY-MM-DD`/`Temporal.PlainDate` e
  persistem como `DATE`; não utilizar `float` ou `Date` para a regra financeira.
- Writes são commands serializáveis, tenant-scoped, idempotentes e atômicos.
  Mudanças financeiras publicadas usam reversal/correction ou cancelamento
  explícito; não há overwrite silencioso de valor, cartão, data ou quantidade
  de parcelas.

## Ordem de execução

### Onda 0 — Contrato e gate

1. [T01 — Contrato do slice e gate de dependências](001-contrato-e-gate-dependencias_task.md)

T01 é serial e deve fechar a semântica de datas, estados, entries,
idempotência, pagamento e cancelamento antes de migrations ou use cases.

### Onda 1 — Fundações paralelas

2. [T02 — Schema, migrations e integridade](002-schema-cartoes-compras-parcelas_task.md)
3. [T03 — Datas, ciclos de cobrança e regras versionadas](003-regras-datas-ciclo-fatura_task.md)
4. [T04 — Money, divisão exata e agregado de parcelas](004-money-e-geracao-parcelas_task.md)

T02–T04 podem avançar depois de T01. T04 usa o resolver de datas de T03 para
fechar o schedule e, por isso, sua implementação final depende de T03.

### Trilhas transversais iniciadas após T01

5. [T10 — Observabilidade segura](010-observabilidade-segura_task.md)
6. [T11 — Contratos de UI e componentes compartilhados](011-contratos-ui-componentes_task.md)

T10 e T11 não são gates seriais: podem avançar em paralelo a T02–T09,
consumindo apenas decisões de T01. T10 deve ser integrado nos use cases e T11
deve estar estável antes das telas T12–T14.

### Onda 2 — Backend vertical

7. [T05 — CRUD de cartão e configuração de billing](005-crud-cartao-backend_task.md)
8. [T06 — Criação de compra à vista e parcelada](006-compra-cartao-backend_task.md)
9. [T07 — Projections de fatura, obrigação e limite](007-reads-fatura-comprometimento_task.md)
10. [T08 — Pagamento de cartão como transferência](008-pagamento-cartao_task.md)
11. [T09 — Edição e cancelamento seguro da compra](009-edicao-cancelamento-compra_task.md)

T05 depende de T02/T03. T06 depende de T02–T05 e do ledger de S03. T07
depende do modelo e das escritas de compra; T08 pode avançar em paralelo a
T06/T07 depois de T05; T09 depende da forma de persistência de T06. T10 deve
ser integrado em todas as tasks desta onda, não deixado apenas para o release.

### Onda 3 — Experiência completa

12. [T12 — UI de cadastro e manutenção de cartões](012-ui-cartoes_task.md)
13. [T13 — UI de compra e visualização do parcelamento](013-ui-compra-parcelada_task.md)
14. [T14 — UI de faturas, comprometimento e pagamento](014-ui-faturas-pagamento_task.md)

T12 depende de T05/T11; T13 depende de T06/T11 e pode avançar em paralelo a
T12; T14 depende de T07–T09/T11. As três telas devem usar os mesmos contratos
serializáveis e estados de erro.

### Onda 4 — Qualidade e fechamento

15. [T15 — Testes unitários e integração PostgreSQL](015-testes-unitarios-integracao_task.md)
16. [T16 — Testes E2E do fluxo crítico](016-testes-e2e_task.md)
17. [T17 — Validação de release](017-validacao-release_task.md)

T15 pode ser escrito incrementalmente desde T03/T04, mas só fecha após o
backend estar integrado. T16 é posterior às telas. T17 é o gate serial de
release e depende de T10, T15 e T16.

## Matriz de dependências e paralelização

| ID | Task | Onda | Dependências | Paralelização principal |
|---|---|---|---|---|
| T01 | Contrato e gate | 0 | S01–S03 | Serial; desbloqueia o slice |
| T02 | Schema e migrations | 1 | T01 | Com T03/T04; aplicação serial |
| T03 | Datas e billing cycle | 1 | T01 | Com T02/T04 |
| T04 | Money e parcelas | 1 | T01/T03 | Com o schema; testes puros em paralelo |
| T05 | CRUD de cartão | 2 | T02/T03 | Com T10/T11; depois das fundações |
| T06 | Compra | 2 | T02–T05, S03 | Preparação com T07–T09; escrita final depende do agregado |
| T07 | Faturas e obrigação | 2 | T02–T06 | Com T08/T09 após contratos de compra |
| T08 | Pagamento | 2 | T02/T05, S03 | Com T06/T07/T09 |
| T09 | Edição/cancelamento | 2 | T04/T06 | Com T07/T08 |
| T10 | Observabilidade | transversal | T01 | Com todas as tasks de backend; integração contínua |
| T11 | Contratos/componentes UI | transversal | T01 | Com T02–T10 |
| T12 | UI de cartões | 3 | T05/T11 | Com T13 |
| T13 | UI de compra | 3 | T06/T11 | Com T12; antes de T14 |
| T14 | UI de faturas/pagamento | 3 | T07–T09/T11 | Após reads e writes; acabamento paralelo possível |
| T15 | Unitários/integração | 4 | T02–T10 | Incremental; gate antes do E2E |
| T16 | E2E | 4 | T12–T15 | Serial em relação ao contrato final de telas |
| T17 | Release | 4 | T10/T15/T16 | Fechamento serial |

## Caminho crítico

`T01 → (T02 + T03 + T10 + T11) → T04 → T05 → T06 → T07 → (T08 + T09) → (T13 + T14) → T15 → T16 → T17`

T10 e T11 reduzem risco em paralelo. T12 e T13 podem ser desenvolvidas
simultaneamente quando os contratos de backend estiverem estáveis; T14 só
fecha depois que o estado de pagamento e o cálculo de comprometimento forem
definidos por T07/T08.

## Definition of Done do slice

- [ ] Cartão ativo pode ser cadastrado como conta `CREDIT_CARD` com limite,
  conta padrão de pagamento quando aplicável e regra de fechamento/vencimento.
- [ ] Regras de billing são versionadas; alterar a regra não reinterpreta
  compras antigas.
- [ ] Compra à vista entra na competência correta e não cria uma despesa
  adicional no pagamento da fatura.
- [ ] Compra parcelada cria exatamente N parcelas vinculadas à compra, com
  `SUM(parcelas) = valor total` e remainder determinístico.
- [ ] Datas antes/depois do fechamento, virada de mês/ano, dias inexistentes e
  override permitido têm resultado determinístico e testado.
- [ ] Fatura atual, próxima, futuras, obrigação contratual, limite disponível
  e saldo credor são conceitos distintos e não fazem dupla contagem.
- [ ] Pagamento é transferência global do cartão; overpayment gera crédito e
  não existe ação de pagar parcela individual.
- [ ] Edição/cancelamento preserva o evento original, cancela o schedule
  correspondente, não deixa parcela órfã e usa efeitos compensatórios quando
  necessário.
- [ ] Commands, leituras e actions respeitam `household_id`, conta ativa,
  FKs compostas, UUIDv7 e idempotência; nenhum dado cru aparece em logs/Sentry.
- [ ] UI cobre cadastro, compra, schedule, fatura, comprometimento,
  pagamento, estados vazios/erro/loading e ações seguras; refunds esperados
  ficam explicitamente aguardando o slice de estornos.
- [ ] Testes unitários, PostgreSQL e E2E cobrem precisão, datas, rollback,
  concorrência, isolamento, idempotência e o fluxo crítico.
- [ ] Lint, typecheck, build, migrations controladas, smoke publicado e
  revisão de observabilidade são registrados no fechamento de release.

## Auditoria administrativa T01–T15 — 2026-08-31

O inventário abaixo reconcilia os status dos checklists individuais com as
evidências persistidas. “Concluída tecnicamente” não antecipa os gates de E2E
ou release; T16 e T17 não foram alteradas nesta auditoria.

| Task | Estado auditado | Evidência principal / lacuna registrada |
|---|---|---|
| T01 | Concluída | Contrato do slice e gate ADR-007 fechados e verificados. |
| T02 | Concluída | T02-G e probes PostgreSQL; 5 testes de schema/integridade aprovados. |
| T03 | Concluída | Resolver de ciclos, vigência e overrides; matriz unitária aprovada. |
| T04 | Concluída | Aggregate/schedule determinísticos; matriz de `bigint` aprovada. |
| T05 | Concluída tecnicamente | CRUD, integração PostgreSQL de 2 cenários e ações tenant-safe. |
| T06 | Concluída tecnicamente | Compra/schedule, 4 testes PostgreSQL e build atual verde. |
| T07 | Concluída tecnicamente | Readers/projections, 4 testes PostgreSQL e build atual verde. |
| T08 | Concluída tecnicamente | Pagamento global, 1 integração PostgreSQL e projeções verificadas. |
| T09 | Concluída tecnicamente | Metadata/cancelamento, testes de boundary e evidência de persistência; integração fica condicionada ao guard no agregado atual. |
| T10 | Concluída tecnicamente | Redaction/classificação/wrapper e suíte de observabilidade; publicação/revisão ficam no release. |
| T11 | Concluída | Contratos/componentes e suíte atual de 9 arquivos/29 testes aprovados. |
| T12 | Parcial tecnicamente concluída | Rotas/componentes e toolchain verdes; sem prova E2E autenticada de criar cartão e vê-lo no seletor (T16). |
| T13 | Parcial tecnicamente concluída | Compra/schedule e estados cobertos; prova E2E do fluxo crítico permanece em T16. |
| T14 | Concluída tecnicamente | Fatura/pagamento/detalhe, ações seguras e testes/build verdes; regressão E2E permanece em T16. |
| T15 | Parcial | Unitários e integrações S06 habilitadas aprovados; execução agregada registra 1 falha externa em T07 e 6 testes T09 skipped por guard. |

Requisitos sem prova neste corte: fluxo E2E autenticado de T12, regressão E2E
compra → fatura → pagamento → cancelamento de T14/T13 e smoke publicado/revisão
de observabilidade de T17. A execução agregada de integração também não está
limpa enquanto persistirem a falha externa de T07 e o guard que pula T09.

## Handoff para S07 e slices posteriores

T07 deve expor contratos estáveis para S07: itens de fatura/compromisso com
`referenceId`, data/ciclo, valor, estado projetado/confirmado e origem da
compra, sem obrigar S07 a conhecer tabelas internas. S07 poderá consolidar
parcelas futuras exatamente uma vez. T09 deve deixar explícito quais efeitos
futuros desaparecem após cancelamento. O modelo de refund parcial,
`Expected Refund`, correction genérica e cancelamento parcial de parcelas fica
para o slice de estornos/correções, não deve ser inventado em S06.
