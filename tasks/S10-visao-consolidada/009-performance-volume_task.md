# T09 — Performance, índices e volume representativo

- Status: Não iniciada
- Onda: 2
- Dependências: T06; observabilidade de T04
- Paralelização: Com T07 e T08

## Objetivo

Garantir que a home carregue de forma previsível com volume representativo,
usando índices adequados e sem introduzir cache que comprometa a consistência
da V1.

## Escopo

- Construir um seed determinístico de volume representativo (vários meses de
  transações, cartões com faturas e parcelas, caixinhas com movimentos,
  recorrências e itens de forecast) reutilizável por T13/T14.
- Medir `EXPLAIN (ANALYZE)` das consultas da home e registrar plano, índice
  usado e tempo por bloco.
- Criar/ajustar índices apenas quando o plano provar necessidade, com migration
  revisada e sem alterar a semântica de nenhuma tabela.
- Definir e validar o orçamento de tempo por bloco e o limite de "query lenta"
  usado por T04.
- Confirmar que as leituras rodam em paralelo e que nenhuma origem é chamada
  mais de uma vez por render.
- Evitar cache na V1; se algum cache for indispensável, registrar a decisão em
  T01/ADR-013 com invalidação explícita e prova de consistência.

## Subtarefas

- [ ] Escrever o seed de volume representativo com dados determinísticos.
- [ ] Medir e registrar os planos de consulta antes de qualquer otimização.
- [ ] Aplicar índices necessários via migration versionada e reexecutar as
  medições.
- [ ] Ajustar limites de lentidão e alimentá-los em T04.
- [ ] Documentar os resultados e o método de medição.

## Critérios de aceite

- [ ] Os planos de consulta da home usam índices tenant-aware e não fazem
  varredura completa em tabela de eventos com volume representativo.
- [ ] O tempo por bloco fica dentro do orçamento declarado, com medição
  reproduzível registrada na task.
- [ ] Nenhuma otimização altera número exibido ou semântica de agregado.
- [ ] Nenhum cache foi introduzido sem decisão registrada.
- [ ] O seed é reutilizável por T13 e T14 sem duplicação.

## Entregáveis e evidência esperada

- [ ] Seed determinístico em `tests/fixtures/s10-visao-consolidada/`.
- [ ] Registro de `EXPLAIN (ANALYZE)` antes/depois na própria task.
- [ ] Migration de índice, quando necessária, com `db:check` aprovado.
- [ ] `vitest` de integração opt-in e `tsc` aprovados.

## Sequenciamento

- Bloqueado por: T06.
- Desbloqueia: T13, T14, T15.
- Paralelizável: sim, com T07 e T08.

## Fora de escopo

Materialized view, cache distribuído, tuning de infraestrutura de produção.
