# Tasks — S11: Portabilidade, backup e operação confiável

## Objetivo

Fechar a V1 com mecanismos suficientes para operar o produto com segurança
prática: o usuário leva seus dados embora em formato aberto, o operador
consegue recuperar o banco por um procedimento testado, e falhas relevantes de
aplicação e de jobs são detectáveis sem depender de inspeção manual casual.

Este plano foi derivado de
[`docs/S11-operacao-confiavel.md`](../../docs/S11-operacao-confiavel.md),
[`docs/prd.md`](../../docs/prd.md) e
[`docs/techspec.md`](../../docs/techspec.md), com atenção às seções 25, 26 e 28
do PRD e às seções 3, 4, 5, 72, 73, 95, 98, 102, 103, 104, 112, 113, 114 e 116
da TechSpec.

## Fronteira do slice

- **O S11 exporta, protege e diagnostica; ele não recria fórmula financeira.**
  Toda linha exportada vem de um dado já persistido ou de uma leitura já
  existente de S02–S09. Nenhum número novo nasce aqui.
- Dinheiro trafega em centavos (`bigint`/`Money`, strings na serialização),
  datas usam `Temporal.PlainDate`/ISO e IDs usam UUIDv7. O browser nunca
  fornece `householdId` nem autoridade de tenancy.
- A portabilidade é funcionalidade de usuário e vive em Settings. Backup e
  restauração são operação e vivem em runbook, não em tela.
- Nenhuma decisão do slice pode criar dependência de domínio em Vercel, Neon ou
  storage específico (TechSpec §4).

## Decisões normativas do plano

- A lista de datasets exportáveis é fechada em T01 e cada um precisa de
  justificativa de portabilidade ou reconciliação. Nenhum dataset entra por
  simetria de tabela.
- O dialeto CSV, o formato de dinheiro e o formato de data são únicos, fechados
  em T01 e implementados uma única vez em T03. Nenhuma task posterior decide
  formatação por conta própria.
- A lista de dados proibidos na exportação e nos logs é fechada, e é verificada
  por teste de redaction, não por revisão de código.
- **Backup externo (R2/S3) e orquestrador durável (Temporal) não entram por
  arquitetura preventiva.** A TechSpec §113 coloca o backup lógico externo no
  backlog, §104 rejeita infraestrutura preventiva e a V1 não prevê orquestrador
  de workflows — o "Temporal" da stack é o polyfill de datas. T02 decide os
  dois casos com evidência de lacuna, e T09 implementa ou registra formalmente
  a não implementação.
- Um job só é considerado confiável quando repetir não duplica efeito e falhar
  deixa estado consultável. Idempotência reutiliza o padrão da TechSpec §72.
- O runbook de restauração só é aceito depois de executado em ambiente não
  produtivo, com RPO/RTO medidos e não presumidos.
- Nenhuma etapa do slice baixa dados de produção para desenvolvimento nem usa
  household real (TechSpec §112).

## Dependências e gates

S01 fornece autenticação, household, Sentry, health/readiness e o pipeline de
deploy. S02–S09 fornecem os dados que compõem os datasets. S10 fornece o
handoff com as leituras usadas pela home e os pontos de falha monitorados.

**Gates externos:** S09 está publicado em `main` (datasets de Caixinha
persistidos). S10 ainda não iniciou e não persiste dataset: a exportação `s11.v1`
não inclui agregados de dashboard. Se uma leitura de slice estiver ausente, a
exportação marca o dataset como indisponível — nunca entrega arquivo vazio como
se fosse completo, e nenhuma task do S11 compensa a ausência com dado derivado
próprio.

Parte do slice pode começar cedo: T03, T04 e T08 não dependem do modelo final
da V1 e podem avançar em paralelo aos slices anteriores. Apenas a lista
definitiva de datasets (T01) e a exportação completa (T06/T07) exigem o modelo
estabilizado.

## Ordem de execução

### Onda 0 — Contrato

1. [T01 — Contrato do S11, datasets exportáveis e fronteira do slice](001-contrato-datasets-fronteira_task.md) — concluída 2026-09-03

T01 é serial. Ela fecha datasets, colunas, dialeto CSV, redaction, tenancy,
retenção e limites antes de qualquer código.

### Onda 1 — Fundações paralelas

