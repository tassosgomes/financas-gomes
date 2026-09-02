# T12 — Testes E2E da consulta de disponibilidade

- Status: Concluída
- Onda: 4
- Dependências: T09, T10 e T11
- Paralelização: Posterior ao contrato final de telas

## Objetivo

Validar o fluxo que o usuário vê: consultar o card, abrir a composição e
compreender um déficit ou uma disponibilidade positiva.

## Escopo

- Criar dados determinísticos para caso positivo, zero e déficit; conferir
  período/horizonte, card e reconciliação do breakdown.
- Cobrir compromisso futuro/parcelas e entrada futura conforme cenário, além
  de fallback de erro/configuração ausente.
- Verificar navegação por teclado e ação de origem quando disponível.
- Executar em dois households para comprovar que a interface não apresenta
  valores ou referências de outro espaço.

## Subtarefas

- [x] Preparar fixtures determinísticas e autenticação de dois households para
  os cenários positivo, zero e déficit, incluindo parcelas/compromissos e
  entradas futuras.
- [x] Implementar a spec E2E do fluxo card → breakdown, cobrindo período,
  horizonte, reconciliação, navegação por teclado e origem autorizada.
- [x] Cobrir fallback de erro/configuração ausente e garantir que o caso
  negativo exiba R$ 0 gastável com déficit correto.
- [x] Verificar isolamento entre households no browser, sem vazamento de
  valores, referências ou identificadores.
- [x] Executar as verificações proporcionais, registrar evidências e concluir
  somente após todos os critérios de aceite passarem.

## Critérios de aceite

- [x] Fluxo crítico passa em browser sem depender de cálculo no cliente.
- [x] O caso negativo mostra R$ 0 gastável e déficit correto.

## Entrega e evidências (2026-09-01)

- [x] [`tests/e2e/spendable.spec.ts`](../../tests/e2e/spendable.spec.ts)
  implementa a jornada server-first card → breakdown com seis cenários: valor
  positivo com compromisso e entrada futura, zero, déficit, parcelas futuras,
  configuração ausente/erro opaco e isolamento entre dois households.
- [x] O cenário positivo valida período, cenário conservador/esperado,
  horizonte de 90 dias, reconciliação, itens causais, ativação por teclado e
  navegação para a origem autorizada. Os lançamentos/compromissos são criados
  pela UI com identidades sintéticas do provedor Google E2E.
- [x] Os cenários zero/déficit validam `Pode gastar: R$ 0,00`, ausência de
  negativo no indicador, bruto negativo somente na composição e déficit exato.
- [x] O cenário de parcelas cria uma compra 2x pela UI, confirma duas
  ocorrências na projeção e reconhece somente `Parcela de cartão` na
  composição causal, sem duplicar compra/pagamento.
- [x] O cenário de isolamento cria dados distintos em A/B, confirma valores
  distintos, rejeita referência de origem B quando consultada por A e ignora
  `householdId` fornecido na URL sem renderizar marcador estrangeiro.
- [x] `rtk env E2E_PORT=3212 E2E_NEXT_DIST_DIR=.next-e2e-s08 npm run test:e2e --
  tests/e2e/spendable.spec.ts --reporter=line` — **6/6 passaram em 4,4 min**
  no PostgreSQL dedicado de teste (`localhost:5433`).
- [x] Execuções focadas Playwright: positivo **1/1 em 1,4 min**; zero/déficit
  **2/2 em 1,6 min**; parcelas **1/1 em 1,6 min**; fallback/erro **1/1 em
  39,6 s**; isolamento A/B **1/1 em 1,7 min**.
- [x] `rtk npm exec eslint -- tests/e2e/spendable.spec.ts --max-warnings=0`,
  `rtk npx tsc --noEmit --pretty false --incremental false` e
  `rtk git diff --check -- tests/e2e/spendable.spec.ts
  tasks/S08-disponivel-para-gastar/012-testes-e2e_task.md` — passaram sem
  erros ou warnings.

## Handoff

- [x] T13 recebe a evidência E2E da consulta de disponibilidade; a validação
  de release/handoff permanece exclusivamente no escopo da T13.
