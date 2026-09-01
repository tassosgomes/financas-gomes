# T05 — Observabilidade segura do cálculo

- Status: Planejada
- Onda: 1, transversal
- Dependências: T01 e infraestrutura S01
- Paralelização: Com todas as tasks do slice

## Objetivo

Tornar exceções, inconsistências e regressões de consulta diagnosticáveis sem
enviar dados financeiros pessoais para Sentry ou logs.

## Escopo

- Instrumentar `spendable.read`, montagem de forecast, engine e serialização
  com request ID, versão da regra, cenário, horizonte, duração, resultado e
  contagens agregadas.
- Classificar validação de input/ausência de configuração como erro esperado;
  capturar somente exceções técnicas e invariantes quebrados.
- Aplicar allow-list e redaction: proibir centavos, saldo, descrição, nomes,
  IDs externos, payload, cookies, tokens e timeline em logs/Sentry.
- Medir consultas lentas por operação sem interpolar SQL ou dados financeiros;
  criar testes de redaction/classificação.

## Critérios de aceite

- [ ] Falha técnica identifica etapa e versão da regra com contexto seguro.
- [ ] Testes impedem regressão que envie dado financeiro cru à telemetria.

