# S11 — Portabilidade, backup e operação confiável

Contrato normativo: [`ADR-014`](adr/014-s11-portabilidade-backup.md)
(`s11.v1`). Matriz de cenários:
[`S11-operacao-confiavel-contract-matrix.md`](S11-operacao-confiavel-contract-matrix.md).

## Objetivo

Fechar a V1 com mecanismos suficientes para operar o produto com segurança prática, recuperar dados e diagnosticar falhas.

## Valor entregue

O usuário não fica preso ao produto e o operador consegue detectar problemas e proteger os dados com processos previsíveis.

## Escopo

- Exportação dos datasets persistidos de S02–S09 em CSV no contrato `s11.v1`
  (ZIP único a partir de Settings → Dados). O S11 não recalcula fórmula
  financeira nem materializa forecast/Spendable/dashboard.
- Estratégia de backup recorrente do banco: preferir o PITR nativo da
  infraestrutura quando ele cumprir a política da ADR-014 (retenção ≥ 7 dias,
  RPO ≤ 24 h, RTO ≤ 4 h).
- Backup lógico externo `pg_dump → S3/R2` somente se T02 demonstrar lacuna;
  a TechSpec §113 o deixa no backlog por padrão.
- Runtime de jobs com idempotência e retry (T08). Orquestrador durável
  (Temporal de workflows) **não** entra na V1 salvo lacuna demonstrada; o
  "Temporal" da stack é o polyfill de datas.
- Sentry consolidado para frontend/backend/workers.
- Política mínima de retenção e restauração documentada.
- Runbook simples de restauração, executado em ambiente não produtivo.
- Tratamento de falhas e retry idempotente em jobs.

## Fora de escopo

- Plataforma completa de observabilidade.
- SIEM.
- Auditoria de cada ação de usuário.
- Disaster recovery multi-região sofisticado.
- Exportadores específicos para formatos bancários proprietários.

## Dependências

- Pode ser iniciado parcialmente desde S01.
- Exportação completa depende do modelo final da V1.
- Backup final depende da infraestrutura efetivamente escolhida.
- A home autenticada (`/app`, contrato `s10.v1`) é composição descartável.
  O handoff normativo está na seção *Handoff S10 → S11* de
  [`ADR-013`](adr/013-s10-overview-contract.md):
  exportar fatos de S03–S09, nunca o read model da Visão Geral; Spendable
  continua derivado do S08.

## Dados / domínio

A lista fechada de datasets, colunas, dialeto CSV, redaction e tenancy está
na ADR-014. Identificadores e campos de reconciliação entram; `householdId`,
e-mail de membros, sessões, tokens e colunas técnicas não entram.

Jobs de backup (se existirem) e o heartbeat operacional precisam ser
idempotentes e deixar estado observável de sucesso/falha.

## Backend / infraestrutura

- Endpoint/fluxo de exportação autenticada.
- Geração de CSVs por conjunto de dados relevante.
- Verificar capacidades de backup nativas da infraestrutura.
- Implementar backup adicional apenas se necessário.
- Não introduzir orquestrador de workflows na V1 sem lacuna demonstrada em T02.
- Retry/backoff e idempotência.
- Sentry para workers/jobs.

## Frontend

- Ação de exportar dados.
- Feedback de geração/conclusão/erro.
- Área de configurações suficiente para acessar a portabilidade.

## Critérios de aceite

- [x] Usuário consegue exportar seus dados principais em formato aberto.
- [x] Exportação contém apenas dados do espaço financeiro atual.
- [x] Existe backup automático compatível com o requisito operacional da V1.
- [x] Existe procedimento documentado de restauração e ele é tecnicamente plausível/testado em ambiente seguro.
- [x] Falha de job recorrente relevante chega ao Sentry (pipeline + flush; alerta no projeto é configuração do operador).
- [x] Retry não duplica efeitos.
- [x] Nenhum segredo é incluído em exportações ou logs.

## Testes

- Exportação com dados vazios e completos.
- Isolamento cross-space.
- Retry/idempotência de workflow.
- Simulação de falha de job.
- Teste periódico de restauração em ambiente não produtivo quando viável.

## Observabilidade

- Sentry em todos os runtimes relevantes.
- Alertas para falhas de backup/workflow.
- Identificação de release/ambiente.
- Logs estruturados para jobs duráveis.

## Tarefas internas sugeridas

1. Definir datasets exportáveis.
2. Implementar exportação CSV.
3. Auditar backup nativo da infraestrutura escolhida.
4. Decidir se R2/S3 adicional é necessário.
5. Implementar workflow Temporal de backup, se aplicável.
6. Garantir idempotência/retry.
7. Consolidar Sentry nos runtimes.
8. Escrever runbook de restauração.
9. Executar teste de restauração.

## Definition of Done

O produto possui caminho verificável de exportação e recuperação de dados, e falhas importantes de aplicação/jobs são detectáveis sem depender de inspeção manual casual.
