# T14 — UI de faturas, comprometimento e pagamento

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — projections/pagamento global e detalhe/edição/
  cancelamento agregado da compra foram implementados e verificados em
  2026-08-31; smoke E2E permanece como validação downstream de T16/T17.
- Onda: 3
- Dependências: T07, T08, T09, T11, T12 e T13
- Paralelização: Acabamento pode ocorrer com T12/T13; fechamento depende dos reads e writes

## Objetivo

Dar ao usuário uma visão explicável da fatura atual, das faturas futuras e do
pagamento global do cartão, incluindo as ações seguras de manutenção da compra.

## Escopo

- No detalhe `/credit-cards/[id]`, exibir fatura atual, próxima e consulta por
  competência futura; separar projetado de confirmado e permitir abrir a
  compra/parcelas de origem.
- Mostrar totais de fatura, parcelas futuras, obrigação contratual,
  comprometimento/limite disponível, posição corrente e saldo credor como
  blocos distintos, com data de referência.
- Exibir itens uma única vez, sequência da parcela, ciclo, vencimento e
  estado; compras canceladas saem do compromisso ativo e permanecem no
  histórico quando apropriado.
- Implementar formulário de pagamento global com cartão, conta de origem,
  valor/data e confirmação; não pedir nem enviar statement/installment ID.
- Mostrar estado de pagamento parcial/total/overpayment conforme T07/T08 e
  explicar que o pagamento não quita uma parcela individual.
- Integrar detalhe da compra/transação: descrição/categoria editáveis apenas
  onde permitido e cancelamento da compra inteira com confirmação forte,
  aviso sobre efeitos futuros e feedback idempotente.
- Não renderizar ações ou estados de refund/`Expected Refund` como se fizessem
  parte do S06; deixar o ponto de extensão para o slice de estornos/correções.
- Preservar período/filtros em URL apenas com IDs, datas e parâmetros seguros;
  controlar loading, erro, empty state, retry e acessibilidade.

## Critérios de aceite

- [x] Usuário recebe links canônicos para a compra originadora, acessa a rota
  tenant-safe de detalhe e entende cada comprometimento futuro no schedule.
- [x] A mesma compra/parcela não aparece duplicada por ser entry e installment;
  a tela consome os itens canônicos do read model T07.
- [x] O pagamento atualiza o estado derivado e o saldo credor, sem criar uma
  despesa ou mudar a Caixinha.
- [x] Não existe botão, rota ou formulário de “pagar parcela”.
- [x] Cancelamento exige confirmação, remove o futuro conforme o contrato e
  não oferece hard delete; a tela chama o action agregado T09 e preserva o
  histórico.
- [x] Erros de sessão, cartão arquivado, conflito, expiração e cross-tenant
  são seguros e acionáveis.
- [x] A consulta futura atravessa mês/ano e é responsiva o bastante para
  consulta ocasional em celular.

## Subtarefas e status desta janela

- [x] T14-A — compor o detalhe `/credit-cards/[id]` com
  `getCreditCardProjectionAction`, adaptador server→T11 sem `householdId` e
  blocos distintos de fatura, obrigação, comprometimento, limite e crédito.
- [x] T14-B — adicionar `CreditCardGlobalPaymentForm` usando
  `registerCreditCardPaymentAction`, conta ativa não-cartão e command global
  sem `statementId`/`installmentId`; sucesso faz `router.refresh()`.
- [x] T14-C — cobrir loading, empty, error, retry, arquivado, feedback e
  acessibilidade em `billing-screen.test.tsx` (3 testes aprovados).
- [x] T14-D — testar consulta segura por competência com links `cycle` e
  atualizar a rota autenticada para receber `searchParams`; sem valores ou
  payload financeiro na URL.
- [x] T14-F — gate técnico pós-handoff: `billing-screen.tsx` usa `useRouter`
  importado de `next/navigation` (em vez de `React.useRouter`), removendo o
  diagnóstico de typecheck reportado sem alterar recursos de UI.
- [x] T14-E — `GetCreditCardPurchaseQuery`, parser estrito, reader T09 com
  predicado de household, observabilidade `credit_card.purchase.read`,
  `getCreditCardPurchaseAction`, rota
  `src/app/credit-cards/[id]/purchases/[purchaseId]/page.tsx`, loading e
  `purchase-detail-screen.tsx`. A UI edita somente descrição/categoria,
  confirma cancelamento do aggregate, expõe feedback/retry/loading/empty/error
  acessíveis e não oferece ação por parcela.
