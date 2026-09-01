# Tasks — S04: Importação de extrato CSV

## Objetivo

Permitir importar, com prévia e confirmação explícita, um CSV já normalizado para a conta escolhida. Cada linha válida torna-se uma receita ou despesa realizada no mesmo ledger usado em S03, sem duplicação silenciosa e sem atravessar o isolamento por `household`.

Este plano detalha o [S04](../../docs/S04-importacao-csv.md) à luz do [PRD](../../docs/prd.md) e da [TechSpec](../../docs/techspec.md). Embora a seção 98 da TechSpec deixe importação para evolução futura, este slice é a decisão posterior e específica que a introduz; ele prevalece apenas para o CSV canônico, sem parser bancário, OFX, reconciliação ou Open Finance.

## Decisões que orientam o slice

- Dependências obrigatórias: S01 (sessão e `requireFinancialContext`), S02 (contas ativas tenant-scoped) e S03 (criação de `FinancialEvent` + `AccountEntry`, commands idempotentes e listagem).
- A importação é uma especialização de escrita de S03: não cria uma tabela concorrente de `transactions`, nem atualiza saldo de conta diretamente.
- O contrato CSV será UTF-8, com cabeçalho canônico e valores em centavos. O layout mínimo proposto é `occurred_on,description,amount_cents`; `external_id` é opcional. Valor assinado e não zero define `INCOME` (positivo) ou `EXPENSE` (negativo); o evento persiste valor absoluto e o entry recebe o sinal.
- A estratégia é **parcial explícita**: arquivo/cabeçalho inválido ou vazio não cria nada; na confirmação, linhas inválidas são excluídas e relatadas, enquanto todas as linhas válidas da prévia são persistidas na mesma transaction. Falha de persistência faz rollback de todo o lote válido.
- Idempotência possui duas camadas: `commandId` para retry da confirmação e fingerprint de conjunto normalizado por `(household_id, account_id)` para impedir reimportação acidental do mesmo conjunto, mesmo com ordem de linhas diferente. Não usar deduplicação global de linhas, pois lançamentos iguais podem ser legítimos.
- Dados financeiros brutos só transitam entre browser e servidor durante preview/confirmação e não entram em Sentry, logs ou métricas. A prévia recebe um token opaco assinado/armazenado no servidor, nunca confiança em linhas reenviadas pelo cliente.

## Ordem de execução

### Onda 0 — Contrato

1. [T01 — Contrato CSV e decisões de importação](001-contrato-csv-e-decisoes_task.md)

### Onda 1 — Fundação paralela

2. [T02 — Schema, migrations e integridade da importação](002-schema-migrations-integridade_task.md)
3. [T03 — Parser seguro e validação por linha](003-parser-validacao_task.md)
4. [T04 — Fixtures, documentação e matriz de casos](004-fixtures-documentacao-matriz_task.md)
5. [T05 — Contratos de UI e componentes de importação](005-contratos-ui-componentes_task.md)

T02–T05 podem começar após T01. A aplicação da migration de T02 é serial; T03 deve consumir o contrato fechado de T01, e T04 pode gerar fixtures em paralelo.

### Onda 2 — Backend vertical

6. [T06 — Preview autenticado e tenant-scoped](006-preview-autenticado_task.md)
7. [T07 — Confirmação transacional e criação no ledger](007-confirmacao-persistencia_task.md)
8. [T08 — Idempotência de conjunto e relatório final](008-idempotencia-relatorio_task.md)
9. [T09 — Observabilidade segura](009-observabilidade-segura_task.md)

T06 depende de T02/T03; T07 depende de T02/T06 e do contrato de escrita de S03. T08 fecha a confirmação sobre T02/T07. T09 pode ser implementada em paralelo a T06–T08, com integração final nesses use cases.

### Onda 3 — Experiência completa

10. [T10 — Tela de importação, preview e confirmação](010-tela-importacao-preview_task.md)
11. [T11 — Resultado, erros acionáveis e navegação para transações](011-resultado-e-erros-ui_task.md)

T10 depende de T05/T06/T07. T11 depende de T05/T08 e pode avançar em paralelo ao acabamento de T10 quando o contrato de resultado estiver estável.

### Onda 4 — Qualidade e fechamento

12. [T12 — Testes unitários, integração e E2E](012-testes-e2e-validacao_task.md)
13. [T13 — Validação de release](013-validacao-release_task.md)

T12 pode ser escrito incrementalmente desde T03, mas só é concluído após T08/T11. T13 é serial e fecha o slice depois de T09 e T12.

## Matriz de dependências

| ID | Task | Dependências | Paralelização principal |
|---|---|---|---|
| T01 | Contrato e decisões | S01–S03 | — |
| T02 | Schema e migrations | T01 | Com T03–T05; aplicação serial |
| T03 | Parser e validação | T01 | Com T02, T04 e T05 |
| T04 | Fixtures e documentação | T01 | Com T02, T03 e T05 |
| T05 | Contratos/componentes UI | T01 | Com T02–T04 |
| T06 | Preview | T02, T03, S01, S02 | Com T09 |
| T07 | Confirmação/ledger | T02, T06, S03 | Preparação com T08/T09 |
| T08 | Idempotência/relatório | T02, T07 | Com T09 e T10 |
| T09 | Observabilidade | T01 | Com T06–T08 |
| T10 | Tela e confirmação | T05–T07 | Com T11 quando resultado estabilizar |
| T11 | Resultado/erros UI | T05, T08 | Com T10 |
| T12 | Testes | T03, T06–T11 | Incremental; gate final |
| T13 | Release | T09, T12 | Fechamento serial |

## Caminho crítico

`T01 → (T02 + T03) → T06 → T07 → T08 → (T10 + T11) → T12 → T13`

T04, T05 e T09 reduzem risco em paralelo, mas devem estar concluídas antes do release.

## Definition of Done do slice

- [ ] CSV canônico documentado produz prévia correta antes de qualquer escrita.
- [ ] Arquivo estruturalmente inválido, vazio ou acima do limite não cria transações.
- [ ] Linhas inválidas têm número e mensagem acionável; linhas válidas seguem a estratégia parcial explicitada.
- [ ] Confirmação cria `FinancialEvent` e `AccountEntry` na conta escolhida, de forma transacional e no household da sessão.
- [ ] Mesmo conjunto não é importado silenciosamente, e retry de confirmação não duplica efeitos.
- [ ] Importações e tokens não podem ser lidos, confirmados ou reutilizados por outro household.
- [ ] A UI exibe contagens de importadas, ignoradas e com erro, e permite consultar as transações resultantes.
- [ ] Testes cobrem parser, limites, rollback, isolamento, duplicidade e o fluxo E2E.
- [ ] Observabilidade não contém conteúdo financeiro bruto.
