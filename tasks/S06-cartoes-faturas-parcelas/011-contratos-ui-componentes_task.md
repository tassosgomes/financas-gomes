# T11 — Contratos de UI e componentes compartilhados

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída — contracts, schedule, read-model components e feedback
  compartilhado verificados em 2026-08-31; integração final nas telas T12–T14
  é o handoff previsto e não altera esta boundary.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02–T10; desbloqueia T12–T14

## Objetivo

Preparar boundaries de formulário, actions e read models para as telas de S06
sem transferir cálculo monetário, autorização ou competência de fatura para o
browser.

## Escopo

- Definir contracts serializáveis/Zod para criar/editar/arquivar cartão,
  alterar regra de billing, criar compra, pagar cartão e cancelar compra.
- Reutilizar `MoneyInput` e `DateInput` de S03; limites, campos obrigatórios,
  mensagens e representação de centavos devem ser consistentes.
- Criar componentes/contratos para dia do mês, seletor de conta/cartão,
  quantidade de parcelas, resumo do schedule, fatura, obrigação,
  comprometimento, crédito e estados de pagamento.
- Definir view models para carregamento, vazio, erro esperado, conflito,
  sucesso, retry e confirmação explícita; IDs e datas devem ser tratados como
  dados serializáveis, não objetos de domínio.
- Definir rotas/links canônicos e filtros de período sem colocar valor,
  descrição, token ou payload financeiro na URL.
- Garantir acessibilidade: labels, mensagens associadas, teclado, foco após
  submit/erro, tabelas legíveis e alternativa textual para indicadores.
- Manter Server Components como padrão e Client Components pequenos apenas
  para formulário, confirmação e estado local.

## Critérios de aceite

- [x] Zod rejeita zero/negativo, float, datas malformadas, dia inválido,
  quantidade fora do limite e IDs que não têm formato aceito.
- [x] O command enviado pelo client não contém household, status, origem,
  sinais, valores calculados de parcela ou autorização; os cinco comandos de
  manutenção também têm teste conjunto de serialização.
- [x] O preview/schedule exibido usa dados calculados pelo servidor; o client
  não recalcula total, fatura ou limite como fonte de verdade.
- [x] Componentes distinguem fatura atual, futuras, obrigação e saldo credor;
  `CreditCardStatementSummary`, `CreditCardProjectionSummary` e
  `CreditCardPaymentStatus` não usam a label ambígua “saldo do cartão”.
- [x] Erros esperados têm campo/mensagem acionável e não exibem stack/SQL;
  `CreditCardFieldError` e `CreditCardActionFeedback` usam somente o mapa
  allow-listed.
- [x] Contratos e componentes têm testes de acessibilidade/serialização
  compatíveis com T12–T14, incluindo tabelas, labels, regiões live, foco,
  confirmação explícita e bloqueio síncrono de double-submit.

## Subtarefas

- [x] **T11-A — Commands de entrada:** criar schemas Zod serializáveis para
  criação de cartão, compra e pagamento, com adaptação formulário → command,
  validação de centavos/datas/IDs e rejeição de campos de autoridade.
- [x] **T11-B — Contratos transversais e schedule:** adicionar schemas e
  adapters de edição/arquivamento/billing/cancelamento, view models
  serializáveis, erros allow-listed, filtros/rotas canônicos e o componente
  compartilhado de resumo do schedule com estados loading/vazio/erro/sucesso.
- [x] **Validação focada entregue:** testes estáticos cobrem JSON seguro,
  tabela acessível, estados e ausência de SQL/stack na mensagem apresentada.
- [x] **Inputs e seletores reutilizáveis:** criar dia do mês, quantidade de
  parcelas e seletor de conta/cartão. As primitives de dia/parcelas e os
  seletores de cartão/conta foram criados.
- [x] **Integração com os campos S03:** disponibilizados
  `CreditCardMoneyField`/`CreditCardDateField`, wrappers acessíveis que
  reutilizam `MoneyInput`/`DateInput` e preservam centavos/datas
  serializáveis. A composição nas telas T12–T14 continua sendo o handoff
  dessas tasks.
- [x] **Read-model components:** criados `CreditCardStatementSummary` (atual
  e futura), `CreditCardProjectionSummary` (fatura, obrigação, limite e
  crédito) e `CreditCardPaymentStatus`, todos server-data-only.
- [x] **Boundary de feedback e acessibilidade completa:** criados
  `CreditCardFieldError`, `CreditCardActionFeedback`,
  `CreditCardConfirmation` e `useCreditCardSubmitGuard`, com foco em região
  de erro/sucesso, confirmação explícita e guarda síncrona contra
  double-submit.

## Handoff

- T12 consome contracts de cadastro/manutenção.
- T13 consome o formulário de compra e o schedule retornado por T06.
- T14 consome projections T07, pagamento T08 e ações T09.

## Verificações

- [x] Testes focados de schema/view models/schedule:
  `rtk npx vitest run src/components/credit-cards/ui-contracts.test.ts
  src/components/credit-cards/schedule-summary.test.tsx --reporter=dot` — 6
  testes aprovados em 2026-08-30.
- [x] Revisão manual dos payloads criados pelos adapters: somente IDs,
  centavos, datas e campos de formulário; nenhum tenant/status/origin/sinal,
  `statementId` ou `installmentId`.
- [x] Testes estáticos de acessibilidade das primitives de input/selector,
  incluindo label, `aria-describedby`, `role=alert`, limites e `autofocus`
  quando há erro — 3 testes adicionados em `inputs-selectors.test.tsx`.
- [x] Testes de `MoneyInput`/`DateInput`, view models de fatura/pagamento e
  foco/feedback: `feedback.test.tsx` e `read-models.test.tsx` cobrem labels,
  descrições, `aria-describedby`, live regions, estado global de pagamento,
  loading/empty/error e remoção de SQL/stack.
- [x] Testes focados de inputs/selectors e regressão do schedule:
  `rtk npx vitest run src/components/credit-cards/inputs-selectors.test.tsx
  src/components/credit-cards/ui-contracts.test.ts
  src/components/credit-cards/schedule-summary.test.tsx --reporter=dot` — 9
  testes aprovados em 2026-08-30.
- [x] `rtk npm run typecheck` — passou em 2026-08-31; os arquivos de T11 não
  geram warnings de lint. O lint global permanece gate do release.

## Checkpoint / lacunas verificáveis

Data: 2026-08-31.

- Os critérios 1 e 3 continuam comprovados pelos schemas, pelo componente
  `CreditCardScheduleSummary` e pelos testes focados.
- O critério 2 agora tem teste conjunto para create/update/archive/billing/
  purchase-update/purchase-cancel/payment; somente campos do command entram
  no JSON.
- Os critérios 4–6 estão comprovados por `read-models.tsx`, `feedback.tsx`,
  `form-fields.tsx` e 29 testes atuais da pasta de componentes (incluindo os
  4 testes de T14-E); os testes históricos de checkpoints permanecem
  identificados por sua data.
- A composição desses componentes em rotas/forms reais é deliberadamente
  handoff para T12–T14; esta atualização não cria telas nem actions.
- T11 permanece marcada como concluída: não restam subtarefas de contracts ou
  componentes compartilhados abertas nesta task; a prova E2E das telas é
  responsabilidade de T16.

## Fora de escopo

Estado global, fetch geral no browser, cálculo financeiro client-side,
aplicativo nativo e redesign não necessário ao fluxo de S06.