- [x] T14-E boundary — a rota de detalhe importa `purchaseScheduleViewModel` de
  `purchase-schedule-view-model.ts`, módulo server-safe sem `"use client"`; a
  importação anterior de `purchase-screen.tsx` foi removida.

## Handoff

- T15 verifica os view models e os cálculos exibidos contra PostgreSQL.
- T16 cobre compra → fatura → pagamento → cancelamento na UI.
- T17 faz smoke publicado e revisão manual do Definition of Done.

## Verificações

- Testes de componentes para fatura vazia, atual/futura, rounding, parcial,
  pago, crédito, cancelamento e ausência de ação individual.
- Teste de acessibilidade/navegação e build da rota autenticada.
- Conferência visual dos rótulos para não misturar fatura, obrigação e limite.

### Evidência da implementação — 2026-08-31

- [x] Os componentes compartilhados de T11 já disponíveis em
  `src/components/credit-cards/read-models.tsx` cobrem fatura atual/futura,
  projeções distintas, estado global de pagamento e estados loading/empty/error;
  os testes de boundary existentes estão registrados em
  `src/components/credit-cards/read-models.test.tsx`.
- [x] `src/components/credit-cards/billing-screen.tsx` compõe projections T07,
  status global e formulário T08; `src/app/credit-cards/[id]/page.tsx` carrega
  actions server-side, filtra `cycle/from/to` e remove campos de autoridade
  antes da boundary client.
- [x] `rtk npm test -- --run src/components/credit-cards/billing-screen.test.tsx
  --reporter=dot` — 3 testes aprovados: composição/read models, contas
  permitidas e estados arquivado/loading/empty/error com redaction.
- [x] `rtk npm exec -- eslint src/components/credit-cards/billing-screen.tsx
  src/components/credit-cards/billing-screen.test.tsx
  src/app/credit-cards/[id]/page.tsx src/components/credit-cards/index.ts
  --max-warnings=0` — sem erros ou warnings.
- [x] `rtk npx tsc --noEmit --pretty false --incremental false` — sem erros.
- [x] `rtk npm run typecheck` — sem erros após a correção da referência
  `useRouter` em `billing-screen.tsx` (2026-08-31).
- [x] `rtk npm exec eslint -- src/components/credit-cards/billing-screen.tsx
  src/app/actions/credit-cards.ts src/app/actions/credit-card-projections.ts
  --max-warnings=0` — sem erros ou warnings.
- [x] `rtk npm run build` — compilação, verificação de tipos e geração das
  páginas concluídas com sucesso em 2026-08-31; nenhuma falha de Server Action
  reproduzida.
- [x] `rtk npm test -- --run
  src/components/credit-cards/purchase-detail-screen.test.tsx
  src/components/credit-cards/billing-screen.test.tsx
  src/components/credit-cards/ui-contracts.test.ts
  src/components/credit-cards/schedule-summary.test.tsx
  src/modules/credit-cards/purchase-validation.test.ts --reporter=dot` — 5
  arquivos e 17 testes aprovados; a suíte nova T14-E aprovou 4 testes de
  metadata, confirmação do aggregate, estados e ausência de ação por parcela.
- [x] Lint focado de rota/loading, componente/testes, contratos/actions e
  use-case T09 — sem erros ou warnings.
- [x] `rtk npm test -- --run
  src/components/credit-cards/purchase-screen.test.tsx
  src/components/credit-cards/purchase-detail-screen.test.tsx --reporter=dot`
  — 2 arquivos e 6 testes aprovados após a extração do adapter.
- [x] `rtk npm run typecheck` — sem diagnósticos após a rota e componente T14-E.
- [x] `rtk npm run build` — rota dinâmica
  `/credit-cards/[id]/purchases/[purchaseId]` compilada e listada no build,
  com lint/typecheck/geração de páginas concluídos.
- [ ] Regressão E2E do fluxo compra → fatura → pagamento → cancelamento fica
  para T16/T17; não é uma ação por parcela nem bloqueia a conclusão do escopo
  funcional T14-E.

## Fora de escopo

Parcelamento da fatura, juros, negociação com emissor, conciliação automática,
forecast completo de S07 e dashboard de spendable.
