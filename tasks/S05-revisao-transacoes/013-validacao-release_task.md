# T13 — Validação de release

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento — auditoria e gates locais seguros concluídos em 2026-08-30; compatibilidade S03/S05 com enums ampliados revalidada, mas o typecheck global permanece bloqueado por S06; fechamento segue bloqueado por T11/T12, gaps de EXPLAIN e ausência de smoke publicado
- Onda: 5
- Dependências: T03, T10, T11 e T12
- Paralelização: Não; fechamento serial

## Subtasks

- [x] Consumir os handoffs de T03, T10, T11 e T12 e revisar as ressalvas
  atuais sem promover o slice enquanto T11/T12 estiverem abertas.
- [x] Auditar a Definition of Done de `tasks.md`, os critérios de aceite de
  `docs/S05-revisao-transacoes.md` e a ADR-006 contra as evidências disponíveis.
- [!] Executar os gates locais seguros que não iniciam E2E nem benchmark:
  `rtk npm run db:check:files`, `db:migrate:status`, `db:check`, `lint`,
  `typecheck` e a suíte unitária. Os módulos S05 estão sem os diagnósticos de
  enum, mas o typecheck global permanece bloqueado por
  `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts`
  (S06), fora do escopo desta task.
- [x] Conferir migration e integridade no PostgreSQL local por comandos
  read-only; a prova em banco vazio/representativo permanece referenciada no
  handoff de T03/T11.
- [x] Revisar os planos/medições de performance e a allow-list de
  observabilidade já registrados por T10/T11, mantendo explícitas as lacunas
  de EXPLAIN completo e Sentry publicado.
- [ ] Reexecutar regressão PostgreSQL completa, build e E2E após T11/T12
  resolverem seus bloqueios compartilhados; não executar esses gates neste
  checkout enquanto a boundary de actions e o planner de T11 permanecem
  pendentes.
- [ ] Executar smoke publicado do fluxo de revisão e confirmar a origem/
  linhagem após edição; não há URL, credenciais ou ambiente publicado
  autorizados neste checkout.
- [x] Conferir que rollout/rollback forward-only, variáveis e retenção estão
  documentados em `docs/database.md` e `docs/production-deploy.md`.
- [ ] Emitir decisão final de release e handoff somente depois dos itens
  bloqueados acima terem evidência válida.

## Objetivo

Confirmar que S05 pode ser liberado sem perda de origem, regressão do ledger,
falha de isolamento ou degradação evidente da revisão sobre extratos reais.

## Escopo

- Revisar o checklist de T01 e a Definition of Done do slice; resolver
  pendências ou registrar decisão explícita antes de marcar o release.
- Executar em banco vazio e banco representativo:
  - `rtk npm run db:check:files`;
  - `rtk npm run db:migrate:status`;
  - migration de T03;
  - `rtk npm run lint`;
  - `rtk npm run typecheck`;
  - `rtk npm test`;
  - integração PostgreSQL;
  - `rtk npm run test:e2e`;
  - `rtk npm run build`.
- Fazer smoke test publicado: importar fixture S04, abrir pendências, filtrar,
  editar categoria/descrição, abrir detalhe, conferir origem/linhagem e
  retornar à lista preservando contexto.
- Verificar que S03 continua criando/editando/cancelando lançamentos manuais e
  que S04 continua confirmando importações, sem duplicidade ou mudança de
  semântica.
- Revisar planos/medição de T11 e confirmar que paginação e filtro de revisão
  são aceitáveis no volume acordado. Documentar qualquer limitação da busca
  textual simples.
- Revisar Sentry/logs/breadcrumbs com a allow-list de T10; confirmar ausência
  de valores, descrições, nomes, busca, external IDs, CSV, tokens e payloads.
- Registrar rollout/rollback da migration, variáveis necessárias e procedimento
  de limpeza/retensão de dados de teste.

## Critérios de aceite

- [x] Migration aplicada sem divergência e sem órfãos no alvo PostgreSQL local:
  `db:migrate:status`/`db:check` retornaram `12/0/0` e a consulta read-only
  encontrou zero linhas em `financial_events`, `account_entries`,
  `transaction_imports`, `transaction_import_items` e nos três checks de
  órfãos. T03 também registra aplicação em banco vazio/existente, rollback
  controlado e ausência de perda de dados em fixture sintética.
