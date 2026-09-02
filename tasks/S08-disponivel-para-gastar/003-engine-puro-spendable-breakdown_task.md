# T03 — Engine puro de spendable e breakdown

- Status: Concluída
- Onda: 1
- Dependências: T01 e T02
- Paralelização: Com T04 e T05

## Objetivo

Implementar uma função determinística que calcula o menor saldo projetado e
um breakdown reconciliável, sem acesso a banco ou conhecimento de origem.

## Subtarefas

- [x] Revisar o contrato `s08.v1`/`spendable.v1` da ADR-011 e as formas
  normalizadas publicadas em T02.
- [x] Implementar o replay determinístico da timeline e o cálculo de
  `rawSpendable`, `displaySpendable` e déficit, incluindo abertura, buffer e
  reserva.
- [x] Preservar pontos/items causais do mínimo, inclusive empates, em ordem
  determinística e serializável.
- [x] Cobrir precisão, zero, negativo, intradia, horizonte vazio, limites de
  data e entradas incertas com testes unitários puros.
- [x] Executar verificações focadas, registrar evidências e concluir a task
  somente após os critérios de aceite estarem comprovados.

## Escopo

- Aplicar a timeline diária ao saldo de abertura, encontrar o menor saldo no
  horizonte e calcular `rawSpendable`, `displaySpendable` e déficit.
- Preservar os itens/pontos que explicam o mínimo, inclusive empates, em uma
  ordem determinística e serializável.
- Aplicar cenário/horizonte/buffer recebidos, sem defaults ocultos e sem
  `max(0)` antes de registrar o déficit.
- Cobrir precisão, zero, negativo, agrupamento intradiário, horizonte vazio,
  limites de data e entradas incertas em testes unitários puros.

## Critérios de aceite

- [x] `minimumProjectedBalance - buffer = rawSpendable` em todo resultado.
- [x] O bruto negativo retorna `display=0` e déficit positivo equivalente.
- [x] O engine é puro, livre de SQL, sessão, React e mutação de entrada.

## Entregáveis e evidência (2026-09-01)

- [x] [`src/modules/spendable/engine.ts`](../../src/modules/spendable/engine.ts)
  implementa o replay puro da timeline normalizada, exige buffer/reserva
  explícitos, agrega itens por dia antes de alterar o saldo, preserva abertura,
  pontos causais empatados e calcula bruto, exibido e déficit em `bigint` antes
  de serializar centavos.
- [x] [`src/modules/spendable/engine.test.ts`](../../src/modules/spendable/engine.test.ts)
  cobre positivo, zero, déficit, intradia, horizonte sem eventos, empates de
  abertura/fechamento, cenário incerto, precisão fora do safe integer, virada
  de ano, reserva, entradas inválidas, não mutação e a sobrecarga de itens.
- [x] [`src/modules/spendable/index.ts`](../../src/modules/spendable/index.ts)
  exporta o engine e aliases de cálculo para o handoff da leitura vertical.
- [x] `rtk npm exec vitest -- run src/modules/spendable --reporter=dot` — 5
  arquivos, 37/37 testes passaram.
- [x] `rtk npm exec tsc -- --noEmit --pretty false --incremental false` — sem
  diagnósticos TypeScript.
- [x] `rtk npm exec eslint -- src/modules/spendable/engine.ts
  src/modules/spendable/engine.test.ts src/modules/spendable/index.ts
  --max-warnings=0` — sem erros ou warnings.
- [x] `rtk git diff --check` — sem erros de whitespace.

T06 permanece responsável pela query/serviço tenant-safe; esta task entrega
somente o engine puro e seu contrato de cálculo.
