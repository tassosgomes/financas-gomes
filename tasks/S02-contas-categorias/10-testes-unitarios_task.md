# T10 — Criar testes unitários

## Status

Concluída — 77 testes unitários de domínio adicionados/verificados em
2026-08-29.

## Objetivo

Provar rapidamente as regras de domínio e evitar regressões nas validações de contas e categorias.

## Dependências

- T03 concluída ou com contratos estáveis.

## Pode ser paralelizada?

Sim. Pode acompanhar T05 e T06 e ser executada em paralelo com T07–T12.

## Escopo

Usando Vitest, cobrir pelo menos:

### Contas

- nome ausente, vazio ou inválido;
- tipos permitidos e rejeitados;
- status permitido;
- campos imutáveis;
- transição para arquivado;
- defaults definidos em T01.

### Categorias

- nome ausente, vazio ou inválido;
- `EXPENSE` e `INCOME`;
- pai nulo;
- pai válido;
- pai de outro household;
- categoria sendo pai de si mesma;
- terceiro nível;
- reparenting de categoria utilizada;
- arquivamento.

### Comum

- normalização de nomes;
- códigos de erros esperados;
- idempotência no nível do comando, quando houver regra de domínio associada.

## Critérios de conclusão

- [x] regras principais possuem testes positivos e negativos;
- [x] testes não dependem de banco ou sessão real;
- [x] mensagens/códigos não são usados como único contrato quando um tipo de erro é possível;
- [x] suíte roda no CI;
- [x] cada bug encontrado no slice gera teste de regressão.

## Subtarefas verificadas

- [x] Cobertos nomes ausentes, vazios, normalização Unicode, caracteres de
  controle e limite de code points para contas e categorias.
- [x] Cobertos enums permitidos/rejeitados de contas, status, metadados de
  conta e `kind` de categoria, com códigos e campos de erro estáveis.
- [x] Cobertos defaults de conta, `commandId` aparado/bounded, updates vazios
  e rejeição de campos persistidos imutáveis.
- [x] Cobertos criação de categoria raiz (`parentId` ausente/nulo), pai válido,
  pai ausente ou de outro household, auto-pai e profundidade máxima.
- [x] Cobertos reparenting de categoria utilizada, aliases de uso,
  renomeação permitida, requests idempotentes e invariantes combinadas de
  update sem persistência.
- [x] Cobertos arquivamento de contas/categorias, proteção de recursos já
  arquivados e bloqueio de arquivamento de pais com filhos ativos.
- [x] Cobertos `Result` serializáveis, tipo `S02DomainError`, fallback seguro e
  determinismo de parsing para retries, sem banco, sessão ou mocks de infra.
- [x] Rodados os 77 testes focados e a suíte unitária completa: 123 passaram e
  12 foram omitidos por gates de integração, sem falhas.

## Referências

- [`Testes unitários`](../../docs/techspec.md#116-testes);
- [`Validation`](../../docs/techspec.md#80-validação);
- [`S02 — Testes`](../../docs/S02-contas-categorias.md#testes).
