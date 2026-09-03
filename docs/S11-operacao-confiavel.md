# S11 — Portabilidade, backup e operação confiável

## Objetivo

Fechar a V1 com mecanismos suficientes para operar o produto com segurança prática, recuperar dados e diagnosticar falhas.

## Valor entregue

O usuário não fica preso ao produto e o operador consegue detectar problemas e proteger os dados com processos previsíveis.

## Escopo

- Exportação dos dados relevantes para CSV.
- Estratégia de backup recorrente do banco/dados.
- Aproveitar backup nativo da infraestrutura/Vercel quando ele cobrir adequadamente o requisito antes de duplicar para R2.
- Caso necessário, job adicional para storage S3-compatible/R2.
- Temporal para jobs/workflows recorrentes ou duráveis que efetivamente precisem disso.
- Sentry consolidado para frontend/backend/workers.
- Política mínima de retenção e restauração documentada.
- Runbook simples de restauração.
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

Exportações devem incluir identificadores e campos suficientes para portabilidade/reconciliação sem incluir segredos técnicos.

Jobs de backup precisam ser idempotentes e deixar estado observável de sucesso/falha.

## Backend / infraestrutura

- Endpoint/fluxo de exportação autenticada.
- Geração de CSVs por conjunto de dados relevante.
- Verificar capacidades de backup nativas da infraestrutura.
- Implementar backup adicional apenas se necessário.
- Configurar Temporal para workflows duráveis previstos na TechSpec.
- Retry/backoff e idempotência.
- Sentry para workers/jobs.

## Frontend

- Ação de exportar dados.
- Feedback de geração/conclusão/erro.
- Área de configurações suficiente para acessar a portabilidade.

## Critérios de aceite

- [ ] Usuário consegue exportar seus dados principais em formato aberto.
- [ ] Exportação contém apenas dados do espaço financeiro atual.
- [ ] Existe backup automático compatível com o requisito operacional da V1.
- [ ] Existe procedimento documentado de restauração e ele é tecnicamente plausível/testado em ambiente seguro.
- [ ] Falha de job recorrente relevante chega ao Sentry.
- [ ] Retry não duplica efeitos.
- [ ] Nenhum segredo é incluído em exportações ou logs.

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
