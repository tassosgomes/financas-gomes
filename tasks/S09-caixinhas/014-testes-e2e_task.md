# T14 — Testes E2E do fluxo crítico

- Status: Concluída — fluxo E2E, regressões focadas, lint e typecheck global
  aprovados; a matriz E2E ampla mantém regressões de slices anteriores
  registradas em T15
- Onda: 4
- Dependências: T11, T12 e T13
- Paralelização: Serial após a experiência integrada

## Objetivo

Validar no browser a jornada que o usuário entende: criar Caixinha, reservar,
retirar/transferir, acompanhar progresso e observar a disponibilidade mudar.

## Escopo

- Autenticar um household sintético, criar uma Caixinha pela UI, fazer aportes
  múltiplos e confirmar saldo acumulado/rollover.
- Executar retirada e transferência entre Caixinhas; conferir histórico,
  saldo negativo quando permitido e ausência de despesa bancária duplicada.
- Criar meta/data-alvo quando o contrato habilitar, validar progresso e aporte
  sugerido, e encerrar a Caixinha preservando histórico.
- Abrir a visão de Spendable após aporte/retirada e validar proteção/liberação
  uma única vez, cenário de zero, saldo negativo e encerramento.
- Cobrir configuração de distribuição/receita realizada e compra parcelada
  somente quando essas fontes estiverem disponíveis no fluxo do slice.
- Cobrir loading, empty state, erro opaco, provider indisponível, navegação por
  teclado e responsividade de consulta simples.
- Criar dois households com dados distintos e comprovar que URL, IDs ou forms
  forjados não revelam dados do outro.

## Subtarefas

- [x] Preparar fixtures/autenticação determinística por provider Google E2E,
  sem inserir dados financeiros reais ou usar acesso administrativo como
  substituto da jornada.
- [x] Implementar spec criação → aporte → saldo/progresso → retirada →
  transferência → impacto Spendable → encerramento.
- [x] Validar estados negativos/encerrados, histórico e não dupla contagem.
- [x] Validar isolamento A/B e referências/origens autorizadas.
- [x] Executar a spec isolada e a regressão E2E relevante do repositório.

## Critérios de aceite

- [x] O fluxo crítico passa em browser usando as páginas/actions reais.
- [x] O valor protegido e a disponibilidade apresentada mudam de acordo com o
  provider, sem renderizar cálculo falso no client.
- [x] Encerramento não apaga histórico e movimentação inválida apresenta erro
  compreensível sem alterar o estado.
- [x] Nenhum valor, referência ou origem do household B aparece no browser do
  household A.

## Entregáveis e evidência esperada

- [x] `tests/e2e/budgets.spec.ts`/equivalente com cenários nomeados.
- [x] Evidência de execução Playwright, incluindo flags/porta/banco usados.
- [x] Lint/typecheck e análise de flakiness/cleanup de dados.

## Evidência T14

- Fixture/auth: `tests/fixtures/s09-caixinhas/e2e-fixtures.ts` usa somente
  identidades `e2e-*@example.test`, nomes únicos por execução e limpeza
  transacional limitada aos households desses e-mails. A jornada não faz seed
  nem usa contexto administrativo; a limpeza desabilita o guard append-only
  somente durante o teardown isolado e o reabilita antes do commit.
- Spec focada aprovada em 2026-09-02, com uma execução serial e três cenários:
  `3 passed (1.8m)`.
- Comando executado:
  `rtk env PLAYWRIGHT_REUSE_SERVER=true E2E_PORT=3214 E2E_NEXT_DIST_DIR=.next-e2e-s09 E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run test:e2e -- tests/e2e/budgets.spec.ts --reporter=line`.
- Regressões focadas aprovadas com a mesma porta/banco: `authentication.spec.ts`
  (`1 passed`) e cenário positivo de `spendable.spec.ts` (`1 passed`).
- Lint T14 aprovado:
  `rtk npm exec eslint -- tests/e2e/budgets.spec.ts tests/fixtures/s09-caixinhas/e2e-fixtures.ts --max-warnings=0`.
- `rtk npm run typecheck` passou em 2026-09-03 (exit 0), após correções
  somente de tipagem nos testes `account-form.test.tsx` e
  `forecast-money-fields.test.tsx`; nenhuma lógica financeira ou arquivo de
  produção foi alterado. A limpeza isolada de fixtures está documentada acima.

## Fora de escopo

Aplicativo nativo, offline, integração bancária real e testes de APIs externas
que não fazem parte da V1.
