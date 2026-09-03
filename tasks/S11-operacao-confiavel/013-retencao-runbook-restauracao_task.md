# T13 — Retenção, runbook de restauração e teste de restauração executado

- Status: Concluída (2026-09-03)
- Onda: 4
- Dependências: T02, T09, T12
- Paralelização: Com T14 durante a escrita

## Objetivo

Transformar a política de T01 e a decisão de T02 em um procedimento que uma
pessoa consegue executar sob pressão, e provar que ele funciona restaurando de
verdade em ambiente não produtivo.

## Escopo

- Escrever `docs/backup-restore.md` como runbook curto e sequencial: quando
  restaurar, quem autoriza, pré-requisitos, passos numerados, verificação de
  sucesso e o que fazer se um passo falhar.
- Documentar a política mínima de retenção efetivamente vigente: janela, o que
  é retido, onde, por quanto tempo e como o expurgo acontece.
- Documentar RPO e RTO reais medidos, não os desejados, e a diferença em
  relação ao alvo de T01.
- Cobrir os dois caminhos possíveis: restauração pelo mecanismo nativo (PITR) e,
  se T09 seguiu o caminho A, restauração a partir do artefato externo.
- Incluir a verificação pós-restauração: migrations aplicadas, `db:check`,
  `/api/readiness`, e uma checagem de consistência financeira que use dados
  fictícios conhecidos em vez de inspecionar dados reais.
- Executar o teste de restauração em ambiente seguro e registrar data, duração,
  o que foi restaurado, o que falhou e o que foi corrigido no runbook depois da
  execução.
- Respeitar a TechSpec §112: o teste não pode envolver baixar produção para
  máquina de desenvolvedor nem usar household real.
- Referenciar o runbook a partir de `docs/production-deploy.md` e do
  `docs/00-README.md`.

## Subtarefas

- [x] Escrever o runbook com passos numerados e critérios de verificação.
- [x] Documentar retenção, RPO e RTO medidos.
- [x] Executar a restauração em ambiente não produtivo e cronometrar.
- [x] Corrigir o runbook com o que a execução real mostrou.
- [x] Registrar a evidência datada na própria task.

## Critérios de aceite

- [x] O runbook é executável por alguém que não escreveu o código, sem
  conhecimento tácito.
- [x] Existe procedimento documentado de restauração e ele foi tecnicamente
  testado em ambiente seguro, com registro datado.
- [x] A política de retenção documentada corresponde ao que está de fato
  configurado.
- [x] RPO e RTO registrados são medidos, e qualquer distância do alvo está
  declarada.
- [x] O procedimento não expõe segredo, URL de banco nem identificador de
  provedor.
- [x] Nenhuma etapa do teste usa dados reais de produção.

## Entregáveis e evidência esperada

- [x] `docs/backup-restore.md`.
- [x] Registro datado do teste de restauração nesta task.
- [x] Atualizações de `docs/production-deploy.md` e `docs/00-README.md`.

## Evidência do drill (2026-09-03)

| Item | Resultado |
| --- | --- |
| Runbook | [`docs/backup-restore.md`](../../docs/backup-restore.md) |
| Caminho T09 | B — Neon PITR; sem artefato R2/S3 |
| Banco fonte | `financas_gomes_restore_drill` (local, não prod) |
| Banco destino | `financas_gomes_restore_verify` (recriado) |
| Marcador sintético | `job_executions` com `correlation_id = T13-DRILL-2026-09-03`, `logical_window = 2099-09-03` |
| Marcador pós-restore | **Verificado** (1 linha, `SUCCEEDED`) |
| `pg_dump -Fc` | 0,08 s (~159 KiB) |
| `pg_restore` | 0,25 s |
| `npm run db:check` | 0,89 s — 20 migrations aplicadas, 0 pendentes |
| `GET /api/readiness` | 0,02 s — `database=ok`, `schema=ok` |
| Falha durante drill | `DROP DATABASE` em bloco transacional — runbook corrigido com `psql -c` separados |
| RPO/RTO vs alvo (≤24 h / ≤4 h) | Ambos os caminhos medidos **atendem**; caminho lógico ~1,2 s total no volume do drill |

## Sequenciamento

- Bloqueado por: T02, T09, T12.
- Desbloqueia: T16.
- Paralelizável: sim, com T14.

## Fora de escopo

Disaster recovery multi-região, automação de restauração e ensaio periódico
agendado — registrar como evolução, se desejado.
