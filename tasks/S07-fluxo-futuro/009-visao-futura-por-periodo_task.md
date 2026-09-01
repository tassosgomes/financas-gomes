# T09 — Visão futura mensal por período

- Slice: S07 — Fluxo futuro
- Status: Concluída — visão mensal server-first, navegação, estados e responsividade verificadas em 2026-08-31.
- Onda: 3
- Dependências: T06 e T08
- Paralelização: Com preparação de T10; integração visual final depois de T10

## Objetivo

Entregar a página de projeção que permite navegar por meses/períodos e entender o saldo projetado.

## Escopo

- Criar rota server-first da visão futura, com mês padrão definido em T01, navegação anterior/próximo, seleção de intervalo permitido e cenário.
- Renderizar saldo inicial/final projetado, totais de entradas e saídas, realizado versus previsto e timeline/breakdown agrupado por período.
- Usar exclusivamente T06; tratar loading, vazio, erro, dados desatualizados e URL inválida com recuperação segura.
- Manter retorno de drill-down e estado de período na navegação, sem esconder compromissos cancelados como ativos.

## Critérios de aceite

- [x] Mês sem compromisso apresenta saldo e estado vazio claros — o resumo
  preserva saldos/totais zero recebidos de T06 e a timeline exibe estado vazio
  explícito sem criar itens no client.
- [x] Troca de período atualiza corretamente totais e itens, inclusive em dezembro/janeiro —
  links anterior/próximo são gerados no servidor a partir do intervalo validado
  por T06 e preservam o cenário.
- [x] A tela explica que valores são realizados ou previstos e não apresenta pagamento de cartão como nova despesa —
  cards, buckets e itens exibem labels/badges de realizado/comprometido/esperado,
  e o resumo mantém a explicação de transferência de cartão.

## Handoff e verificações

- T10 conecta detalhes/adições; T12 cobre E2E da navegação.
- Testes de componentes/integração de rota com respostas de T06 e viewport estreito.

## Fora de escopo

Dashboard S10, spendable S08, gráfico probabilístico e edição financeira ad hoc.
## Subtarefas

- [x] Integrar a tela ao contrato server-side T06 e componentes T08 — a rota
  `/forecast` chama somente `getForecastAction` e passa o read model serializável
  aos componentes compartilhados.
- [x] Implementar navegação mensal, estados vazios e totais explicáveis — o
  seletor GET aceita apenas os campos públicos e a composição mostra resumo,
  buckets civis, timeline e recuperação segura para erro/URL inválida.
- [x] Validar desktop/mobile, virada de ano e critérios de aceite — classes
  responsivas, inputs/navegação acessíveis e testes focados cobrem mês vazio,
  realizado versus previsto e dezembro→janeiro.

## Entrega e evidências (2026-08-31)

- [x] `src/app/forecast/page.tsx` implementa a visão server-first: o default
  de mês e os dados vêm de `getForecastAction`; o client só submete `from`,
  `to` e `scenario` pelo formulário GET de T08.
- [x] `src/app/forecast/layout.tsx` protege a rota com o shell/contexto
  autenticado e `src/app/forecast/loading.tsx` fornece estado de carregamento
  acessível.
- [x] Navegação civil anterior/próximo usa `Temporal.PlainDate` no servidor,
  preserva intervalo/cenário e atravessa dezembro/janeiro sem usar relógio ou
  regra financeira no browser.
- [x] `src/components/forecast/forecast-period-breakdown.tsx` apresenta os
  buckets `periods` de T06 sem reagrupar ou recalcular valores; a grade
  responsiva separa entradas/saídas realizadas e previstas.
- [x] O shell autenticado oferece acesso a `Fluxo futuro` em navegação estreita
  e desktop; nenhum drill-down/manutenção de origem de T10 foi introduzido.
- [x] URL inválida, falha de leitura e período vazio usam mensagens allow-list
  e link de recuperação para o mês atual, sem expor exceções, SQL ou payload.
- [x] A rota permanece `force-dynamic` e consulta T06 a cada navegação; como o
  contrato público não possui timestamp de frescor, nenhum valor antigo é
  apresentado com uma indicação falsa de atualização.

### Verificações executadas

- [x] `rtk npx vitest run src/app/forecast/page.test.tsx src/components/forecast/forecast-components.test.tsx --reporter=dot` — 7/7 testes aprovados.
- [x] `rtk npx vitest run src/modules/forecast --reporter=dot` — 39 testes aprovados e 3 integrações opt-in ignoradas sem banco.
- [x] `rtk npm exec eslint -- src/app/forecast src/components/forecast src/components/auth/authenticated-shell.tsx src/modules/forecast --max-warnings=0` — sem warnings.
- [x] `rtk npm run build` — compilação da rota concluída; bloqueada na checagem por diagnóstico preexistente de T05 em `src/modules/forecast/engine.ts:389`.

### Bloqueios

- O typecheck/build global continua bloqueado somente pelo diagnóstico
  preexistente de T05 em `src/modules/forecast/engine.ts:389`; não há
  diagnóstico nos arquivos de T09. T10 (drill-down/manutenção) e T12 (E2E)
  permanecem fora desta entrega.
