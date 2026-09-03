# T12 — UI de movimentos, progresso e impacto

- Status: Concluída — detalhe, movimentos, histórico, progresso e impacto autorizado `s09.v1` integrados; a suíte T12 usa relógio determinístico para a data civil dos movimentos e a fórmula permanece no provider S08. O typecheck global passou em 2026-09-03 após correções localizadas somente em testes externos.
- Onda: 3
- Dependências: T07, T08 e T10
- Paralelização: Com T11 e T13

## Objetivo

Permitir que o usuário aporte, retire ou transfira recursos e entenda o saldo,
progresso e impacto resultantes, sem esconder a explicação do cálculo.

## Escopo

- Adicionar ações/forms de aporte, retirada e transferência entre Caixinhas,
  com amount em centavos, data efetiva, confirmação e feedback seguro.
- Mostrar histórico paginado de movimentos, origem/correção quando disponível,
  saldo acumulado, aporte/gasto do período, rollover, alvo, faltante e aporte
  sugerido.
- Diferenciar saldo negativo, saldo protegido, provider indisponível,
  Caixinha encerrada e ausência de movimentações; não transformar retirada em
  gasto bancário nem aporte em receita.
- Mostrar acesso ao impacto no “Quanto posso gastar” usando o read model/rota
  autorizada do S08; não repetir a fórmula no client.
- Atualizar/revalidar a visão principal após movimento e preservar estado de
  foco/teclado. Tratar tentativa de movimentar Caixinha encerrada conforme o
  contrato de lifecycle.
- Cobrir responsividade para operações simples no mobile web.

## Subtarefas

- [x] Criar componentes de movimento, formulário de amount/data e transferência
  com validação client/server.
- [x] Integrar Server Actions de T07 e estados de pending/sucesso/erro.
- [x] Implementar visualização de progresso e reconciliação do saldo com o
  histórico, usando somente DTOs do servidor.
- [x] Integrar link/card de impacto no Spendable e testar retorno à origem sem
  ampliar o household.
- [x] Cobrir teclado, leitor de tela, listas vazias, paginação/truncamento,
  saldo negativo e encerramento.

Evidência das subtarefas: `src/components/budgets/budget-movement-form.tsx`
usa `MoneyInput` textual, `DateInput`, RHF + Zod e confirmação acessível, sem
`householdId`, saldo ou referências de origem no payload. `BudgetDetailScreen`
chama as actions autenticadas de T07 para aporte, retirada e transferência,
gera os identificadores opacos no limite da ação, trata pending/sucesso/erro e
faz nova leitura do detalhe após sucesso. O detalhe renderiza apenas saldo,
período, rollover, progresso e movimentos fornecidos pelos DTOs do servidor;
paginação usa o cursor do read model. Os estados negativo, encerrado, vazio,
linhagem de correção/transferência, foco do diálogo, Escape e feedback seguro
são cobertos por `budget-detail-screen.test.tsx` e
`budget-movement-form.test.tsx`. O item de impacto é composto server-side pela
action autenticada de S08 e entregue ao detalhe como DTO; a tela renderiza os
valores e estados do provider sem recalcular a fórmula. O link para a
composição usa uma rota canônica com `returnTo` do detalhe, e a rota Spendable
só aceita retorno same-origin para `/budgets/:referenceId` (ou `/app`). Esses
fluxos são cobertos pelos testes de detalhe e da rota Spendable.

Para evitar flakiness por passagem do dia, `budget-detail-screen.test.tsx`
fixa o relógio em `2026-09-02` somente durante cada teste (`toFake: ["Date"]`)
e restaura os timers reais no teardown. Assim, os payloads de data efetiva
continuam determinísticos sem alterar a implementação de produção.

## Critérios de aceite

- [x] Aporte e retirada feitos pela UI alteram o saldo uma única vez e a
  disponibilidade exibida respeita o provider integrado.
- [x] Transferência altera as duas Caixinhas atomicamente e não aparece como
  receita/despesa ou pagamento de cartão.
- [x] A UI explica saldo negativo/encerrado sem sugerir proteção positiva e
  mantém histórico acessível.
- [x] Formulários não aceitam `householdId`, saldo ou referência de origem como
  autoridade do browser.

Evidência dos critérios: o teste de detalhe verifica que aporte chama uma
única action com valor/data e reconsulta o detalhe; o teste de transferência
verifica origem/destino, valor/data e as referências do par enviados uma única
vez à action atômica de T07. O texto da UI explicita que aporte/retirada não
são receita/despesa bancária ou pagamento de cartão. O saldo negativo mostra
proteção zerada, o encerramento impede novos movimentos e mantém a lista
histórica. Testes de formulário e `page.test.tsx` verificam a ausência de
autoridade de tenancy/saldo/referência de origem. O teste de detalhe inicia
com o impacto fornecido pelo S08 e, após um aporte confirmado, verifica a
releitura única do Spendable e a atualização do valor exibido; a página
server-first passa o resultado da action autenticada e a rota de composição
mantém apenas o retorno interno autorizado.

## Entregáveis e evidência esperada

- [x] Componentes e páginas de detalhe/movimentos em `src/app/budgets` e
  `src/components/budgets`.
- [x] Testes de interação, formulário, acessibilidade e revalidação.
- [x] Evidência de integração com a rota/read model de Spendable.

Evidência dos entregáveis: a rota server-first
`src/app/budgets/[referenceId]/page.tsx` reduz destinos de transferência a
referência/nome, consulta `getSpendableAction({ asOf })` no servidor e entrega
o read model ao `BudgetDetailScreen`; `loading.tsx`, `ErrorState`, o histórico
e o formulário compõem a jornada. O card de impacto usa somente os
valores/estado `s09.v1` fornecidos pelo provider e o componente não contém
fórmula monetária. Após sucesso de aporte, retirada ou transferência, a UI
relê detalhe e Spendable. O link para
`/spendable/breakdown?returnTo=...` é autorizado pelo servidor e a rota
Spendable rejeita destinos externos, preservando o household resolvido nas
actions.

Evidência dos gates executados:

- [x] `rtk npm exec vitest -- run src/components/budgets src/app/budgets src/app/spendable/breakdown src/modules/budgets/reads.test.ts src/modules/budgets/movement-actions.test.ts --config vitest.config.mts --reporter=dot` — passou em 2026-09-03 após a fixação do relógio: 11 arquivos, 61 testes.
- [x] `rtk npm exec eslint -- src/app/budgets src/app/spendable/breakdown/page.tsx src/app/spendable/breakdown/page.test.tsx src/app/actions/spendable.ts src/components/budgets src/modules/budgets/ui-contracts.ts --max-warnings=0` — passou sem erros/warnings.
- [x] `rtk git diff --check` — passou.
- [x] `rtk npm run typecheck` global — passou em 2026-09-03 (exit 0) após
  correções localizadas somente nos testes externos; nenhum erro foi reportado
  nos arquivos de T12.

## Fora de escopo

Transferência bancária automática, conta financeira separada, investimento,
rendimento e edição destrutiva de histórico.
