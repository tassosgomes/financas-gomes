# S11 — Matriz de contrato, cenários e rastreabilidade

**Contrato base:** [`ADR-014 — s11.v1`](adr/014-s11-portabilidade-backup.md)
**Documento de slice:** [`S11 — operação confiável`](S11-operacao-confiavel.md)
**Data do gate T01:** 2026-09-03

Esta matriz é o índice operacional de T01. Ela não implementa encoder, query,
endpoint, job ou UI. Cada task posterior aponta para esta matriz e para a ADR
ao registrar evidência.

## 1. Inventário de candidatos e decisão

| Candidato | Origem no repo | Sensibilidade | Decisão T01 | Justificativa |
| --- | --- | --- | --- | --- |
| `accounts` | `src/db/accounts-categories-schema.ts` | nome de conta | **exportar** | portabilidade do catálogo |
| `categories` | idem | nome de categoria | **exportar** | portabilidade da árvore |
| `financial_events` | `src/db/financial-events-base-schema.ts` | descrição, centavos | **exportar** | fatos econômicos |
| `account_entries` | `src/db/financial-events-schema.ts` | centavos | **exportar** | reconciliação de ledger |
| `credit_cards` + regras + compras + planos + parcelas | `src/db/credit-cards-schema.ts` | limite, centavos | **exportar** | reconstruir cartão sem recalcular parcela |
| `recurring_rules`, `recurring_occurrences`, `planned_events`, `holidays` | `src/db/recurring-schema.ts` | descrição, centavos | **exportar** | compromissos persistidos; **não** a timeline gerada |
| `spendable_settings` | `src/db/spendable-schema.ts` | buffer em centavos | **exportar** | configuração; **não** o Spendable calculado |
| `budgets`, `budget_movements`, `budget_allocation_rules` | `src/db/budgets-schema.ts` | nome, centavos | **exportar** | Caixinhas persistidas; **não** saldo/proteção derivados |
| Better Auth (`user`/`session`/`account`/`verification`) | `src/modules/auth/schema.ts` | segredo, e-mail | **proibido** | identidade |
| `households`, `household_members`, `household_invites` | `src/db/tenancy-schema.ts` | e-mail, nome de pessoa | **proibido** | PII; V1 não exporta membros |
| `protected_resources`, `application_commands` | tenancy / S02 | técnico | **proibido** | sem valor de portabilidade |
| staging S04 | `src/db/transaction-imports-schema.ts` | colunas de extrato | **proibido** | pipeline; fato canônico já está no ledger |
| Agregados S10 / Spendable / forecast virtual | leituras | derivado | **proibido** | S11 não cria número novo |

Tratamento de membros: e-mail e nome de pessoa não saem no ZIP, logs ou
eventos. O usuário autentica com a própria identidade (Google) e não precisa
desses campos para levar o dinheiro embora.

## 2. Decisões fechadas por T01

| Tema | Decisão | Tasks consumidoras |
| --- | --- | --- |
| Fronteira | exporta/protege/diagnostica; não recalcula | todas |
| Contrato | `s11.v1`; ZIP `financas-gomes-export-s11v1.zip` | T03, T06, T07, T10, T15 |
| Dialeto CSV | UTF-8 sem BOM, `,`, LF, RFC 4180, dinheiro = string de centavos, data = `YYYY-MM-DD`, fórmula prefixada com `'` | T03, T07, T14 |
| Tenancy | só `requireFinancialContext()`; browser sem household | T06, T07, T10, T15 |
| Filtros §98 | opcionais; só `financial_events` + `account_entries`; Settings dispara sem filtro | T06, T07, T14 |
| Vazio | CSV com cabeçalho e 0 linhas; não é erro | T07, T11, T15 |
| Gate externo | manifesto `UNAVAILABLE_EXTERNAL_GATE`; sem CSV falso | T06, T07, T10 |
| Proibidos | lista fechada na ADR; teste de redaction | T04, T07, T12, T14 |
| Retenção/RPO/RTO | ≥7 dias / ≤24 h / ≤4 h | T02, T09, T13 |
| Backup externo | diferido a T02; default da TechSpec §113 = não, salvo lacuna | T02, T09 |
| Orquestrador | default **não**; jobs via runtime T08 + agendador externo | T02, T08, T12 |
| Job relevante | backup (se caminho A) + `s11.job.heartbeat` | T08, T09, T12, T14 |
| Settings | `/settings/data`, item Dados, sem nav principal | T05, T10, T11 |
| Limites | 25 s, 50 MiB, 1 concorrente, 60 s, página 500 | T07, T11, T14 |

## 3. Matriz de cenários normativos