- [!] Gates locais unitários e lint têm evidência histórica; o typecheck global
  não está verde nesta revisão por diagnósticos externos de S06 em
  `src/db/financial-events-schema.ts` e `src/modules/observability/s06.ts`.
  O pipeline final também não está verde: a regressão PostgreSQL de T11 ficou em 76/77 por uma
  expectativa de `Index Scan` em T03, 77 testes de integração permanecem
  opt-in no `npm test`, T12 está bloqueada na boundary de actions e o build
  não foi reexecutado neste checkout compartilhado.
- [ ] Smoke test comprova o fluxo de revisão manual/importado e a preservação
  da origem após edição; T12 ainda não produziu evidência de browser e não há
  ambiente publicado autorizado.
- [x] Isolamento cross-tenant, idempotência e campos somente leitura foram
  comprovados nos testes focados PostgreSQL/unitários de T04/T05; a validação
  da suíte final continua condicionada à resolução do bloqueio de T11/T12.
- [!] Observabilidade local/redaction e os cinco planos de volume sintético
  estão registrados por T10/T11, mas o EXPLAIN das quatro formas completas de
  T04 e a inspeção de Sentry publicado permanecem pendentes.
- [ ] Tasks e ADR do slice apontam evidências finais e o handoff de release
  está pronto; T11/T12 e o smoke publicado ainda precisam fechar.

## Auditoria da Definition of Done do slice (2026-08-30)

Os itens funcionais abaixo têm evidência local em T03–T11, mas isso não é uma
decisão de release: a validação final ainda depende de T11/T12 e do smoke
publicado. O último item permanece aberto porque E2E/smoke ainda não foram
comprovados.

- [x] A lista reúne `MANUAL` e `IMPORT` do household atual e exclui
  `SYSTEM`/`REVERSAL` como itens independentes — T04-B e integração de reads.
- [x] Filtros de período, conta, categoria (inclusive nula), tipo, status,
  origem, revisão e busca simples — T04-B e 6 testes PostgreSQL dedicados.
- [x] Indicador/consulta tenant-scoped de `NEEDS_REVIEW` — resumo e filtro de
  T04, componentes de T08 e testes de categoria nula.
- [x] Cursor keyset, ordenação estável e volume representativo — T04/T11;
  volume sintético de 10.000 importados + 100 manuais e cinco planos JSON.
- [x] Categoria/descrição são atualizadas sem recriar evento ou entry — T05 e
  os testes de update manual/importado.
- [x] Command idempotente, validação tenant/tipo/status e preservação de
  origem/linhagem S04 — T05 e integrações focadas.
- [x] Lista/detalhe expõem origem e linhagem permitida sem CSV bruto/token —
  T04/T08/T09 e testes de projeção/redaction.
- [x] Isolamento, null, update, origem, linhagem, paginação e performance
  básica têm cobertura automatizada; a regressão completa de T11 ainda tem o
  bloqueio externo documentado.
- [x] Logs/redaction seguem a allow-list de T10 nos testes locais, sem valor,
  descrição, nomes, busca, external ID, cursor decodificado, CSV ou token.
- [!] Migration/checks e documentação CI estão presentes, mas E2E, smoke
  publicado e pipeline/build final ainda não têm evidência válida.

### Retificação do gate de compatibilidade — 2026-08-30

- [x] `reads.ts`, `review-reads.ts`, `review-use-cases.ts` e `use-cases.ts`
  foram reparados com narrowing fail-closed, mantendo as invariantes S03/S05
  diante de `PLANNED|EXPECTED|PENDING|PURCHASE|TRANSFER`.
- [!] O release não pode declarar typecheck global verde enquanto S06 mantiver
  os diagnósticos em `financial-events-schema.ts` e `observability/s06.ts`;
  T13 não altera esses arquivos. E2E/smoke publicado continuam pendentes.

## Auditoria dos critérios de aceite de `docs/S05-revisao-transacoes.md`

- [x] Encontrar lançamentos sem categoria: read model de T04 e summary
  tenant-scoped cobertos nos testes focados.
- [x] Alterar categoria sem recriar a transação: T05 comprova update de
  metadata preservando o evento/entry.
- [x] Preservar origem do lançamento: T03/T05 comprovam `origin=IMPORT` e
  linhagem após atualização.
- [x] Filtros limitados ao espaço atual: T04/T05 cobrem isolamento e erro
  opaco cross-tenant.
- [x] Lista permanece limitada/paginada em volume sintético representativo:
  T11 mede 10.000 importados + 100 manuais; a validação visual/E2E permanece
  em T12.

## Fora de escopo

Não introduzir reconciliação bancária, regras automáticas, IA, auditoria
granular, importação de novos formatos ou correções financeiras complexas como
parte do gate de S05.
