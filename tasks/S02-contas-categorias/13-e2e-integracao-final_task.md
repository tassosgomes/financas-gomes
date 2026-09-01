# T13 — Executar E2E, integração final e gate de entrega

## Status

Bloqueada em 2026-08-29 — o fluxo E2E S02 isolado passa, mas a suíte E2E crítica completa
precisa ser reexecutada após o aumento do timeout do fluxo (a última execução
completa expirou no limite padrão de 30 s durante o reload; a reexecução foi
interrompida antes de produzir resultado). Os demais gates executados passam.

## Objetivo

Validar o slice como fluxo completo e confirmar que ele está pronto para ser integrado ao próximo slice.

## Dependências

- T08 concluída;
- T09 concluída;
- T10 concluída;
- T11 concluída;
- T12 concluída.

## Pode ser paralelizada?

Não. É a etapa final de integração e aceite.

## Escopo

1. Criar fluxo E2E básico com Playwright:
   1. autenticar;
   2. abrir Contas;
   3. criar uma conta;
   4. confirmar a conta na listagem;
   5. abrir Categorias em Configurações;
   6. criar uma categoria;
   7. editar o nome da categoria;
   8. arquivar a categoria;
   9. confirmar que ela não aparece na listagem ativa.
2. Executar o gate de CI:
   - lint;
   - typecheck;
   - testes unitários;
   - testes de integração;
   - build;
   - E2E crítico.
3. Validar migrations em ambiente limpo e sobre o estado do S01/Slice 1.
4. Revisar manualmente:
   - empty states;
   - mensagens de erro;
   - responsividade básica;
   - acessibilidade dos formulários;
   - ausência de saldo/ledger indevido no escopo.
5. Confirmar todos os critérios de aceite do S02.
6. Registrar pendências que pertencem aos próximos slices, sem ampliar o escopo durante o fechamento.

## Subtarefas verificadas

- [x] autenticação E2E e abertura da rota `/accounts`;
- [x] criação de conta e confirmação da conta na listagem ativa;
- [x] abertura de Categorias pelo menu Configurações;
- [x] criação, edição e arquivamento de categoria;
- [x] confirmação de que a categoria arquivada sai da listagem ativa e permanece
  disponível no histórico;
- [x] lint, typecheck, testes unitários, testes de integração e build (gates
  não-E2E);
- [x] consistência dos arquivos de migration e status do banco de teste;
- [x] revisão estática dos estados vazio/erro, formulários acessíveis,
  responsividade por breakpoints e ausência de saldo/ledger no slice;
- [x] pendências futuras registradas: saldo, ledger e lançamentos permanecem
  fora do escopo do S02;
- [ ] suíte E2E crítica completa (autenticação + fluxo S02) após o ajuste de
  timeout.

## Critérios de conclusão

- [x] fluxo E2E de conta passa;
- [x] fluxo E2E de categoria passa;
- [ ] todos os testes e o build passam;
- [x] migrations são reproduzíveis;
- [x] isolamento cross-tenant está coberto por integração;
- [x] entidades arquivadas são preservadas e filtradas;
- [x] Sentry/logs estão sanitizados;
- [ ] Definition of Done do índice está satisfeita.

## Referências

- [`S02 — Critérios de aceite`](../../docs/S02-contas-categorias.md#critérios-de-aceite);
- [`E2E`](../../docs/techspec.md#116-testes);
- [`CI`](../../docs/techspec.md#110-ci);
- [`Vertical slices`](../../docs/techspec.md#117-vertical-slices-de-implementação).
