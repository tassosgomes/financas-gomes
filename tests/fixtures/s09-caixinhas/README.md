# Fixtures sintéticas do S09 — T13

O `manifest.json` é o índice dos casos da T13. A matriz de domínio e as
fixtures de alocação são reutilizadas diretamente de T02/T04; esta pasta não
duplica `Money`, `Temporal.PlainDate` nem regras de negócio.

`postgres-fixtures.json` contém somente IDs e linhas sintéticas para a suíte
opt-in de fronteiras PostgreSQL da T13. Os testes usam `bigint` apenas ao
montar os inserts; os valores financeiros permanecem strings no arquivo.

Os comandos serializáveis de aporte, retirada, transferência, correção e
distribuição estão publicados em `src/modules/budgets/movement-fixtures.ts` e
indexados pelo manifesto. T08/T14 podem reutilizar essas referências sem
inventar autoridade de household, saldo mutável ou nova fonte financeira.

Execução PostgreSQL:

```text
rtk env T13_INTEGRATION=1 DATABASE_URL=postgresql://... npm exec vitest -- run \
  --config vitest.integration.config.mts src/db/t13-budgets.integration.test.ts
```

Readers/provider S09 e os fluxos de UI foram exercitados pelas suítes
verticais/focadas da task 013; somente E2E/T14 e release/T15 permanecem gates
separados no manifesto. A fixture de movimentos continua sendo consumível sem
inventar autoridade de household, saldo mutável ou nova fonte financeira.

## Fixture browser da T14

`e2e-fixtures.ts` expõe identidades sintéticas restritas ao provider Google
local (`e2e-*@example.test`) e nomes com sufixo de execução. A spec
`tests/e2e/budgets.spec.ts` cria categorias, Caixinhas e movimentos somente
pelas páginas autenticadas; não há seed financeiro nem acesso administrativo
substituindo a jornada. Ao final de cada cenário, a limpeza usa apenas os
households pertencentes aos e-mails sintéticos daquele cenário.

Execução isolada (com o PostgreSQL de teste e uma porta dedicada):

```text
rtk env E2E_PORT=3214 E2E_NEXT_DIST_DIR=.next-e2e-s09 \
  E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test \
  npm run test:e2e -- tests/e2e/budgets.spec.ts --reporter=line
```
