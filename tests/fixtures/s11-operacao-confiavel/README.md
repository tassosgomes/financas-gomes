# S11 operação confiável — fixtures de exportação

Artefatos determinísticos para T07/T14 (fluxo autenticado de exportação ZIP) e T15 (E2E).

## Arquivos versionados

- `empty-export-manifest.json` — manifesto de espaço vazio com `generatedAt` mascarado.
- `csv-byte-stability.csv` / `csv-byte-stability.json` — amostra do dialeto CSV (T03).
- `volume.recipe.json` — metadados do volume representativo (10k eventos, 20k entries).
- `integration-fixtures.ts` — IDs determinísticos, seed A/B/vazio e gerador de volume.
- `export-integration-helpers.ts` — reconciliação ZIP ↔ reads e asserções de redaction.

## Volume representativo

O ADR-014 define 10_000 `financial_events` e 20_000 `account_entries` sintéticos.
Os IDs seguem os prefixos em `volume.recipe.json`; o gerador em
`integration-fixtures.ts` expande o recipe em lotes de 500 linhas.

O teste de volume é opt-in:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/financas_gomes_test \
  S11_VOLUME_INTEGRATION=1 \
  npx vitest run --config vitest.integration.config.mts \
  src/modules/export/use-cases.integration.test.ts
```

A suíte padrão de integração S11 usa o seed compacto A/B/vazio:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/financas_gomes_test \
  S11_INTEGRATION=1 \
  npx vitest run --config vitest.integration.config.mts \
  src/modules/export src/modules/jobs
```

O ZIP completo é validado pelos testes de integração; o manifesto versionado aqui
permite comparar contrato sem depender de `generatedAt`.
