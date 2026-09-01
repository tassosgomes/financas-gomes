# T10 — Drill-down, origem e manutenção de compromissos

- Slice: S07 — Fluxo futuro
- Status: Concluída — correção do drill-down de evento planejado validada em 2026-08-31.
- Onda: 3
- Dependências: T03, T06, T08 e T09
- Paralelização: Acabamento com T11; não bloqueia a implementação visual inicial de T09

## Objetivo

Permitir explicar cada valor projetado e encaminhar o usuário para corrigir ou adicionar informação pelo fluxo de domínio apropriado.

## Escopo

- Resolver `referenceId` tenant-safe para detalhe de recorrência/ocorrência, evento planejado ou compra/parcela S06, com labels e estado explícitos.
- Oferecer links de origem e retorno à mesma projeção; para parcela, abrir origem de compra/fatura sem permitir editar/pagar parcela isolada.
- Implementar UI de criar/manter recorrência, feriado/override e evento futuro somente nas operações definidas por T03/T01; validar no servidor e atualizar a projeção.
- Explicar cancelamento/realização e impedir ações incompatíveis com fatos `POSTED`.

## Critérios de aceite

- [x] Usuário consegue identificar de onde vem todo compromisso principal e alcançar uma ação válida ou contexto de somente leitura. A timeline usa o href autorizado pelo adapter; o drill-down de evento planejado criado pela UI agora resolve o UUIDv7 corretamente.
- [x] Adicionar/alterar informação futura recalcula a projeção e preserva a vigência/histórico. Commands de recorrência delegam a T03 (versão prospectiva/override/cancelamento/realização); eventos planejados usam transaction + revalidação de `/forecast` após sucesso.
- [x] Referência inexistente ou de outro household não vaza metadados. O resolver valida a query estrita, repete `household_id` em cada lookup e retorna erro opaco indistinguível.
- [x] Parcela futura aparece uma vez e não recebe ação de pagamento independente. O detalhe aponta para compra/fatura agregada e publica `aggregateOnly: true` com `actions: []`.

## Handoff e verificações

- T11/T12 testam origem, retorno, criação, override e cancelamento.
- Testes de action/rota para autorização, Zod, erro, cache/revalidate e acessibilidade do detalhe.

## Fora de escopo

Estorno, correção de compra S06 além do fluxo existente, metas e orçamento.
## Subtarefas

- [x] Implementar resolução de origem tenant-safe e ações permitidas por fonte.
- [x] Integrar drill-down à visão T09 depois de seu contrato estabilizar.
- [x] Validar segurança, recálculo e critérios de aceite no boundary e na integração PostgreSQL; a repetição E2E permanece no escopo de T12.

## Evidência de fechamento (2026-08-31)

- [x] `src/modules/forecast/origin-contracts.ts` define o contrato serializável da origem, query estrita e ações allow-listed.
- [x] `src/modules/forecast/origins.ts` resolve cada fonte somente no contexto autenticado, sem devolver household/SQL/`Date`/`bigint`; referências inválidas, ausentes e cross-tenant compartilham `FORECAST_NOT_FOUND`.
- [x] `src/modules/forecast/planned-events.ts` implementa create/update/cancel transacionais e idempotentes para evento futuro; a composição não expõe comandos de parcela.
- [x] `src/app/forecast/page.tsx` passa o resolver server-authorized à timeline; `src/app/forecast/origin/page.tsx` mantém retorno seguro à projeção; a UI de detalhe separa manutenção de recorrência/ocorrência/evento e somente leitura de parcela/fato.
- [x] `src/app/forecast/origin/new/page.tsx` e o formulário de criação encaminham evento futuro/recorrência às Server Actions allow-listed; nenhum campo de tenant, status ou ledger é editável.
- [x] `rtk npx vitest run src/app/forecast/page.test.tsx src/components/forecast/forecast-components.test.tsx src/modules/forecast/contracts.test.ts src/modules/recurring/validation.test.ts --reporter=dot` passou (4 arquivos, 15 testes).
- [x] `rtk ./node_modules/.bin/eslint --no-cache ... --max-warnings=0` passou para todos os arquivos tocados.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test T10_INTEGRATION=1 npx vitest run --config vitest.integration.config.mts src/modules/forecast/origins.integration.test.ts --reporter=dot` passou (2 testes): evento planejado criado pelo use case/UI resolve no household correto e referência válida de outro household permanece opaca.
- [!] `rtk npx tsc --noEmit --pretty false --incremental false` permanece bloqueado por um diagnóstico preexistente fora de T10 em `src/modules/forecast/engine.ts:389` (conversão `Record<string, unknown>` → `ForecastSource`); nenhum diagnóstico é emitido nos arquivos de T10.

As suítes PostgreSQL/E2E de origem, retorno, idempotência e isolamento ficam como
verificação de T11/T12, conforme o handoff desta task; a implementação não
expõe uma operação de pagamento ou edição isolada de parcela.

## Reabertura por T12 (2026-08-31)

- [x] O E2E de T12 reproduziu `FORECAST_NOT_FOUND` em `/forecast/origin` para
  um `PLANNED_EVENT` criado pela UI, mesmo com `kind` e UUIDv7 válidos.
-  A causa era o regex do grupo de versão UUIDv7 (`7[0-9a-f]{4}`); o boundary
  foi corrigido para `7[0-9a-f]{3}` e a regressão PostgreSQL passou. T12 deve
  repetir o cenário browser na próxima execução.
