# T01 — Contrato da fórmula e gate de S07

- Status: Concluída
- Onda: 0
- Dependências: S01–S07 concluídos e seus contratos publicados
- Paralelização: Serial; desbloqueia o slice

## Objetivo

Formalizar em tipos, exemplos de tabela e casos de aceitação a semântica única
de `Spendable`, antes de consultas, engine ou telas.

## Subtarefas

- [x] Revisar o contrato publicado de S07, o ledger de S01–S03, spendability de
  S02, cartões de S06 e as seções 15–16/48–57 da TechSpec.
- [x] Publicar ADR-011 com `GetSpendableInput`, `SpendableBreakdown`, fórmula,
  invariantes, matriz de centavos e handoff para T02–T13.
- [x] Fechar `asOf`, cenário, horizonte, saldo de abertura, participação do
  ponto inicial no mínimo, resultado negativo e empate de pontos.
- [x] Decidir buffer operacional, ausência, efetividade histórica,
  migration/versionamento e escopo tenant-safe.
- [x] Fechar GENERAL/RESTRICTED/EXCLUDED, cartões, fontes previstas e a porta
  neutra de reservas para S09 sem dupla contagem.
- [x] Executar verificações do gate e registrar evidência sem marcar tasks de
  outras ondas.

## Escopo

- Confirmar que S07 publica timeline consolidada, cenário, data de referência,
  saldo inicial e itens explicáveis, incluindo parcelas futuras uma única vez.
- Fechar o contrato `GetSpendableInput` (`asOf`, cenário conservador/esperado,
  horizonte) e `SpendableBreakdown` (`raw`, `display`, déficit, buffer,
  mínimo, pontos/itens causais, versão de regra e metadados de período).
- Registrar as fórmulas e os casos `positivo`, `zero`, `raw negativo`, eventos
  no mesmo dia e horizonte sem eventos. Definir o significado de saldo inicial
  e se o ponto inicial participa do mínimo.
- Definir a semântica inicial de `operational_buffer_cents`, configuração
  ausente e mudanças de configuração; decidir se precisa de migration/versionamento.
- Determinar o tratamento de GENERAL, RESTRICTED e EXCLUDED, cartões e fontes
  previstas; deixar explícita a exclusão de recursos restritos do global.
- Especificar a porta de reservas de S09 com implementação neutra/zero e a
  regra de não dupla contagem quando S09 a preencher.

## Critérios de aceite

- [x] Não há campo ou fórmula ambígua para UI, serviço ou testes.
- [x] Os exemplos reconciliam em centavos e registram resultado bruto, exibido
  e déficit para o caso negativo.
- [x] Contrato de S07 é suficiente para o handoff: a timeline `s07.v1` fornece
  os compromissos e o adapter S08 fornece a abertura `GENERAL` antes do replay;
  o uso da abertura household-wide do S07 como spendable foi explicitamente
  proibido.
- [x] Decisões que alterem a TechSpec são registradas por ADR, não implícitas
  na implementação.

## Entregáveis e evidência

- [x] [`docs/adr/011-s08-spendable-contract.md`](../../docs/adr/011-s08-spendable-contract.md)
  é o contrato normativo `s08.v1`/`spendable.v1`, com tipos serializáveis,
  fórmulas, casos positivo/zero/negativo, mesmo dia, horizonte sem eventos,
  parcelas, classes de recurso, buffer e reserva S09.
- [x] [`docs/S08-disponivel-para-gastar.md`](../../docs/S08-disponivel-para-gastar.md)
  referencia a ADR-011 como contrato do slice.
- [x] O gate de S07 foi conferido em
  `src/modules/forecast/contracts.ts`, `src/modules/forecast/sources.ts`,
  `src/modules/forecast/builder.ts` e `src/modules/forecast/engine.ts`:
  `s07.v1`, itens/reconciliação, abertura até `from - 1`, parcelas por
  `installmentId`, agregação diária e referências do mínimo estão publicados.
- [x] Os links de handoff da ADR-011 apontam para as tasks S08 existentes; a
  decisão de migration de configuração ficou registrada sem criar migration
  nesta task.

## Auditoria de fechamento T01 (2026-09-01)

- [x] `rtk git diff --check` passou após a publicação do ADR e do link no
  documento do S08.
- [x] `rtk npm exec vitest -- run src/modules/forecast/contracts.test.ts
  src/modules/forecast/engine.test.ts src/modules/forecast/builder.test.ts
  src/modules/forecast/service.test.ts --reporter=dot` passou: 4 arquivos,
  36/36 testes. A suíte confirma o contrato que T01 entrega ao S08.
- [x] Nenhum código de consulta, engine, migration, reservas, UI ou teste de
  S08 foi implementado nesta task; esses trabalhos permanecem nas tasks
  correspondentes do handoff.

## Resultado do gate

T01 está concluída e libera semanticamente T02–T13 conforme as dependências de
[`tasks.md`](tasks.md). T06 deve respeitar a abertura `GENERAL` e a
configuração effective-dated definidas na ADR-011; T08 deve manter o
`ZeroReserveAdapter` até S09. A conclusão deste gate não declara S08 entregue.

## Fora de escopo

Implementar forecast, caixinhas ou uma tela.