| ID | Cenário | Entrada | Resultado obrigatório | Evidência |
| --- | --- | --- | --- | --- |
| S1 | Espaço vazio | household autenticado sem linhas de domínio | ZIP válido; cada CSV disponível com cabeçalho e 0 linhas; UI estado "sem dados" distinto de erro | T07, T11, T14, T15 |
| S2 | Espaço completo | fixture com contas, lançamentos, cartão, recorrência, Caixinha | todos os datasets S02–S09 presentes; chaves reconciliam com a origem | T06, T07, T14, T15 |
| S3 | Filtro sem resultado | `from`/`to` fora do intervalo dos eventos | `financial_events` e `account_entries` com 0 linhas; demais datasets intactos; não é erro | T06, T07, T14 |
| S4 | Filtro da tela | mesmos `from`, `to`, `accountId`, `categoryId`, `kind`, `status` de `/transactions` | subconjunto idêntico à listagem filtrada para eventos; entries só dos eventos incluídos | T06, T14 |
| S5 | Dataset de slice aberto | leitura ausente | `UNAVAILABLE_EXTERNAL_GATE`, CSV omitido, UI explica | T06, T07, T10 |
| S6 | Volume representativo | 10k eventos + 20k entries | streaming; termina < 25 s no ambiente de teste; sem carregar tudo em memória | T06, T14 |
| S7 | Caracteres especiais | descrição com vírgula, aspas, LF, unicode | round-trip em parser CSV padrão; colunas intactas | T03, T14 |
| S8 | Injeção de fórmula | `=1+1`, `+CMD`, `-1500`, `@SUM` | CSV com `'`; valor semântico restaurado pelo dialeto; Excel não executa | T03, T14 |
| S9 | Cross-space | IDs de outro household injetados em filtro ou fixture paralela | zero linhas estrangeiras em **todos** os datasets | T06, T07, T14, T15 |
| S10 | Não autenticado | chamada sem sessão | `UNAUTHENTICATED`; sem arquivo | T07, T15 |
| S11 | Tenancy no browser | body/query com `householdId` | campo rejeitado; contexto continua o do servidor | T07, T10 |
| S12 | Timeout / tamanho | geração > 25 s ou ZIP > 50 MiB | erro opaco contratado; nada truncado | T07, T11, T14 |
| S13 | Retry de job | mesma `(jobName, logicalWindow)` duas vezes | segunda execução `SKIPPED_IDEMPOTENT`; efeito não duplica | T08, T14 |
| S14 | Falha transitória de job | erro de rede nas duas primeiras tentativas | backoff; sucesso na terceira ou `FAILED` após 3; Sentry na falha final | T08, T12, T14 |
| S15 | Segredo | token/DSN/e-mail injetados em log | teste de redaction falha a suíte se vazar | T04, T14 |

## 4. Critérios de aceite → tasks e evidência

Origem: [`docs/S11-operacao-confiavel.md`](S11-operacao-confiavel.md).

| Critério | Tasks | Evidência esperada |
| --- | --- | --- |
| Usuário exporta dados principais em formato aberto | T01, T03, T06, T07, T10, T15 | ZIP CSV `s11.v1` a partir de Settings; E2E inspeciona o arquivo |
| Exportação só do espaço atual | T01, T06, T07, T14, T15 | integração cross-space com IDs forjados em todos os datasets |
| Backup automático compatível com a V1 | T02, T09, T13 | decisão datada + nativo e/ou job; runbook |
| Procedimento de restauração testado | T13 | `docs/backup-restore.md` + registro datado da execução |
| Falha de job recorrente chega ao Sentry | T04, T08, T12 | falha controlada + evento/alerta |
| Retry não duplica efeitos | T08, T14 | integração de execução dupla/concorrente |
| Nenhum segredo em exportações ou logs | T01, T04, T07, T12, T14 | redaction + amostra de ZIP |
| PRD §25 CSV | T01, T03, T07, T10 | contrato + encoder + UI |
| PRD §26 backup | T02, T09, T13 | auditoria e runbook |
| PRD §28 linguagem | T05, T10, T11 | textos da UI |
| TechSpec §4 portabilidade de provedor | T02, T08, T09 | job sem import de Vercel/Neon |
| TechSpec §5 tenancy | T06, T07, T10 | contexto server-side |
| TechSpec §72–73 idempotência | T08, T14 | registro de execução + transação |
| TechSpec §95 Settings | T05, T10 | `/settings/data` |
| TechSpec §98 filtros | T01, T06, T07, T14 | cenário S3/S4 |
| TechSpec §102–103 observabilidade | T04, T12 | contrato S11 + Sentry |
| TechSpec §112 dados de produção | T09, T13, T14 | fixtures sintéticas |
| TechSpec §113 backup | T02, T09, T13 | PITR nativo vs backlog `pg_dump` |
| TechSpec §114 índices | T06 | EXPLAIN só se query nova precisar |
| TechSpec §116 testes | T14, T15 | unit + integração opt-in + E2E |

## 5. Gates externos

| Gate | Estado em 2026-09-03 | Comportamento da exportação |
| --- | --- | --- |
| S09 (Caixinhas) | publicado em `main` (`2c4384a`); datasets persistidos | exportar `budgets*` |
| S10 (visão consolidada) | não iniciado; **não** cria tabela | nenhum dataset S10 em `s11.v1` |
| Plano original de tasks (S09 T04/T07/T08/T11–T15 pendentes) | desatualizado em relação ao código já mergeado | não compensar com dado derivado se uma leitura S09 regressar; marcar indisponível |

S11 não espera o S10 para fechar a portabilidade: a home consolidada não é
fonte de verdade persistida.

## 6. Mapeamento de tasks T02–T16

| Task | Consome de T01 | Não pode decidir sozinha |
| --- | --- | --- |
| T02 | política retenção/RPO/RTO; default backup/orquestrador | dialeto CSV ou lista de datasets |
| T03 | dialeto, dinheiro, data, fórmula | quais colunas existem |
| T04 | operações, limites de lentidão, proibidos | payload financeiro |
| T05 | rota, estados, textos, ausência de tenancy | formato do arquivo |
| T06 | datasets, ordenação, filtros, página 500 | CSV |
| T07 | ZIP, manifesto, limites, códigos de erro | colunas |
| T08 | chave de job, estados, retry | backup em si |
| T09 | caminho A/B segundo T02 | política de retenção (já fechada) |
| T10/T11 | Settings, estados, erros opacos | backend |
| T12 | jobs relevantes, redaction | novo transporte |
| T13 | alvos RPO/RTO e critério de sucesso | UI |
| T14/T15 | cenários S1–S15 | mudar contrato |
| T16 | esta matriz como checklist | reabrir escopo |
