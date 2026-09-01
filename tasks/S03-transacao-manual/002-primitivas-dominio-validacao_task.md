# T02 — Primitivas de domínio e contratos de validação

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — primitivas, contratos e validações implementados e verificados em 2026-08-29.
- Onda: 1
- Dependências: T01
- Paralelização: Pode ser executada em paralelo com T08 e T09

## Objetivo

Disponibilizar os tipos seguros usados por UI, server actions, use cases e persistência, evitando que dinheiro e datas atravessem boundaries com representações ambíguas.

## Escopo

- Implementar `Money` com `cents: bigint` e operações mínimas necessárias ao slice.
- Definir parsing de centavos como string e formatação apenas na boundary; nunca usar `float` ou `input type="number"` como abstração monetária.
- Implementar conversão de `YYYY-MM-DD` para `Temporal.PlainDate` e validação de data inválida/futura.
- Reutilizar o gerador central de UUIDv7 de S01 para IDs e command IDs, sem criar uma segunda estratégia.
- Definir enums/tipos para `INCOME`, `EXPENSE`, `POSTED`, `CANCELLED`, origem manual e eventos compensatórios conforme T01.
- Criar schemas Zod para commands serializáveis:
  - `CreateExpense`;
  - `CreateIncome`;
  - atualização de campos permitidos;
  - cancelamento.
- Definir `Result<T, E>` e erros de domínio esperados, incluindo valor inválido, data futura, conta/categoria inexistente, inativa ou incompatível.
- Manter a validação repetida no servidor mesmo quando o formulário já validou no browser.
- Cobrir parsing, arredondamento inexistente no input manual, zero/negativo, precisão, datas-limite e mensagens de erro.

## Critérios de aceite

- [x] R$ 1.234,56 atravessa UI → string de centavos → `bigint` sem perda.
- [x] Valores zero, negativos, vazios ou malformados são rejeitados.
- [x] Datas usam `PlainDate` no domínio e `DATE`/`YYYY-MM-DD` nas boundaries.
- [x] O domínio não importa `Date` para representar data financeira.
- [x] Os schemas aceitam somente comandos serializáveis.
- [x] Os erros esperados podem ser exibidos sem expor detalhes do banco.
- [x] Existem testes unitários para Money e data.

## Subtarefas e evidências

- [x] Implementado `Money` imutável com `cents: bigint`, parsing decimal
  positivo, aritmética assinada para entries e serialização sem `float`.
- [x] Implementados parsing/formatação BRL na boundary; frações com mais de
  dois dígitos não são arredondadas e são rejeitadas.
- [x] Implementada conversão estrita `YYYY-MM-DD` ↔ `Temporal.PlainDate`, com
  rejeição de datas de calendário inválidas, datas futuras e violação da
  âncora `tracking_started_on`.
- [x] Reutilizada a validação central de UUIDv7 de `src/lib/uuidv7.ts`; não há
  um gerador de IDs paralelo no módulo.
- [x] Definidos os enums/tipos de lançamento, reversal, status, origem,
  operações e read model serializável conforme ADR-004.
- [x] Criados schemas Zod estritos e aliases consistentes para create expense,
  create income, update de descrição/categoria e cancelamento; campos de
  tenant/status/origem/efeito financeiro enviados pelo cliente são rejeitados.
- [x] Definidos `Result<T, E>`, erros estáveis e validadores puros para conta,
  categoria e evento, ocultando cross-tenant como `*_NOT_FOUND`.
- [x] Adicionados testes unitários de Money, parsing BRL, datas-limite,
  descrição, comandos estritos, erros estáveis e referências tenant-scoped.

## Verificações

- [x] `npm test -- --run src/modules/transactions/domain.test.ts
  src/modules/transactions/validation.test.ts`: 25 testes passaram.
- [x] `npm test`: 167 testes passaram; 18 testes de integração foram pulados
  por dependerem do ambiente opcional.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run db:check:files`: concluído sem divergências (T02 não altera
  schema/migrations).
- [x] ESLint focado nos arquivos da T02: concluído sem warnings.
- [!] `npm run lint` global ainda reporta warnings em arquivos paralelos da
  T09 (`src/components/transactions/*` e `src/modules/transactions/form-contract.ts`);
  não há warning nos arquivos implementados por esta task.
