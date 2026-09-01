# T12 — Implementar observabilidade e tratamento de erros

## Status

Concluída — erros, logs e sanitização verificados em 2026-08-29.

## Objetivo

Permitir diagnosticar falhas do CRUD sem transformar logs ou Sentry em cópia dos dados financeiros do usuário.

## Dependências

- T05 concluída;
- T06 concluída;
- T07 concluída;
- Sentry do S01 disponível.

## Pode ser paralelizada?

Sim. Pode rodar em paralelo com T08, T09 e T11.

## Escopo

1. Tratar erros esperados na UI:
   - validação;
   - não encontrado;
   - recurso arquivado;
   - conflito de edição/reparenting;
   - falha de autorização/contexto.
2. Enviar exceções inesperadas ao Sentry.
3. Adicionar contexto técnico mínimo aos logs:
   - operação/use case;
   - tipo de entidade;
   - ID opaco;
   - duração;
   - ambiente/release quando disponível.
4. Não registrar ou enviar:
   - nome da conta ou categoria;
   - valores monetários;
   - notas ou descrições financeiras;
   - cookies, tokens ou Authorization;
   - payload completo do formulário.
5. Garantir que falhas do backend tenham correlação suficiente para suporte sem expor dados sensíveis ao usuário.

## Critérios de conclusão

- [x] erros esperados não geram exceções ruidosas;
- [x] exceções inesperadas aparecem no Sentry;
- [x] payloads enviados ao Sentry estão sanitizados;
- [x] logs permitem distinguir create/list/update/archive;
- [x] UI exibe mensagem útil sem detalhes internos;
- [x] há teste ou inspeção automatizada para evitar campos sensíveis no contexto.

## Subtarefas verificadas

- [x] Adicionada telemetria server-side aos oito adapters CRUD de T07, com
  operação (`create`, `list`, `update`, `archive`), tipo de entidade, duração,
  ambiente/release e correlação por ID técnico gerado no servidor.
- [x] Erros de validação, contexto, não encontrado, arquivamento e conflitos
  continuam atravessando somente o envelope `S02Result`; falhas inesperadas
  são capturadas e relançadas para a UI genérica sem detalhes internos.
- [x] Logs usam allow-list de campos e JSON estruturado; payloads, nomes,
  valores, notas, cookies, tokens, Authorization e objetos `Error` são
  descartados antes de chegar ao console.
- [x] Contexto CRUD enviado ao Sentry usa somente metadados operacionais; a
  fronteira `beforeSend` mantém allow-list e remove mensagens, request body,
  query, headers, usuário, extras e metadados SDK não necessários.
- [x] Criados testes para sanitização dos logs, ausência de dados financeiros,
  captura de falha inesperada e reenvio seguro do erro à camada de UI.
- [x] Verificados testes Vitest completos (126 passaram, 18 opt-in foram
  pulados), typecheck e ESLint isolado dos arquivos alterados.

## Referências

- [`Observabilidade`](../../docs/techspec.md#102-observabilidade);
- [`Logs`](../../docs/techspec.md#103-logs);
- [`Erros`](../../docs/techspec.md#77-erros);
- [`S02 — Observabilidade`](../../docs/S02-contas-categorias.md#observabilidade).
