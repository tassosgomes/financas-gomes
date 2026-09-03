# Auditoria de backup — S11 T02

Documento operador-facing. Registra o confronto entre a política mínima da V1
(ADR-014 T01) e a capacidade nativa verificada em 2026-09-03. Sem segredos,
URLs de banco ou identificadores de projeto.

## Política de referência (T01)

| Métrica | Alvo V1 |
| --- | --- |
| Retenção | ≥ 7 dias de histórico restaurável |
| RPO | ≤ 24 h (desejável: contínuo se PITR cobrir) |
| RTO | ≤ 4 h em horário comercial |
| Sucesso de restore | Migrations ok, `db:check` ok, readiness 200, fixture reconcilia |

Estratégia padrão da TechSpec §113: **Neon PITR + exportação CSV manual**
(`s11.v1`). Backup lógico externo `pg_dump → R2/S3` está no backlog.

## O que cada camada cobre

| Camada | Faz backup dos dados PostgreSQL? | Papel na V1 |
| --- | --- | --- |
| **Neon** (provedor do banco) | Sim — PITR / instant restore na janela de histórico | Fonte primária de DR operacional |
| **Vercel** (host da aplicação) | **Não** | Deploy e runtime; não substitui backup de DB |
| **Exportação `s11.v1`** | Cópia lógica sob demanda do usuário | Portabilidade; não é backup agendado nem DR |
| **`pg_dump → R2/S3`** | Não implementado na V1 (decisão T02) | Backlog §113 |

## Capacidades nativas verificadas

| Item | Evidência | Fonte | Data |
| --- | --- | --- | --- |
| PITR por timestamp/LSN em root branch | Instant restore sobrescreve branch, cria backup automático, segundos típicos | [Neon — Instant restore](https://neon.com/docs/introduction/branch-restore) | 2026-09-03 |
| Retenção configurável | Free máx. 6 h; Launch máx. 7 dias; Scale máx. 30 dias | [Neon — History window](https://neon.com/docs/introduction/history-window) | 2026-09-03 |
| Vercel sem backup de Postgres | Postgres via marketplace; Vercel Postgres descontinuado | [Vercel — Postgres on Vercel](https://vercel.com/docs/storage/vercel-postgres) | 2026-09-03 |

## Matriz política × capacidade nativa × lacuna

| # | Política | Capacidade nativa | Atende? | Lacuna | Impacto se lacuna persistir |
| --- | --- | --- | --- | --- | --- |
| 1 | Retenção ≥ 7 dias | Launch/Scale com janela configurada ≥ 7 dias | Sim*, com plano pago configurado | Plano Free (6 h) ou janela &lt; 7 dias | Perda de dados além da janela irreversível |
| 2 | RPO ≤ 24 h | WAL contínuo dentro da janela PITR | Sim | PITR desabilitado (`history_retention_seconds = 0`) | RPO degradado ao último backup manual |
| 3 | RTO ≤ 4 h | Restore DB em segundos; validação app manual | Parcial** | Runbook T13 não exercitado | Risco operacional, não técnico do Neon |
| 4 | Restore validado | PITR + migrations + probes | Parcial** | Falta runbook publicado (T13) | Restore possível mas não repetível |
| 5 | Sem dependência de domínio em provedor | Lógica em PostgreSQL padrão + CSV | Sim | Cópia off-site automática ausente | Migração de DB exige export/import ou novo PITR |
| 6 | Vercel não é backup | Confirmado na documentação Vercel | Sim | Operador assume Vercel backupa | Falsa sensação de segurança; dados perdidos |

\* Exige plano **Launch** ou **Scale** com **Settings → Instant restore** em
≥ 7 dias (`history_retention_seconds` ≥ 604800).

\** Lacuna de **processo** (T13), não de capacidade do Neon.

## Decisões binárias (2026-09-03)

### 1. Backup lógico externo `pg_dump → S3/R2`

| | |
| --- | --- |
| **Decisão** | **Não implementar na V1** |
| **Caminho** | B — Neon PITR + CSV manual |
| **Motivo** | PITR nativo atende retenção/RPO com plano pago configurado; §113 mantém externo no backlog |

### 2. Orquestrador durável (Temporal o produto)

| | |
| --- | --- |
| **Decisão** | **Não implementar na V1** |
| **Caminho** | B — T08 in-process + agendador externo (GitHub Actions cron / cron do host) |
| **Motivo** | Jobs V1 são idempotentes com T08; “Temporal” na stack é polyfill de datas; §104 |

## Checklist do operador (produção)

Antes de aceitar tráfego de produção, confirmar no **Neon** (não na Vercel):

1. Plano pago (Launch ou Scale) — não usar Free para produção.
2. **Instant restore / PITR** habilitado (janela de histórico &gt; 0).
3. Janela de histórico **≥ 7 dias** (604800 segundos).
4. Branch de produção é **root branch** (PITR só em root branches).
5. Procedimento de restore testado em branch separada (T13).

A Vercel **não** faz backup do banco. Configurar apenas variáveis de conexão
(`DATABASE_URL`) não cria cópia dos dados.

## Gatilhos de revisão

Reabrir as decisões T02 se ocorrer qualquer um:

| Gatilho | Decisão afetada |
| --- | --- |
| Retenção nativa &lt; 7 dias no ambiente de produção | Backup externo |
| RPO medido &gt; 24 h em incidente ou drill | Backup externo |
| Restore validado não cumpre RTO ≤ 4 h | Backup externo |
| Troca de provedor PostgreSQL sem PITR equivalente | Backup externo |
| Job cujo efeito não é idempotente sem orquestrador durável | Temporal / orquestrador |

## Confirmação T09 — não implementação (2026-09-03)

Caminho **B** selecionado. O slice **não** entrega job de `pg_dump`, cliente
S3/R2, política de expurgo em object storage nem secrets de backup no
`.env.example`. A cobertura automática da V1 é o PITR do provedor de
PostgreSQL, desde que o operador confirme o checklist de
[`production-deploy.md`](production-deploy.md). T13 descreve o restore nativo.

## Referências

- [ADR-014 — Política e decisões T02](adr/014-s11-portabilidade-backup.md)
- [TechSpec §113 — Backup](techspec.md)
- [Deploy de produção — confirmações Neon](production-deploy.md)
