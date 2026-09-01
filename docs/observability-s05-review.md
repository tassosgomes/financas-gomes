# Observabilidade do S05 — revisão de transações

Este documento descreve a camada dedicada de T10 em
[`src/modules/transactions/observability-s05.ts`](../src/modules/transactions/observability-s05.ts).
Ela não altera reads, use cases, actions ou a infraestrutura compartilhada de
observabilidade. T04–T06 podem importá-la diretamente e integrar a medição na
boundary que já resolve o `FinancialContext`.

## Contrato emitido

As operações são fechadas em:

| Operação | Query code | Use case |
| --- | --- | --- |
| `list` | `review_list` | `transactions.review.list` |
| `summary` | `review_summary` | `transactions.review.summary` |
| `detail` | `review_detail` | `transactions.review.detail` |
| `update` | `review_update` | `transactions.review.update` |

O contexto é criado com `createS05TransactionReviewOperation(operation,
options)`. Se a boundary não fornecer um `requestId` técnico, a função gera um
UUIDv7 opaco. Para detalhe/update, `eventId` pode ser informado; ele é tratado
somente como identificador técnico. `householdId` e `userId`, quando usados,
também precisam ser IDs opacos derivados do contexto autenticado — nunca de
query string, cursor ou payload.

Os metadados permitidos são `requestId`, `eventId`, `userId`, `householdId`,
`origin` agregado (`MANUAL|IMPORT|ALL`), `transactionKind` agregado
(`EXPENSE|INCOME|ALL`), status HTTP, duração, tamanho da página, contagem de
resultado, contagem de pendências e `hasNextPage`. A camada deriva o evento,
use case e query code a partir da operação; valores fornecidos pelo chamador
para esses nomes são ignorados.

Não são aceitos nem serializados `search`, descrição, valor, nomes de conta ou
categoria, `externalId`, cursor decodificado, token, CSV, cookie,
`Authorization`, payload, command, SQL ou mensagem de erro. O cursor pode ser
usado pelo read, mas não deve ser passado para qualquer função T10.

## Integração mínima

Para uma leitura T04, a integração deve manter o query/resultado fora da
observabilidade e informar somente agregados depois que a operação terminar:

```ts
const operation = createS05TransactionReviewOperation("list", {
  requestId,
  householdId: context.householdId,
  origin: "ALL",
  transactionKind: "ALL",
});

return withS05TransactionReviewObservability(
  operation,
  () =>
    measureS05Query(
      operation,
      () => reviewReads.list(context, query),
      {
        thresholdMs: 300,
        pageSize: query.limit,
        onSlowQuery: (record) => metrics.observe("s05_review_query", record),
      },
    ),
  { pageSize: query.limit },
);
```

O callback `onRecord`/`onSlowQuery` recebe um registro já allow-listed. Um
adapter de métricas não deve anexar o read model, filtros, SQL ou payload ao
registro. Para `summary`, `detail` e `update`, use a operação correspondente;
em `detail`/`update`, passe apenas o `eventId` opaco.

`withS05TransactionReviewObservability` mantém o envelope `Result<T, E>`
intacto. Um erro com código do vocabulário de S03/ADR-006 é logado como
`expected_error` e não é enviado ao Sentry. Uma exceção técnica inesperada é
logada como `unexpected_error`, enviada ao `captureServerException` existente
com contexto sanitizado e relançada para a boundary entregar sua resposta
genérica. Mensagens, stacks e objetos de erro não entram no registro T10.

## Consultas lentas

`measureS05Query` mede uma função de leitura/persistência com relógio
monotônico. Quando a duração é maior ou igual ao threshold, emite um registro
`slowQuery: true` com `queryCode`, operação, resultado, duração, threshold,
request/IDs opacos e agregados. A query e seus bind values não fazem parte da
API.

O threshold padrão é `250 ms`. Pode ser configurado por chamada (`thresholdMs`)
ou pela variável de ambiente `S05_SLOW_QUERY_THRESHOLD_MS`; o valor é limitado
entre `0` e `60_000 ms`. Valores ausentes ou inválidos usam o padrão. Um slow
query não é uma exceção Sentry por si só: a captura de exceção continua
reservada para a falha técnica inesperada da operação.

## EXPLAIN controlado para T03/T11

Use somente uma base local/efêmera ou uma réplica de teste, com dados
sintéticos e um household de teste criado para a execução. Não use extrato
real, descrição real, busca real, valores reais, tokens ou IDs de produção.

1. Aplique as migrations e semeie volume sintético suficiente para representar
   o cenário de T04/T11. Registre o identificador do tenant de teste somente
   no terminal/artefato protegido da execução.
2. Reproduza a forma da query do read, mantendo os predicados tenant-scoped,
   `kind/origin`, `occurred_on`, categoria/revisão e a ordenação
   `occurred_on DESC, id DESC`. Para paginação, use parâmetros de posição
   sintéticos equivalentes ao keyset; não decodifique nem copie um cursor de
   usuário.
3. Rode o plano dentro de uma transação controlada, com limite de tempo e sem
   escrita persistente. Exemplo ilustrativo para uma base PostgreSQL de teste
   (substitua a consulta pela forma concreta de T04 e use somente IDs
   sintéticos):

```sql
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL application_name = 'financas-s05-explain-test';

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT fe.id, fe.occurred_on
FROM financial_events AS fe
JOIN account_entries AS ae
  ON ae.household_id = fe.household_id
 AND ae.financial_event_id = fe.id
WHERE fe.household_id = '<synthetic-household-id>'
  AND fe.kind IN ('EXPENSE', 'INCOME')
  AND fe.origin IN ('MANUAL', 'IMPORT')
  AND fe.status = 'POSTED'
ORDER BY fe.occurred_on DESC, fe.id DESC
LIMIT 51;

ROLLBACK;
```

4. Compare `Planning Time`, `Execution Time`, `Buffers`, uso de índices,
   número de linhas e sinais de N+1 com o critério de T11. Salve o plano
   somente como artefato local/CI protegido e descarte-o conforme a retenção
   do ambiente; o plano detalhado não deve ser enviado ao Sentry, log de
   produção, breadcrumb ou métrica.
5. Para relacionar o resultado à instrumentação, configure um threshold
   temporário, execute o mesmo cenário através da boundary e correlacione
   `queryCode`/operação, duração, `requestId` e o ID opaco do tenant sintético.
   Não copie o SQL, parâmetros financeiros ou cursor para o evento. Depois do
   ensaio, remova a configuração temporária e os dados sintéticos.

O `EXPLAIN` é uma decisão de performance, não uma mudança de contrato: ele
deve preservar o isolamento por household, a semântica de `NEEDS_REVIEW`, a
origem `MANUAL|IMPORT` e a ordenação/cursor definidos na ADR-006.

## Handoff

- T04 deve envolver list e summary separadamente; nunca passar `search`,
  cursor ou o read model aos metadados T10.
- T05 deve envolver `transactions.review.update` e informar somente o
  `financialEventId` opaco e o resultado agregado. O command permanece fora do
  registro.
- T06 deve criar o contexto na boundary de action, preservar o
  `Result<T, E>` e deixar exceções técnicas relançarem após a captura segura.
- T11 pode usar `onSlowQuery` para métricas/artefatos de benchmark, desde que o
  callback receba somente o registro sanitizado.

Verificações dedicadas: `rtk npm exec vitest -- run
src/modules/transactions/observability-s05.test.ts`, `rtk npm run typecheck` e
`rtk npm run lint`.

