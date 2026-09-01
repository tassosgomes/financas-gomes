# T13 — UI de compra e visualização do parcelamento

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Parcial tecnicamente concluída — formulário de compra e projeção do
  schedule implementados, adapter server-safe compartilhado, typecheck/lint/build
  atuais verdes; integração E2E permanece no T16.
- Onda: 3
- Dependências: T04, T06 e T11; T12 fornece o seletor reutilizável
- Paralelização: Com T12; resultado pode ser integrado antes de T14

## Objetivo

Permitir registrar uma compra à vista ou parcelada com poucos campos e tornar
visível o compromisso criado antes/depois da confirmação.

## Escopo

- Criar formulário de compra com cartão, valor total, data, descrição,
  categoria de despesa opcional e quantidade de parcelas.
- Usar `MoneyInput`/`DateInput`, deixar claro que o valor informado é o total
  da compra e mostrar a quantidade/valores das parcelas retornados pelo
  servidor; não aceitar valor de cada parcela como fonte de verdade.
- Oferecer prévia do schedule quando o contrato T06 permitir, sem persistir
  nada antes da confirmação e sem recalcular rounding/ciclo no client.
- Confirmar uma única vez, enviar somente command serializável e preservar o
  mesmo `commandId` em retry seguro conforme T06.
- Após sucesso, navegar ao detalhe da compra/cartão/fatura com IDs opacos;
  informar total econômico, parcelas, competências e estado projetado/
  confirmado.
- Exibir erros para cartão arquivado, data futura, categoria incompatível,
  valor/quantidade inválidos, conflito e falha recuperável.
- Não mostrar nem habilitar ação de pagar, cancelar ou editar parcela
  individual.

## Critérios de aceite

- [x] Compra 1x e N>1 possuem fluxo compreensível e não criam escrita durante
  a prévia/revisão do formulário.
- [x] A UI mostra exatamente N parcelas e a soma exibida coincide com o total
  fornecido pelo servidor, inclusive rounding; `purchaseScheduleViewModel`
  apenas copia o read model T06.
- [x] O usuário entende em quais competências/faturas os valores cairão; a
  tela não chama o total de N parcelas de “fatura atual”.
- [x] Double submit é bloqueado por `useCreditCardSubmitGuard` e a falha
  preserva o mesmo `commandId` enquanto o payload não muda.
- [x] Erros não exibem SQL, stack, payload, tenant ou dados de outro household;
  actions T06 resolvem o contexto e feedback usa allow-list T11.
- [x] Componentes têm estados loading, vazio (sem cartão ativo), erro, sucesso,
  foco em feedback e controles acessíveis; não há ação de parcela isolada.

## Handoff

- T14 liga o resultado ao detalhe, à fatura e às ações permitidas de edição/
  cancelamento.
- T16 executa criar compra à vista e parcelada exclusivamente pela UI.
- T17 valida que o fluxo publicado não depende de script administrativo.

## Verificações

- [x] Rotas `/credit-cards/purchases/new` e
  `/credit-cards/[id]/purchases/new` carregam cartões/categorias por Server
  Actions tenant-scoped; `CreditCardPurchaseScreen` usa somente o command T11
  e a action de criação T06.
- [x] `src/components/credit-cards/purchase-screen.test.tsx` cobre adapter de
  schedule retornado (3 parcelas, rounding 3.334 + 3.333 + 3.333 = 10.000),
  total econômico, campos 1x/N, cartão ativo e ausência de ações de parcela.
- [x] `src/components/credit-cards/purchase-schedule-view-model.ts` mantém o
  adapter sem `"use client"`; a tela cliente e a rota Server Component de
  detalhe reutilizam a mesma função sem recalcular o schedule.
- [x] `rtk npm test -- --run src/components/credit-cards --reporter=dot` — 9
  arquivos e 29 testes passaram na auditoria de 2026-08-31; os 2 testes de
  `purchase-screen` permanecem a cobertura específica de T13.
- [x] ESLint focado em `purchase-screen.tsx`, teste, rotas e contratos passou
  em 2026-08-31.
- [x] `rtk npm run typecheck` — execução atual sem diagnósticos após a
  correção do use case T06/T09 e a integração T14.
- [x] `rtk npm run build` — compilação do bundle e das rotas T13 passou em
  2026-08-31; o bloqueio histórico de tipos não se reproduz.

## Fora de escopo

Importação automática, compra recorrente, edição de valor/data/cartão já
publicados, pagamento de parcela e parcelamento da própria fatura.
