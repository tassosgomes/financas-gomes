# T14 — E2E do fluxo crítico

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — suíte crítica de navegador concluída em 2026-08-29.
- Onda: 6
- Dependências: T10, T11 e T12; login/shell de S01
- Paralelização: Pode ser preparada durante a UI, mas a execução final depende das telas integradas

## Objetivo

Validar pelo navegador o fluxo que define o valor do slice, usando dados fictícios e a aplicação real.

## Escopo

- Preparar seed/fixtures E2E sem dados financeiros reais.
- Cobrir despesa: abrir → preencher → salvar → encontrar na listagem → abrir detalhe → editar campo permitido → cancelar.
- Cobrir receita manual válida e sua presença na listagem/conta.
- Verificar exibição de precisão monetária, data, conta, categoria e status.
- Verificar empty state inicial e filtros mínimos.
- Verificar mensagens para formulário inválido e erro de referência quando reproduzível pela UI.
- Verificar que após criação e cancelamento a leitura/saldo exibidos são atualizados.
- Manter cenários de cartão, parcela, recorrência, importação e forecast fora desta suíte.

## Critérios de aceite

- [x] O fluxo principal E2E passa: criar → listar → editar → cancelar — os cenários dedicados exercitam a sequência completa em [`tests/e2e/transactions.spec.ts`](../../tests/e2e/transactions.spec.ts).
- [x] Receita e despesa têm cobertura separada — há um teste independente para cada tipo, incluindo valor assinado e categoria compatível.
- [x] O cancelamento mantém histórico visível e não duplica efeito ao recarregar — cada cenário valida o status `CANCELLED`, o reversal único, o saldo neutralizado e a ausência da ação de segundo cancelamento após reload.
- [x] A suíte não depende de scripts administrativos nem de dados de produção — contas/categorias são criadas pela UI com nomes únicos; o teste usa apenas a identidade fake e o banco E2E descartável.
- [x] O teste roda no CI com ambiente PostgreSQL definido — o job E2E em [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) aplica migrations e define `DATABASE_URL`/`E2E_DATABASE_URL` antes do Playwright.

## Subtarefas

- [x] Preparar fixture fictícia pela UI: conta ativa e categorias de despesa/receita com sufixo único por cenário.
- [x] Cobrir despesa manual: criar, localizar na listagem, conferir detalhe/precisão/data/conta/categoria, editar descrição, cancelar e verificar saldo/histórico.
- [x] Cobrir receita manual em cenário separado com os mesmos passos de manutenção e sinal positivo no entry/saldo.
- [x] Cobrir empty state por filtro de conta sem lançamentos, aplicação/persistência do filtro e mensagens de validação do formulário.
- [x] Cobrir erro de referência reproduzível: arquivar a conta depois de abrir o formulário e confirmar que o submit é rejeitado sem registro parcial.
- [x] Manter cartão, parcela, recorrência, importação e forecast fora da suíte.

## Verificações e evidências

- [x] `./node_modules/.bin/playwright test tests/e2e/transactions.spec.ts` — 3 testes passaram em 2,1 min no PostgreSQL de teste local após migrations.
- [x] `./node_modules/.bin/playwright test` — 5 testes E2E passaram em 2,6 min, incluindo autenticação, S02 e os três cenários T14.
- [x] `npm run typecheck` — concluído sem erros.
- [x] `./node_modules/.bin/eslint tests/e2e/transactions.spec.ts` — concluído sem warnings/erros.
