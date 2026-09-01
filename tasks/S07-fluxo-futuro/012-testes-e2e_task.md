# T12 — Testes E2E do fluxo futuro

- Slice: S07 — Fluxo futuro
- Status: Concluída — fluxos E2E de consulta, parcelas S06, origem/manutenção T10, estados de erro/loading e isolamento cross-tenant aprovados em 2026-08-31.
- Onda: 4
- Dependências: T09–T11
- Paralelização: Preparar fixtures em paralelo a T11; execução contra UI final

## Objetivo

Validar no navegador o caminho crítico de consulta, explicação e ajuste de compromissos.

## Escopo

- Cobrir sessão/household fixture, abertura da projeção, navegação de período, totais e distinção previsto/realizado.
- Cobrir parcela futura exibida uma vez, drill-down para origem, criação/override de recorrência e recálculo visível.
- Cobrir mês vazio, virada de ano e origem cancelada removendo impacto futuro; usar seletores acessíveis e dados sintéticos.

## Critérios de aceite

- [x] Fluxo crítico de consulta, navegação, parcela/cancelamento e a jornada de drill-down/manutenção foram implementados e aprovados sem scripts administrativos ou inspeção de banco pelo browser.
- [x] A URL de forecast rejeita `householdId`/`referenceId` fornecidos e não os renderiza; a rota de origem resolve referências do próprio tenant, rejeita referências cross-tenant sem vazamento e preserva o retorno seguro.
- [x] Falhas de URL, carregamento acessível e mês vazio permanecem compreensíveis; testes focados aprovados.

## Verificações

- Playwright isolado via `playwright.config.ts`/PostgreSQL de teste, com dados sintéticos criados pela UI; artefatos de falha ficam no diretório padrão do Playwright.
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'consulta a projeção' --reporter=line` — 1 aprovado (36,2 s).
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'mês vazio' --reporter=line` — 1 aprovado (48,4 s).
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'estado de carregamento' --reporter=line` — 1 aprovado (46,9 s).
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'householdId' --reporter=line` — 1 aprovado (43,1 s).
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'cada parcela' --reporter=line` — 1 aprovado (2 min 12 s), incluindo parcelas 3x, bloqueio de pagamento isolado e cancelamento agregado removendo o impacto futuro.
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'abre, altera e cancela' --reporter=line` — 1 aprovado (1 min 06 s), incluindo criação, origem própria, retorno, edição, cancelamento, remoção do impacto e referência cross-tenant sem detalhes.
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts -g 'mantém recorrência' --reporter=line` — 1 aprovado (1 min 42 s), incluindo criação, origem, override, cancelamento de ocorrência, realização explícita e referência cross-tenant sem detalhes.
- [x] `rtk npm exec eslint -- tests/e2e/forecast.spec.ts --max-warnings=0` e `rtk git diff --check -- tests/e2e/forecast.spec.ts tasks/S07-fluxo-futuro/012-testes-e2e_task.md` — sem saída.

## Fora de escopo

Cobertura exaustiva de todos os browsers e testes de S08/S10.
## Subtarefas

- [x] Mapear fixtures e jornadas E2E sobre a interface T09.
- [x] Implementar fluxos críticos, estados vazios e proteção cross-tenant — consulta, navegação, loading, vazio, URL opaca, parcela única/cancelamento agregado, origem e manutenção de T10 estão codificados.
- [x] Executar a suíte e registrar evidências de aceite — todos os cenários focados do spec T12, incluindo origem/manutenção, foram aprovados; a suíte completa do arquivo não foi necessária para os aceites focados.

## Pendências precisas

Nenhuma pendência dentro do escopo de T12. A cobertura exaustiva de browsers e S08/S10 permanece fora de escopo conforme definido acima.
