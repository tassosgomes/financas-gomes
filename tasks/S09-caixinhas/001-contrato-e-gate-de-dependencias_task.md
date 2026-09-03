# T01 — Contrato, fronteira e gate de dependências

- Status: Concluída
- Onda: 0
- Dependências: S01–S08 e contratos publicados no handoff
- Paralelização: Serial; desbloqueia o slice

## Objetivo

Fechar a semântica pública e as fronteiras do S09 antes de criar tabelas,
commands, adapter ou UI. O resultado deve eliminar ambiguidades entre
Caixinha, categoria, orçamento, movimento, saldo reservado e Spendable.

## Escopo

- Comparar PRD, TechSpec, `docs/S09-caixinhas.md` e a porta existente em
  [`src/modules/spendable/reserve-adapter.ts`](../../src/modules/spendable/reserve-adapter.ts).
- Definir os nomes públicos e internos, a relação Caixinha–categoria, a regra
  de no máximo uma Caixinha ativa por categoria e o comportamento para
  categorias/caixinhas arquivadas.
- Fechar `activeFrom`, `closedOn`, reabertura ou nova vigência, consultas
  históricas e o tratamento de movimentos na data de encerramento.
- Fechar `CONTRIBUTION`, `WITHDRAWAL` e transferência entre Caixinhas: amount
  positivo, sinal carregado pelo tipo, referências únicas, correção e
  idempotência.
- Resolver a diferença entre percentuais de distribuição do PRD e
  `budget_allocation_rules.amount_cents` effective-dated da TechSpec. A regra
  final deve dizer quando uma receita realizada gera aportes, como totaliza
  100%, como arredonda e como mudanças futuras preservam o histórico.
- Definir saldo derivado, rollover positivo/negativo, despesas por categoria,
  compra parcelada pelo valor econômico total, refund pela data efetiva,
  metas/data-alvo, progresso e aporte sugerido.
- Publicar a forma exata de deduplicação com ledger/forecast e o contrato
  `s09.v1`: contexto aceito, `BOX_BALANCE_PROTECTED`, `closedOn`, saldo
  negativo, `appliedOpeningAdjustment` e referências opacas.
- Mapear comandos, erros esperados, limites de datas/valores e a autoridade
  server-side de tenancy; registrar toda alteração estrutural como ADR.

## Subtarefas

- [x] Inventariar dependências reais de S01–S08 e registrar quais contratos
  serão consumidos sem recriar ledger, forecast ou Spendable.
- [x] Publicar uma ADR do S09 com tipos serializáveis, invariantes, exemplos em
  centavos e precedência entre PRD, TechSpec e handoff S08.
- [x] Fechar a matriz de cenários: aporte múltiplo, retirada, transferência,
  rollover, saldo negativo, encerramento, receita realizada, despesa,
  parcela, refund, reserva refletida e reserva não refletida.
- [x] Atualizar `docs/S09-caixinhas.md` somente com decisões compatíveis com o
  escopo, sem deslocar o owner do provider para S08.
- [x] Executar o gate de contratos e publicar uma lista de bloqueios para T02–T15.

## Critérios de aceite

- [x] Nenhum campo ou regra essencial depende de interpretação local de uma
  task posterior.
- [x] A fórmula de saldo e o ponto em que a reserva entra no Spendable estão
  escritos em centavos e reconciliam com a porta `s09.v1`.
- [x] A política de alocação e a associação com categoria têm uma decisão
  explícita para passado, presente, futuro e ausência de configuração.
- [x] O contrato proíbe `householdId`, `userId`, conta, saldo, timeline ou
  autorização fornecidos pelo browser na porta do S08.
- [x] Os critérios de aceite do documento do S09 estão mapeados para tasks,
  testes e evidências posteriores.

## Entregáveis e evidência esperada

- [x] [`docs/adr/012-s09-caixinhas-contract.md`](../../docs/adr/012-s09-caixinhas-contract.md)
  ou ADR equivalente, com contrato versionado e exemplos.
- [x] Handoff S08 → S09 atualizado com owner, provider, fontes de movimento e
  cenários de integração.
- [x] Matriz de dependências e decisões referenciada por T02–T15.
- [x] `rtk git diff --check` e revisão de links/documentação sem ambiguidades.

## Evidências atuais e fechamento T01 (2026-09-02)

### Subtarefas, critérios e entregáveis

As cinco subtarefas foram executadas e comprovadas pelos documentos publicados
e pela auditoria abaixo. A ADR-012 fecha nomes, categoria, vigência,
movimentos, correção/idempotência, alocação, saldo/rollover, despesas,
parcelas, refunds, metas, limites, erros e a fronteira `s09.v1`. A matriz
fecha a dependência real de S01–S08, todos os cenários pedidos, os critérios
de aceite de `docs/S09-caixinhas.md` e os gates T02–T15. O handoff preserva o
owner do provider no S09 e a fórmula/API pública no S08.

### Comandos e resultados

- [x] `rtk git status --short --untracked-files=all` — confirmou os artefatos
  da T01 (`docs/adr/012-s09-caixinhas-contract.md`,
  `docs/S09-caixinhas-contract-matrix.md` e alterações em
  `docs/S09-caixinhas.md`/ADR-011); as tasks S09 já existentes permanecem
  não rastreadas/preexistentes e foram preservadas.
- [x] `rtk npm exec vitest -- run
  src/modules/spendable/reserve-adapter.test.ts --reporter=dot` — 1 arquivo,
  8 testes passaram.
- [x] `rtk npm exec eslint -- src/modules/spendable/reserve-adapter.ts
  src/modules/spendable/reserve-adapter.test.ts --max-warnings=0` — passou sem
  erros ou warnings.
- [x] `rtk npm exec tsc -- --noEmit --pretty false` — passou.
- [x] `rtk git diff --check` — passou sem whitespace inválido nos arquivos
  rastreados; a auditoria complementar de trailing whitespace também passou
  nos cinco documentos da T01.
- [x] Auditoria de links Markdown com `rtk node --input-type=module -e ...` —
  referências de arquivo válidas nos cinco documentos auditados.
- [x] Auditoria server-side com `rtk node --input-type=module -e ...` —
  `ReserveAdapterContext` contém `asOf`, `scenario` e `horizon` e não possui
  campos de autoridade `householdId`, `userId`, `accountId`, `timeline`,
  `authorization` ou `balance`.

### Gates que permanecem abertos

- T02–T15 do S09 permanecem abertos, conforme a matriz; esta T01 não declara
  schema, domínio executável, queries, use cases, provider integrado, UI,
  observabilidade S09, testes PostgreSQL/E2E ou release concluídos.
- A implementação de persistência/CRUD e os cinco cenários com dados reais de
  Caixinhas dependem das tasks posteriores; nenhum checkbox dessas tasks foi
  alterado por T01.
- A promoção E2E global do S08 continua aberta por falha externa já registrada
  em [`T13 S08`](../../tasks/S08-disponivel-para-gastar/013-validacao-release-handoff-s09_task.md):
  última execução `24 passed`, `1 failed` em
  `tests/e2e/forecast.spec.ts:423` (S07/T12). A falha não contradiz a porta
  S09 e não foi corrigida neste escopo.

Com os critérios aplicáveis provados e os gates downstream explicitamente
separados, a T01 fica **Concluída**.

## Fora de escopo

Criar migration, implementar use case, consultar saldo, alterar a fórmula do
S08 ou construir qualquer tela.
