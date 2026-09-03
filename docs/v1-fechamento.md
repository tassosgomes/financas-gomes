# Fechamento da V1 — portabilidade e operação (S11)

**Data:** 2026-09-03  
**Contrato:** [`s11.v1`](adr/014-s11-portabilidade-backup.md)  
**Slice:** [`S11 — operação confiável`](S11-operacao-confiavel.md)

Este documento fecha o slice S11 e registra o estado da V1 no conjunto
S01–S11. Não reabre escopo de slices anteriores.

## O que a V1 entrega agora (S11)

- Exportação autenticada dos datasets persistidos de S02–S09 em CSV, empacotados
  no ZIP `financas-gomes-export-s11v1.zip`, a partir de Settings → Dados
  (`/settings/data`).
- Dialeto CSV único, determinístico, com dinheiro em centavos e neutralização
  de fórmula.
- Isolamento por espaço financeiro resolvido só no servidor.
- Runtime de jobs com idempotência `(jobName, logicalWindow)`, retry limitado e
  estado consultável (`job_executions`), exercitado por `s11.job.heartbeat`.
- Backup automático da V1 = PITR nativo do PostgreSQL gerenciado (Neon), com
  janela ≥ 7 dias a confirmar pelo operador. Sem `pg_dump → S3/R2` e sem
  orquestrador Temporal (produto).
- Runbook de restauração executado em drill local não produtivo.
- Sentry nos runtimes Next (server/edge/browser) e no CLI de jobs, com flush
  antes do exit. Alertas mínimos documentados para o operador configurar.

## O que foi deliberadamente adiado

| Item | Motivo | Herança |
| --- | --- | --- |
| Backup lógico externo `pg_dump → R2/S3` | Sem lacuna contra a política T01; TechSpec §113 backlog | Reabrir se retenção nativa &lt; 7 dias, RPO &gt; 24 h ou RTO &gt; 4 h |
| Orquestrador de workflows (Temporal produto) | Nenhum job exige saga durável; §104 | Reabrir se efeito não puder ser idempotente no runtime T08 |
| Exportação de membros / e-mails | PII; portabilidade é financeira | Fora da V1 |
| Histórico de exportações, e-mail, fila assíncrona | Evolução | Fora da V1 |
| SIEM, auditoria por ação, DR multi-região | Fora de escopo S11 | — |
| Importação genérica / formatos bancários | S04 é a ingestão; PRD §25 é CSV de saída | — |

## Gate externo que a V1 ainda não fecha

**S10 — Visão financeira consolidada** não foi iniciado. A home consolidada da
proposta de valor da V1 (totais do período, drill-down, Spendable na primeira
tela) **não** é entregue por este slice. S11 não inventa agregados de dashboard.

S09 (Caixinhas) está publicado em `main` e entra na exportação `s11.v1`.

O fechamento do **produto** V1, no sentido da home unificada, permanece
pendente de S10. O fechamento do **S11** e dos critérios de portabilidade,
backup e detecção de falha está evidenciado abaixo.

## Reconfirmação T02 (2026-09-03)

| Decisão | Status no fechamento | Gatilho inalterado |
| --- | --- | --- |
| Backup externo | **Não implementar** (caminho B) | Retenção &lt; 7 d, RPO &gt; 24 h, RTO &gt; 4 h, troca de provedor sem PITR |
| Orquestrador durável | **Não implementar** | Job cujo efeito não seja idempotente sem orquestrador |

## Política de segredos (auditoria)

Verificado por testes de redaction (T04/T14), amostra de ZIP (T07/T15) e
revisão de docs:

- Manifesto, nome de arquivo e headers de download sem `householdId`, e-mail,
  token, DSN ou URL de banco.
- Logs/eventos S11 allow-listed; centavos e PII não passam.
- Documentação usa placeholders; `.env.example` sem credenciais reais.
- Fixture `volume.recipe.json` usa UUID sintético de teste, não dado real.

## Gates executados em 2026-09-03

Registrados na task T16. Resumo: lint, typecheck, unitários, integração
opt-in, E2E de portabilidade, `db:check` e `drizzle-kit check` aprovados.
O E2E completo da V1 (demais slices) é executado no mesmo ambiente; o gate
normativo do S11 é `tests/e2e/export.spec.ts`.
