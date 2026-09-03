# T16 — Validação de release, DoD do S11 e fechamento da V1

- Status: Concluída (2026-09-03)
- Onda: 4
- Dependências: T12, T13, T14, T15
- Paralelização: Não

## Objetivo

Fechar o slice — e com ele a V1 no eixo de portabilidade/operação — com prova
executada de cada critério de aceite, e com registro honesto do que ficou fora
e por quê.

## Evidências datadas (2026-09-03)

### Gates

| Comando | Resultado |
| --- | --- |
| `npm run lint` | aprovado (0 warnings) após remover imports não usados no teste de UI |
| `npm run typecheck` | aprovado |
| `npm test` | 132 files passed, 40 skipped; **871 tests passed**, 214 skipped |
| `S11_INTEGRATION=1 npm run test:integration` | 38 files passed, 2 skipped; **205 tests passed**, 9 skipped |
| `npm run test:e2e` | **33 passed** (10.8 min), incluindo 5 de portabilidade |
| `DATABASE_URL=… npm run db:check` | 20 aplicadas, 0 pendentes, 0 divergentes |
| `npm run db:check:files` | Everything's fine |
| `git diff --check` / `git diff origin/main --check` | sem erros de whitespace |

### Matriz critério S11 → evidência

| Critério | Evidência |
| --- | --- |
| Exportar dados principais em CSV | T07/T10 + `tests/e2e/export.spec.ts` fluxo feliz |
| Só o espaço atual | T06/T14 integração cross-space em 17 datasets |
| Backup automático V1 | T02+T09 caminho B (Neon PITR); ADR-014 |
| Restauração testada | T13 `docs/backup-restore.md` + drill local ~1,2 s |
| Falha de job no Sentry | T08/T12: eventos + `flushSentrySafely`; alerta no projeto Sentry é passo do operador (sem DSN neste ambiente) |
| Retry não duplica | T08/T14 job duplo/concorrente |
| Sem segredos | T04 redaction, T14 manifesto/filename, T15 ZIP |

### Reconfirmação T02 (2026-09-03)

Backup externo: **não**. Orquestrador durável: **não**. Gatilhos inalterados
(ver ADR-014 e `docs/v1-fechamento.md`).

### Gate externo

S10 não iniciado — home consolidada fora deste slice. S09 publicado e exportado.

## Subtarefas

- [x] Executar todos os gates e colar a saída resumida na task.
- [x] Preencher a matriz critério → evidência.
- [x] Reconfirmar as decisões de T02 e registrar a data da reconfirmação.
- [x] Escrever o documento de fechamento da V1.
- [x] Atualizar o índice e os status das tasks do slice.

## Critérios de aceite

- [x] Todos os critérios de aceite do documento do S11 estão marcados com
  evidência rastreável, ou explicitamente reportados como não atendidos.
- [x] Nenhum gate é declarado aprovado sem comando e resultado registrados.
- [x] Falhas externas herdadas estão descritas com origem e não atribuídas ao
  S11.
- [x] A Definition of Done do slice está integralmente avaliada.
- [x] O documento de fechamento distingue o que foi entregue do que foi adiado.

## Entregáveis e evidência esperada

- [x] Seção de evidências datada nesta task.
- [x] Documento de fechamento da V1 em `docs/v1-fechamento.md`.
- [x] `tasks/S11-operacao-confiavel/tasks.md` atualizado.

## Sequenciamento

- Bloqueado por: T12, T13, T14, T15.
- Desbloqueia: fechamento da V1.
- Paralelizável: não.

## Fora de escopo

Implementar qualquer funcionalidade nova ou reabrir escopo de slices
anteriores.
