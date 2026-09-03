# T14 — Testes unitários e de integração PostgreSQL

- Status: Concluída
- Onda: 4
- Dependências: T03, T06, T07, T08 e T09 quando aplicável
- Paralelização: Com T10–T13 durante a escrita

## Objetivo

Provar por teste automatizado os comportamentos que o slice promete: exportação
correta e isolada, serialização estável, idempotência de retry e falha de job
visível.

## Escopo

- Testes puros: encoder CSV (escape, unicode, injeção de fórmula,
  determinismo), formatadores de dinheiro e data, contratos de UI e
  classificação de erro de retry.
- Testes de integração PostgreSQL, no padrão opt-in por variável já usado pelo
  repositório, com a variável registrada em `test:integration`:
  - exportação com espaço vazio e com espaço completo;
  - exportação com os filtros da tela de transações aplicados, incluindo filtro
    sem resultado;
  - isolamento cross-space com IDs forjados de outro household, em todos os
    datasets;
  - reconciliação: o total de linhas e as chaves exportadas batem com a
    consulta de origem;
  - idempotência de job: execução dupla e execução concorrente na mesma janela
    lógica não duplicam efeito;
  - retomada após falha no meio da execução.
- Teste de simulação de falha de job: erro transitório repetido com backoff,
  erro determinístico encerrado com estado registrado, evento emitido.
- Teste de redaction dedicado ao S11: nenhum campo proibido em log, breadcrumb,
  evento, manifesto, nome de arquivo ou resposta de erro.
- Seed determinístico de volume representativo reutilizável por T15, em
  `tests/fixtures/s11-operacao-confiavel/`.
- Medição do tempo de exportação com volume representativo, comparada ao limite
  definido em T01.

## Subtarefas

- [x] Escrever os testes puros do encoder e dos formatadores.
- [x] Escrever os testes de integração de exportação e isolamento.
- [x] Escrever os testes de idempotência, retry e falha de job.
- [x] Escrever o teste de redaction do S11.
- [x] Construir o seed de volume representativo e medir a exportação.

## Critérios de aceite

- [x] Exportação com dados vazios e completos coberta por teste executado.
- [x] Isolamento cross-space coberto em todos os datasets exportáveis.
- [x] Retry e idempotência de job comprovados por teste, incluindo execução
  concorrente.
- [x] Simulação de falha de job comprova o estado registrado e o evento emitido.
- [x] O teste de redaction falha ao introduzir qualquer campo proibido.
- [x] A suíte de integração opt-in roda por comando documentado e é
  determinística.

## Entregáveis e evidência esperada

- [x] Testes versionados junto aos módulos correspondentes.
- [x] Seed determinístico em `tests/fixtures/s11-operacao-confiavel/`.
- [x] Variável de integração adicionada ao script `test:integration`.
- [x] Saída resumida de `npm test` e da suíte de integração registrada na task.

## Sequenciamento

- Bloqueado por: T03, T06, T07, T08.
- Desbloqueia: T15, T16.
- Paralelizável: sim; a escrita pode começar na Onda 1.

## Fora de escopo

Teste E2E de navegador (T15) e teste de restauração de infraestrutura (T13).

## Medição de exportação (volume representativo)

| Métrica | Valor |
| --- | --- |
| `financial_events` | 10_000 |
| `account_entries` | 20_000 |
| Duração medida | **422 ms** |
| Limite ADR-014 (T01) | 25_000 ms |
| Comando | `S11_VOLUME_INTEGRATION=1` (opt-in) |

## Saída resumida dos testes

### `npm test` (unitários)

```
Test Files  132 passed | 40 skipped (172)
     Tests  871 passed | 214 skipped (1085)
  Duration  52.14s
```

### Integração PostgreSQL (`S11_INTEGRATION=1`)

Comando:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/financas_gomes_test \
  S11_INTEGRATION=1 \
  npx vitest run --config vitest.integration.config.mts \
  src/modules/export src/modules/jobs
```

Saída:

```
Test Files  3 passed (3)
     Tests  68 passed | 1 skipped (69)
  Duration  7.25s
```

Arquivos cobertos:

- `src/modules/export/csv.test.ts` — encoder CSV, formatadores, byte-stability
- `src/modules/export/reads.test.ts` — filtros, cursor, contratos
- `src/modules/export/use-cases.test.ts` — ZIP, rate-limit, timeout, redaction manifest
- `src/modules/export/reads.integration.test.ts` — isolamento, filtros, reconciliação reads
- `src/modules/export/use-cases.integration.test.ts` — export ZIP, reconciliação, redaction
- `src/modules/jobs/runtime.test.ts` — retry unitário, idempotência mockada
- `src/modules/jobs/runtime.integration.test.ts` — double/concurrent/resume/failure/eventos
- `src/modules/observability/t13-s11-redaction.test.ts` — redaction S11

### Volume opt-in (`S11_VOLUME_INTEGRATION=1`)

```
Tests  1 passed | 23 skipped (24)
[S11_VOLUME_EXPORT_MS] 422
```