2. [T02 — Auditoria do backup nativo e decisão sobre backup externo e workflows duráveis](002-auditoria-backup-nativo-decisao_task.md) — concluída 2026-09-03
3. [T03 — Serialização CSV determinística e segura](003-serializacao-csv-determinista_task.md) — concluída 2026-09-03
4. [T04 — Observabilidade segura da exportação e da operação](004-observabilidade-s11_task.md) — concluída 2026-09-03
5. [T05 — Contratos de UI e navegação de Settings/portabilidade](005-contratos-ui-settings_task.md) — concluída 2026-09-03
6. [T06 — Leituras tenant-safe dos datasets exportáveis](006-reads-datasets-tenant-safe_task.md) — concluída 2026-09-03

As cinco começam juntas após T01 e não se tocam: T02 é auditoria e decisão, T03
é código puro de formatação, T04 é trilha transversal de observabilidade, T05 é
contrato de apresentação e T06 é acesso a dados. T04 e T05 só fecham quando os
contratos de backend estabilizam.

### Onda 2 — Backend vertical

7. [T07 — Fluxo de exportação autenticado, empacotamento e entrega](007-fluxo-exportacao-autenticado_task.md) — concluída 2026-09-03
8. [T08 — Runtime de jobs recorrentes: idempotência, retry e estado observável](008-jobs-idempotencia-retry_task.md) — concluída 2026-09-03
9. [T09 — Backup lógico externo condicional (pg_dump → S3/R2)](009-backup-externo-condicional_task.md) — concluída 2026-09-03 (caminho B)

T07 é o ponto de junção de T03 e T06 e roda em paralelo com T08, que não
depende de exportação. T09 é condicional: só existe como implementação se T02
decidir por ela, e exige T08 pronto.

### Onda 3 — Experiência e operação

10. [T10 — UI: Settings → dados e portabilidade, ação de exportar](010-ui-settings-exportar-dados_task.md) — concluída 2026-09-03
11. [T11 — UI: feedback de geração, conclusão, erro e estados vazios](011-ui-feedback-estados_task.md) — concluída 2026-09-03
12. [T12 — Consolidação do Sentry nos runtimes e alertas operacionais](012-sentry-consolidado-alertas_task.md) — concluída 2026-09-03

T10 entrega a tela e T11 fecha os estados sobre ela — são sequenciais porque
tocam o mesmo componente. T12 é trilha de operação e roda em paralelo às duas.

### Onda 4 — Qualidade e fechamento

13. [T13 — Retenção, runbook de restauração e teste de restauração executado](013-retencao-runbook-restauracao_task.md) — concluída 2026-09-03
14. [T14 — Testes unitários e de integração PostgreSQL](014-testes-unitarios-integracao_task.md) — concluída 2026-09-03
15. [T15 — Testes E2E de portabilidade](015-testes-e2e_task.md) — concluída 2026-09-03
16. [T16 — Validação de release, DoD do S11 e fechamento da V1](016-validacao-release-fechamento-v1_task.md) — concluída 2026-09-03

T13 e T14 são paralelas: uma valida infraestrutura, a outra valida código. T15
exige as telas e o seed de T14. T16 é serial e fecha a V1.

## Matriz de dependências e paralelização

| ID | Onda | Dependências | Pode ocorrer em paralelo com |
|---|---:|---|---|
| T01 | 0 | Modelo final da V1; handoff S10 | — |
| T02 | 1 | T01 | T03, T04, T05, T06 |
| T03 | 1 | T01 | T02, T04, T05, T06 |
| T04 | transversal | T01, infra S01 | T02, T03, T05, T06–T14 |
| T05 | transversal | T01 | T02, T03, T04, T06 |
| T06 | 1 | T01 | T02, T03, T04, T05 |
| T07 | 2 | T03, T06, T04 | T08 |
| T08 | 2 | T01, T04 | T07 |
| T09 | 2 | T02, T08 | T10, T11, T12 |
| T10 | 3 | T05, T07 | T09, T12 |
| T11 | 3 | T05, T10 | T09, T12 |
| T12 | 3 | T04, T08, T09, T02 | T10, T11 |
| T13 | 4 | T02, T09, T12 | T14 |
| T14 | 4 | T03, T06, T07, T08, T09 | T10–T13 durante a escrita |
| T15 | 4 | T10, T11, T14 | T13 |
| T16 | 4 | T12, T13, T14, T15 | — |

