# T08 — Adaptador de reservas e handoff para S09

- Status: Concluída
- Onda: 2, integração diferida
- Dependências: T01
- Paralelização: Com T06/T07

## Objetivo

Preparar a integração de caixinhas sem bloquear S08 e sem assumir um saldo
persistido que S09 ainda não oferece.

## Escopo

- Definir interface versionada para componentes de reserva protegida,
  discriminados por regra/caixinha e em `Money`; a implementação pré-S09
  devolve vazio/zero de modo explícito.
- Definir contrato de S09 para saldo derivado de movimentos, status de
  caixinha, referências opacas, data de corte e comportamento de aporte,
  retirada/encerramento.
- Registrar testes de integração que S09 deverá habilitar: reserva reduz o
  bruto uma vez, retirada aumenta uma vez, saldo negativo/encerrado segue a
  decisão de T01 e recursos restritos não são somados ao global.
- Atualizar o handoff de S09 com o proprietário da implementação final; não
  criar tabelas ou CRUD de caixinhas neste slice.

## Critérios de aceite

- [x] S08 entrega normalmente sem S09 e o output declara a ausência de reserva.
- [x] S09 pode plugar a fonte sem mudar API pública ou duplicar despesas.

## Subtarefas

- [x] Publicar a porta server-side versionada `s09.v1`, com componentes
  discriminados por regra/caixinha, `Money`/`bigint` no domínio e strings na
  serialização.
- [x] Implementar `ZeroReserveAdapter` com `UNAVAILABLE`, zero explícito e
  lista de componentes vazia, sem dependência de tabelas ou CRUD.
- [x] Definir o contrato de S09 para movimentos `CONTRIBUTION`/`WITHDRAWAL`,
  saldo derivado e assinado, status effective-dated, encerramento e
  referências opacas.
- [x] Implementar adaptador puro de movimentos com deduplicação contra
  referências já refletidas no ledger/forecast e sem aumentar spendable por
  saldo negativo/caixinha encerrada.
- [x] Registrar no handoff os cenários de integração de S09 (reserva uma vez,
  retirada uma vez, negativo/encerrada, `RESTRICTED`/`EXCLUDED`) e o owner da
  implementação final.
- [x] Executar testes focados, typecheck, lint e `git diff --check`; marcar a
  task concluída somente com todas as evidências abaixo.

## Entregáveis e evidências

- [x] [`src/modules/spendable/reserve-adapter.ts`](../../src/modules/spendable/reserve-adapter.ts)
  expõe `SpendableReserveAdapter`, `ZeroReserveAdapter`,
  `MovementReserveAdapter`, `deriveReserveSnapshot` e a serialização pública.
  A porta não recebe `householdId` nem autoridade do client.
- [x] [`src/modules/spendable/reserve-adapter.test.ts`](../../src/modules/spendable/reserve-adapter.test.ts)
  cobre zero pré-S09, proteção uma vez, retirada/release uma vez,
  referências refletidas, saldo negativo, encerramento effective-dated,
  cutoff e referências duplicadas.
- [x] [`docs/S09-caixinhas.md`](../../docs/S09-caixinhas.md) contém o owner,
  contrato de movimentos e os cenários que o S09 deve habilitar; não há
  migration, tabela ou CRUD criado por T08.
- [x] [`docs/adr/011-s08-spendable-contract.md`](../../docs/adr/011-s08-spendable-contract.md)
  referencia a porta e fixa a semântica de `BOX_BALANCE_PROTECTED`, saldo
  negativo e encerramento sem alterar `spendable.v1`.

### Auditoria de fechamento T08 (2026-09-01)

- [x] `rtk npm exec vitest -- run src/modules/spendable/reserve-adapter.test.ts
  --reporter=dot` — 8/8 testes passaram.
- [x] `rtk npm exec vitest -- run src/modules/spendable --reporter=dot` —
  4 arquivos e 26 testes passaram.
- [x] `rtk npm exec eslint -- src/modules/spendable/reserve-adapter.ts
  src/modules/spendable/reserve-adapter.test.ts --max-warnings=0` — sem
  erros ou warnings.
- [x] `rtk npm exec tsc -- --noEmit --pretty false` — typecheck passou.
- [x] `rtk git diff --check` — sem whitespace inválido.

Os testes de PostgreSQL/CRUD e a habilitação dos cenários com dados reais de
caixinhas permanecem explicitamente no slice S09, sob responsabilidade do
owner indicado no handoff. T08 entrega a porta e seus testes puros sem
integrar T06 nem criar persistência.

## Resultado

T08 fica pronta para encerramento após a auditoria acima: S08 usa o zero
explícito enquanto S09 não existe, e a implementação de movimentos pode ser
plugada pelo contrato versionado sem pós-subtrair reserva nem duplicar
despesas.

## Fora de escopo

Persistir caixinhas, criar migrations/tabelas, CRUD, UI de S09 ou integrar a
porta no serviço/query de T06.
