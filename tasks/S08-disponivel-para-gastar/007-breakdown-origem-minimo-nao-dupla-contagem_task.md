# T07 — Breakdown, origem do mínimo e não dupla contagem

- Status: Concluída — breakdown causal, origem autorizada, invariantes e
  paginação verificados em 2026-09-01
- Onda: 2
- Dependências: T06
- Paralelização: Com T08 e preparação de T09

## Objetivo

Completar a explicabilidade do read model, permitindo reconciliar o valor e
entender quais compromissos levam ao menor saldo projetado.

## Escopo

- Expor saldo de referência, menor saldo, buffer, bruto, display, déficit,
  cenário, janela, versão e pontos causais em centavos serializados.
- Mapear referências de S07 para drill-down autorizado, preservando a origem e
  sem duplicar compra, parcela, fatura e pagamento no detalhamento.
- Validar/instrumentar invariantes: soma diária, reconciliação aritmética,
  item único por `source/referenceId` quando aplicável e ausência de origem
  cancelada/fora da janela.
- Definir limite/paginação de itens causais para proteger a leitura; informar
  truncamento sem ocultar o total agregado.

## Critérios de aceite

- [x] Usuário pode reconciliar os quatro componentes da fórmula em centavos.
- [x] O ponto mínimo identifica eventos suficientes sem vazar outro household.
- [x] Testes comprovam ausência de dupla contagem com parcelas e pagamentos.

## Subtarefas

- [x] Auditar o DTO e as invariantes de reconciliação do breakdown produzido por T06.
- [x] Fechar a seleção tenant-safe das referências causais do ponto mínimo, sem duplicidade ou origens inválidas.
- [x] Definir limite/paginação determinísticos para itens causais, preservando os totais agregados e sinalizando truncamento.
- [x] Adicionar testes de parcelas/pagamentos, janela, household e reconciliação em centavos.
- [x] Registrar verificações executadas e evidências do handoff para T10/T11.

## Entregáveis

- [x] [`src/modules/spendable/contracts.ts`](../../src/modules/spendable/contracts.ts)
  publica `SpendableCausalPageInfo`, limites de leitura e hints opcionais de
  origem; o schema reconcilia abertura, mínimo, referências, janela e a
  contagem/truncamento da página sem aceitar origem cancelada.
- [x] [`src/modules/spendable/causality.ts`](../../src/modules/spendable/causality.ts)
  implementa cursor versionado opaco, limite default 100/máximo 500 e
  paginação determinística entre pontos empatados, sem copiar referência
  financeira para o cursor e sem ocultar `totalCount`.
- [x] [`src/modules/spendable/origins.ts`](../../src/modules/spendable/origins.ts)
  delega referências causais ao href canônico de S07; reservas e referências
  não resolvíveis ficam sem href e a autorização/household continua no
  resolver server-side de S07.
- [x] [`src/modules/spendable/engine.ts`](../../src/modules/spendable/engine.ts)
  valida soma diária, abertura/fechamento, datas, itens únicos e pontos
  causais antes de calcular; pagina apenas a explicação depois de encontrar o
  mínimo com a timeline completa.
- [x] [`src/modules/spendable/t07-breakdown.test.ts`](../../src/modules/spendable/t07-breakdown.test.ts),
  [`src/modules/spendable/causality.test.ts`](../../src/modules/spendable/causality.test.ts)
  e [`src/modules/spendable/origins.test.ts`](../../src/modules/spendable/origins.test.ts)
  cobrem reconciliação, cursor/truncamento, isolamento, parcelas sem
  compra/pagamento concorrente, cancelamento e origem autorizada.

## Evidências de verificação (2026-09-01)

- [x] `rtk npm exec vitest -- run src/modules/spendable --reporter=dot` — 10
  arquivos passaram, 60 testes aprovados; 7 testes PostgreSQL opt-in foram
  ignorados sem configuração de integração.
- [x] `rtk npm exec vitest -- run src/modules/forecast/builder.test.ts
  src/modules/forecast/engine.test.ts src/modules/spendable --reporter=dot` —
  12 arquivos passaram, 84 testes aprovados; a consolidação S07 de parcelas,
  realização e cancelamento permaneceu verde.
- [x] `rtk npm exec tsc -- --noEmit --pretty false --incremental false` — sem
  diagnósticos TypeScript.
- [x] `rtk npm exec eslint -- src/modules/spendable/contracts.ts
  src/modules/spendable/causality.ts src/modules/spendable/origins.ts
  src/modules/spendable/engine.ts src/modules/spendable/timeline.ts
  --max-warnings=0` — sem erros ou warnings.
- [x] `rtk git diff --check` — sem whitespace inválido.

## Handoff

- [x] T10 pode consumir `minimum.points` e `minimum.causalItems`; quando a
  página estiver truncada, `totalCount` e `truncated` são a fonte de verdade e
  `nextCursor` só aparece quando há continuação.
- [x] T10/T11 podem usar `spendableCausalOriginHref`/`mapSpendableOrigin` para
  navegação autorizada; o href não concede acesso e o resolver S07 revalida o
  household na abertura.
- [x] A fórmula nunca usa a página truncada: `minimumProjectedBalanceCents`,
  `rawSpendableCents`, `displaySpendableCents` e déficit são derivados da
  timeline integral.
