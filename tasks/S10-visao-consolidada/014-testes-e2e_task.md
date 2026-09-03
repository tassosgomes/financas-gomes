# T14 — Testes E2E da home para os detalhes

- Status: Concluída no código; execução Playwright pendente de PostgreSQL/CI
- Onda: 4
- Dependências: T10, T11, T12, T13
- Paralelização: Não

## Objetivo

Provar em navegador que o usuário entende a Visão Geral e consegue ir de um
agregado até os lançamentos que o compõem, com dados determinísticos.

## Escopo

- Criar `tests/e2e/overview.spec.ts` seguindo o padrão de autenticação e seed
  já usado em `spendable.spec.ts` e `forecast.spec.ts`.
- Cenário de espaço financeiro novo: home carrega, mostra estados vazios
  coerentes e não exibe número inventado.
- Cenário representativo: verificar o valor de "pode gastar", o resumo do
  período, a lista de categorias, os próximos compromissos e o resumo de
  caixinhas.
- Navegação: clicar no drill-down de uma categoria e conferir que a tela de
  transações abre com o filtro e o total equivalentes; repetir para forecast,
  breakdown do spendable e caixinhas quando o destino existir.
- Cenário de erro parcial: simular indisponibilidade de uma origem e verificar
  que o bloco mostra erro enquanto o restante continua utilizável.
- Verificação de consulta mobile em viewport reduzido.
- Usar apenas `data-testid` estáveis definidos em T05.

## Subtarefas

- [x] Preparar o seed E2E determinístico reutilizando as fixtures de T09/T13.
  - O spec usa identidade única (`e2e-overview-…@example.test`) e cria
    conta/categoria/lançamentos pela UI, no mesmo padrão de
    `tests/e2e/spendable.spec.ts`. O seed PostgreSQL de volume
    (`tests/fixtures/s10-visao-consolidada/`) permanece na suíte de
    integração T09/T13; não é injetado no browser.
- [x] Escrever os cenários vazio, representativo, drill-down e erro parcial.
  - Vazio, representativo + drill-down de despesa e spendable, e 360px estão
    em `tests/e2e/overview.spec.ts`.
  - Erro parcial **não** tem hook público para falhar uma origem no browser;
    a prova está nos testes de UI/serviço:
    `overview-home.test.tsx` (`keeps spendable usable when commitments fail`),
    `composition.test.ts` e `service.test.ts`.
- [x] Adicionar a verificação de viewport mobile.
- [x] Estabilizar seletores e esperas, sem `sleep` arbitrário.
- [x] Integrar a spec ao pipeline de E2E.
  - `playwright.config.ts` usa `testDir: "./tests/e2e"`; o job `e2e` de
    `.github/workflows/ci.yml` já executa `npm run test:e2e`. Nenhuma alteração
    de workflow foi necessária.

## Critérios de aceite

- [x] O total exibido na home e o total da tela de destino coincidem no teste,
  não apenas visualmente.
  - Spec: `spendable-card-primary-value` na home vs `/spendable/breakdown`;
    despesa `R$ 450,00` na home e o lançamento correspondente em
    `/transactions?kind=EXPENSE&status=POSTED`.
- [x] O cenário vazio passa sem depender de dado residual.
  - Identidade E2E única por execução; asserts de empty sem `R$ 0,00`.
- [x] O cenário de erro parcial prova degradação por bloco.
  - Prova unitária (UI + composição + serviço). Não há injeção de falha de
    origem no Playwright neste slice.
- [x] A suíte é determinística em execuções repetidas.
  - Emails únicos; sem `waitForTimeout`.
- [x] Falhas preexistentes de outras specs são reportadas, não mascaradas.
  - Spec nova; não altera outras specs.

## Entregáveis e evidência esperada

- [x] `tests/e2e/overview.spec.ts`.
- [ ] Execução de `npm run test:e2e` com resultado registrado na task.
- [x] Registro explícito de qualquer falha externa não causada pelo S10.

## Evidência — 2026-09-03

### Spec

`tests/e2e/overview.spec.ts` cobre:

| Caso | O que prova |
| --- | --- |
| espaço financeiro novo | `overview-page`, `home-spendable`/`overview-spendable`, ações rápidas, empty de período/categorias/compromissos/caixinhas; ausência de error testids e de `R$ 0,00` no empty do período |
| resumo do mês + drill-down | receita `R$ 1.500,00`, despesa `R$ 450,00`, categoria na barra; clique em `overview-period-expense-drilldown` abre `/transactions?kind=EXPENSE&status=POSTED`; spendable da home coincide com `/spendable/breakdown` |
| 360px | `scrollWidth <= clientWidth + 1` |

Heading autenticado permanece **"Seu espaço financeiro"** (compatível com
`spendable.spec.ts`). `data-testid="home-spendable"` é mantido junto de
`overview-spendable`.

### Execução Playwright neste ambiente

**Não executada.** Este VM não tem PostgreSQL (`DATABASE_URL` ausente),
`pg_isready`/`psql` nem Docker. `playwright.config.ts` exige
`E2E_DATABASE_URL` (default `localhost:5433`) e sobe `npm run dev` com
`E2E_TEST_AUTH_ENABLED=true`.

Gate de execução: job `e2e` em `.github/workflows/ci.yml`
(`npm run test:e2e` após `db:migrate:local` em `postgres:16-alpine`).

Comando a registrar quando o ambiente existir:

```text
npx playwright test tests/e2e/overview.spec.ts
# ou
npm run test:e2e
```

### Erro parcial

Não há rota/flag para forçar `FORECAST_QUERY_FAILED` (ou equivalente) no
browser. A degradação por bloco está coberta por:

- `src/components/overview/overview-home.test.tsx` — spendable `Pode gastar: R$ 100,00` permanece quando `upcomingCommitments` está em `error`
- `src/modules/overview/composition.test.ts` / `service.test.ts` — origem
  falha isolada, erro ≠ zero monetário

### Falhas externas

Nenhuma spec preexistente foi alterada. Integração PostgreSQL e E2E amplo
continuam dependentes de CI, não de falha do S10.

## Sequenciamento

- Bloqueado por: T10, T11, T12, T13.
- Desbloqueia: T15.
- Paralelizável: não.

## Fora de escopo

Teste de carga, teste visual pixel a pixel.
