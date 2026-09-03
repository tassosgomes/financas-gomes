# S11 operação confiável — fixtures de exportação

Artefatos determinísticos para T07 (fluxo autenticado de exportação ZIP).

- `empty-export-manifest.json` — manifesto de espaço vazio com `generatedAt` mascarado.
- `csv-byte-stability.csv` / `csv-byte-stability.json` — amostra do dialeto CSV (T03).

O ZIP completo é validado pelos testes de integração (`S11_INTEGRATION=1`); o manifesto
versionado aqui permite comparar contrato sem depender de `generatedAt`.
