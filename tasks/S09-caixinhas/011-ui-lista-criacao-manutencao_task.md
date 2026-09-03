# T11 — UI de lista, criação e manutenção

- Status: Concluída — fatia vertical de `/budgets` entregue e verificada;
  o typecheck global passou em 2026-09-03 após correções localizadas somente
  nos testes externos ao write set de T11.
- Onda: 3
- Dependências: T06 e T10
- Paralelização: Com T12 e T13

## Objetivo

Entregar a jornada principal de administrar Caixinhas em `/budgets`, com baixa
carga cognitiva e sem regra financeira duplicada no navegador.

## Escopo

- Criar a página server-first `/budgets` com lista de Caixinhas ativas e
  encerradas, saldo acumulado, aporte/gasto do mês, meta/progresso e status.
- Implementar criar/editar e encerrar com formulários RHF + Zod, campos mínimos,
  feedback de sucesso/erro e confirmação para encerramento.
- Exibir categoria/associação e configuração de meta/alocação conforme o
  contrato de T01, sem prometer comportamento fora do escopo V1.
- Consumir actions server-side que resolvem contexto pela sessão, revalidar
  lista/detalhe/dashboard e ignorar seletores de household fornecidos pela URL.
- Tratar loading, empty state, erro opaco, Caixinha sem movimentação, saldo
  negativo e encerrada sem perder acesso ao histórico.
- Garantir layout desktop-first e consulta/cadastro básicos no navegador móvel.

## Subtarefas

- [x] Criar rota, layout/loading/error e page server-side.
- [x] Criar formulário de criação/edição com `MoneyInput`/`DateInput` quando
  meta/data forem usadas, sem `input type=number` como dinheiro principal.
- [x] Implementar ação de encerramento com foco, confirmação e mensagem da
  data efetiva.
- [x] Cobrir revalidação, mensagens de resultado, navegação por teclado e
  isolamento visual de dois households.
- [x] Adicionar testes de componentes e da página sem acessar banco do client.

Evidência das subtarefas: `src/app/budgets/page.tsx` faz a leitura inicial no
servidor, `layout.tsx` mantém a rota autenticada e `loading.tsx`/`error.tsx`
fornecem recuperação opaca. `BudgetForm` usa RHF + Zod, `MoneyInput` e
`DateInput`; `BudgetCollectionScreen` executa create/update/close pelas
Server Actions e alterna ativos/encerrados. `BudgetCloseConfirmation` restaura
foco, exige data efetiva e comunica o corte da proteção. A lista usa o período
corrente enriquecido no read model server-side (`period`), sem somar
movimentos no React; as categorias são reduzidas a id/nome antes de chegar ao
client. Testes de formulário/lista/página e componentes cobrem estados, foco,
teclado, erro opaco, saldo negativo, empty/loading e ausência de autoridade de
tenancy.

## Critérios de aceite

- [x] Usuário cria, edita e encerra uma Caixinha pela interface autenticada.
- [x] A lista mostra saldo/progresso fornecidos pelo servidor e não recalcula
  movimentos ou reserva no React.
- [x] URL, form ou payload forjado com `householdId` não muda o contexto nem
  revela dados de outro espaço.
- [x] Encerramento mantém histórico e apresenta claramente que a proteção
  deixa de valer a partir da data efetiva.

Evidência dos critérios: `budget-list-screen.test.tsx` prova chamadas de
create/update/close, leitura de ativos/encerrados, foco no diálogo e retorno ao
gatilho; `budget-form.test.tsx` prova payload sem tenancy, validação de meta e
MoneyInput textual; `page.test.tsx` prova leitura server-first e remoção de
`householdId` do payload de categoria. O fechamento comunica a data e a
preservação do histórico, enquanto o backend T06 mantém a série append-only.

## Entregáveis e evidência esperada

- [x] `src/app/budgets/*` e actions/entradas correspondentes.
- [x] Componentes de lista, formulário e confirmação.
- [x] Testes focados de página, estados e acessibilidade.
- [x] Evidência de lint, typecheck e `git diff --check`.

Evidência dos entregáveis/gates:

- [x] `rtk npm exec vitest -- run src/components/budgets src/app/budgets src/modules/budgets/reads.test.ts --config vitest.config.mts --reporter=dot` — 6 arquivos, 40 testes passaram.
- [x] `rtk npm exec eslint -- src/app/budgets src/app/actions/budgets.ts src/components/budgets src/components/ui/async-state.tsx src/modules/budgets/read-contracts.ts src/modules/budgets/service.ts src/modules/budgets/reads.test.ts --max-warnings=0` — passou sem erros/warnings.
- [x] `rtk npm exec tsc -- --project tsconfig.t11.json --pretty false` — passou; `tsconfig.t11.json` foi temporário e removido após o gate.
- [x] `rtk git diff --check` e busca de whitespace no write set — passaram.
- [x] `rtk npm run typecheck` global — passou em 2026-09-03 (exit 0) após
  correções localizadas somente nos testes externos; nenhum erro foi reportado
  nos arquivos/entradas incluídos no typecheck focado.

## Handoff

T12 adicionará movimentos e detalhe/progresso usando os mesmos read models e
componentes, sem criar uma segunda rota de saldo.

Handoff T12: esta entrega não adiciona movimentos, transferências, correções,
detalhe paginado ou nova fórmula de saldo; esses fluxos continuam explicitamente
fora de T11.