## Caminho crítico

`T01 → T06 → T07 → T10 → T11 → T15 → T16`

A trilha de operação `T02 → T08 → T09 → T12 → T13` corre em paralelo e só
converge em T16. T03, T04 e T05 são trilhas de suporte: atrasam o fechamento,
não o avanço. T14 reduz risco se for escrita desde a Onda 1, mas seu gate final
permanece depois do backend integrado.

**Antecipação possível:** T03, T04 e T08 não dependem do modelo final da V1 e
podem ser desenvolvidas antes do fechamento de S09/S10, conforme a dependência
declarada em `docs/S11-operacao-confiavel.md`.

## Rastreabilidade — critérios e requisitos → tasks

O PRD deste projeto não numera user stories; a rastreabilidade usa os critérios
de aceite do slice e as seções de origem.

| Critério / requisito de origem | Tasks | Tipo de cobertura |
|---|---|---|
| Usuário consegue exportar seus dados principais em formato aberto | T01, T03, T06, T07, T10, T15 | Direta |
| Exportação contém apenas dados do espaço financeiro atual | T01, T06, T07, T14, T15 | Direta |
| Existe backup automático compatível com o requisito operacional da V1 | T02, T09 | Direta |
| Existe procedimento documentado de restauração, testado em ambiente seguro | T13 | Direta |
| Falha de job recorrente relevante chega ao Sentry | T04, T08, T12 | Direta |
| Retry não duplica efeitos | T08, T14 | Direta |
| Nenhum segredo é incluído em exportações ou logs | T01, T04, T07, T12, T14 | Direta |
| PRD §25 Exportação CSV | T01, T03, T07, T10 | Direta |
| PRD §26 Backup automatizado e recorrente | T02, T09, T13 | Direta |
| PRD §28 Experiência sem linguagem contábil | T05, T10, T11 | Suporte |
| TechSpec §4 Portabilidade (sem dependência de provedor) | T02, T08, T09 | Direta |
| TechSpec §5 Tenancy e tenant nunca confiado ao client | T06, T07, T10 | Direta |
| TechSpec §72–73 Idempotência e transaction boundaries | T08, T14 | Direta |
| TechSpec §95 Settings | T05, T10 | Direta |
| TechSpec §98 CSV respeita filtros da tela de transações | T01, T06, T07, T14 | Direta |
| TechSpec §102–103 Observabilidade e logs | T04, T12 | Direta |
| TechSpec §112 Dados de produção | T09, T13, T14 | Direta |
| TechSpec §113 Backup | T02, T09, T13 | Direta |
| TechSpec §114 Índices | T06 | Suporte |
| TechSpec §116 Testes | T14, T15 | Direta |

## Definition of Done do S11

- [x] O usuário exporta, a partir de Settings e em uma ação, os dados do seu
  espaço financeiro em CSV, com datasets, colunas e formatos declarados no
  contrato `s11.v1`.
- [x] Nenhuma linha de outro espaço financeiro alcança a exportação, comprovado
  por teste cross-space com IDs forjados em todos os datasets.
- [x] A exportação é determinística: o mesmo estado gera o mesmo arquivo, e
  espaço vazio produz saída válida e explicável em vez de erro.
- [x] Nenhum segredo, token, cookie, URL de banco, chave de storage ou detalhe
  técnico aparece em arquivo, manifesto, nome de arquivo, log ou evento.
- [x] A cobertura de backup da V1 está decidida com evidência, configurada e
  documentada — nativa, adicional, ou ambas.
- [x] O procedimento de restauração está escrito, foi executado em ambiente não
  produtivo e teve RPO/RTO medidos e registrados.
- [x] Jobs recorrentes relevantes são idempotentes, repetem com backoff limitado
  e deixam estado de sucesso/falha consultável.
- [x] Falha de job chega ao pipeline Sentry (evento + flush); alerta no projeto
  Sentry é passo do operador (T12). Falha de backup nativo é monitorada no
  provedor (caminho B), não por job da aplicação.
- [x] Todo runtime relevante reporta ao Sentry com release e ambiente corretos.
- [x] Testes puros, integração PostgreSQL opt-in e E2E de portabilidade estão
  executados e registrados.
- [x] Os gates externos herdados de S09 e S10 estão registrados com origem, sem
  serem compensados por dado derivado dentro do S11.
