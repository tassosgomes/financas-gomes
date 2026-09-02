# T11 — Testes unitários e integração PostgreSQL

- Status: Concluída
- Onda: 4
- Dependências: T03, T06, T07 e T08
- Paralelização: Pode ser escrito incrementalmente com T09/T10

## Objetivo

Provar precisão, determinismo, isolamento e integração correta das fontes.

## Subtarefas

- [x] Inventariar a cobertura existente de T02/T03 e completar os cenários
  unitários de precisão, datas, empates e certeza.
- [x] Completar as fixtures e testes de integração PostgreSQL para saldo,
  exclusões, buffer, configuração, horizonte/data e isolamento entre
  households.
- [x] Cobrir rollback de falha em PostgreSQL e as fixtures integradas com S07,
  incluindo parcelas, entradas futuras, cancelamento e não dupla contagem de
  cartão.
- [x] Testar o contrato de reserva zero e deixar os valores de caixinha
  explicitamente marcados para habilitação obrigatória por S09.
- [x] Executar a matriz de verificações da T11, registrar evidências e só então
  concluir a task.

## Escopo

- Testes unitários de T02/T03: positivo, zero, bruto negativo, centavos,
  empate de mínimo, eventos no mesmo dia, fronteira de ano e cenários de
  certeza conservador/esperado.
- Testes PostgreSQL: saldo GENERAL, exclusão RESTRICTED/EXCLUDED, buffer,
  configuração ausente, household cruzado, data/horizonte e rollback de falha.
- Fixtures integradas com S07 para sem transações, parcelas futuras, entradas
  futuras confiáveis/incertas, cancelamento e não dupla contagem de cartão.
- Testar contrato de reserva zero e deixar testes de valores de caixinha
  marcados para habilitação obrigatória por S09.

## Critérios de aceite

- [x] Nenhuma comparação usa float e todos os valores reconciliam em centavos.
- [x] Há evidência automatizada de que o mesmo conjunto de dados é determinístico.
- [x] Isolamento é provado em PostgreSQL real, não apenas por mock.

## Entregáveis e evidências (2026-09-01)

- [x] [`src/modules/spendable/t11.test.ts`](../../src/modules/spendable/t11.test.ts)
  adiciona a matriz T11 para positivo, zero, déficit bruto, precisão em
  centavos, empate do mínimo, eventos no mesmo dia, virada de ano,
  determinismo independente da ordem, cenários `CONSERVATIVE`/`EXPECTED`,
  ausência de eventos e reconciliação das fontes S07. Também verifica que
  parcelas aparecem uma vez, cartão/pagamento não vira uma segunda fonte e
  cancelamentos não entram no cálculo. O teste `todo` de valores de caixinha
  deixa explícita a habilitação obrigatória quando S09 publicar a persistência.
- [x] [`src/modules/spendable/t11.integration.test.ts`](../../src/modules/spendable/t11.integration.test.ts)
  prova no PostgreSQL real o saldo `POSTED` de contas `GENERAL`, exclui
  `RESTRICTED`/`EXCLUDED`, seleciona buffer effective-dated, usa zero quando a
  configuração está ausente, respeita data/horizonte, integra entradas futuras
  confiáveis/incertas e canceladas pelo leitor S07, isola households e verifica
  rollback sem linhas parciais.
- [x] [`src/modules/forecast/sources.integration.test.ts`](../../src/modules/forecast/sources.integration.test.ts)
  mantém as fixtures PostgreSQL T11 para três parcelas materializadas uma vez
  (sem total da compra/pagamento concorrente), abertura somente com POSTED e
  realização recorrente sem dupla contagem.
- [x] `T11_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/financas_gomes
  rtk npm exec vitest -- run src/modules/spendable/t11.integration.test.ts
  --config vitest.integration.config.mts --reporter=dot` — 5/5 testes passaram
  em PostgreSQL real.
- [x] `T11_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/financas_gomes
  rtk npm exec vitest -- run src/modules/forecast/sources.integration.test.ts
  --config vitest.integration.config.mts --reporter=dot` — 2/2 testes passaram
  em PostgreSQL real.
- [x] `rtk npm exec vitest -- run src/modules/spendable/t11.test.ts
  --reporter=dot` — 5 testes passaram e 1 `todo` explícito de S09.
- [x] `rtk npm exec eslint -- src/modules/spendable/t11.test.ts
  src/modules/spendable/t11.integration.test.ts --max-warnings=0`,
  `rtk npm exec tsc -- --noEmit --pretty false --incremental false` e
  `rtk git diff --check` — sem erros.

T12 e T13 permanecem fora do escopo desta task.
