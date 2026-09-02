# T13 — Validação de release e handoff para S09

- Status: Bloqueada — gates locais do S08 concluídos; a revalidação E2E global
  de 2026-09-02 permaneceu não verde por uma falha externa de S07/T12
  (`tests/e2e/forecast.spec.ts:423`, estado de carregamento ausente). O teste
  S06/T16 que havia falhado anteriormente passou nesta rodada e a spec do S08
  continua 6/6 isoladamente; não há promoção global enquanto o gate externo
  permanecer vermelho.
- Onda: 4
- Dependências: T05, T11 e T12
- Paralelização: Não; fechamento serial

## Objetivo

Auditar o slice contra os documentos normativos, executar os gates de release
e deixar a integração de reservas para S09 verificável.

## Escopo

- Revisar todos os critérios de S08 e a Definition of Done deste índice contra
  evidências de T01–T12; não promover item sem prova correspondente.
- Executar migrations/checks, lint, typecheck, testes unitários, integração,
  E2E e build conforme scripts do repositório; registrar falhas externas sem
  falsificar aprovação.
- Revisar redaction/Sentry e consultas lentas; executar smoke no ambiente
  autorizado, incluindo breakdown e cenário de déficit.
- Verificar que o contrato/porta de T08 está documentado em S09 e que os testes
  de reserva protegida permanecem pendentes e explicitamente pertencem à
  integração S09, não ao encerramento pré-S09.

## Subtarefas

- [x] Auditar T01–T12, a Definition of Done e os critérios normativos de S08,
  mantendo evidência atual para cada item.
- [!] Executar os gates de banco/migrations, lint, typecheck, testes unitários,
  integração PostgreSQL, E2E e build; registrar resultado sem mascarar falhas.
  Todos os gates do S08 passaram, mas `npm run test:e2e` global terminou em
  24/25 por falha externa de S07/T12 em `forecast.spec.ts:423`, registrada
  abaixo; a falha histórica de S06/T16 não se reproduziu nesta rodada.
- [!] Auditar redaction/telemetria Sentry, consultas lentas e executar smoke
  autorizado do card, breakdown e cenário de déficit. A auditoria local e o
  smoke em container passaram; probe/evento Sentry publicado não foi executado
  sem ambiente/janela externa autorizada.
- [x] Conferir o handoff S08→S09: porta/API, versão, fixtures, cenários,
  owner e separação explícita dos testes de reservas protegidas.
- [!] Consolidar as evidências e decidir o status final da T13 conforme os
  critérios de aceite. A decisão de promoção global permanece pendente pela
  falha externa de E2E em S07/T12, sem alteração de escopo.

## Critérios de aceite

- [!] Todos os gates aplicáveis têm evidência atual e a release não persiste
  saldo de spendable. Os gates locais do S08 estão verdes e não há tabela de
  snapshot/saldo persistido, mas a revalidação E2E global falhou em S07/T12
  (`24 passed`, `1 failed`), fora do escopo desta task.
- [x] Handoff identifica API, versão, fixtures e cenários que S09 deve cumprir.
- [x] Nenhum requisito de caixinhas é declarado concluído antes da integração S09;
  a documentação de S09 mantém esses itens pendentes.

## Auditoria da Definition of Done de S08 (2026-09-01)

- [x] Determinismo, precisão inteira e reconciliação: `npm run check`, os
  testes de `src/modules/spendable` e a matriz T11 passaram; o único `todo`
  é o teste explícito de valores de caixinha que pertence a S09.
- [x] Forecast conservador de 90 dias, compromissos S07 uma única vez e
  exclusão de cartão/fatura/patrimônio: integração T06/T11 e os seis cenários
  E2E do S08 passaram.
- [x] Card/breakdown exibem período, cenário, buffer, mínimo e origens; a
  spec focada confirmou reconciliação e navegação causal por teclado.
- [x] Zero e déficit preservam o bruto/quantia a recompor e exibem somente
  disponibilidade não negativa; os cenários E2E de zero e déficit passaram.
- [x] Isolamento por `household_id`: integração PostgreSQL T06/T11 e o cenário
  E2E A/B passaram sem valor, referência ou origem estrangeira.
- [x] `RESTRICTED`/`EXCLUDED` não inflamam o global e a porta `s09.v1` usa
  `ZeroReserveAdapter` antes do S09; não há tabela de caixinhas neste slice.
- [x] Falhas técnicas e lentidão usam somente contexto allow-listed/agregado;
  a suíte de observabilidade S08/S07/sanitização passou 29/29 e os registros
  observados não contêm centavos, saldos, descrições, referências, SQL ou
  timeline.
- [x] Unitários, PostgreSQL e E2E cobrem positivo, zero, déficit, ausência de
  transações, parcelas/entradas futuras, cancelamento, não dupla contagem,
  isolamento e estados de UI; a suíte global E2E tem apenas a falha externa
  de S07/T12 descrita na revalidação mais recente (a falha anterior de S06/T16
  não se reproduziu nesta rodada).

## Evidências de gates e smoke (2026-09-01)

- [x] `rtk npm run db:check:files` — Drizzle reportou `Everything's fine`.
  Em PostgreSQL descartável, `db:migrate:local` foi idempotente e o status
  confirmou `18` migrations aplicadas, `0` pendentes e `0` divergentes.
- [x] Inspeção read-only do schema encontrou somente a tabela
  `spendable_settings` no namespace `public`, com `0` linhas; não existe
  tabela/coluna de snapshot ou saldo de spendable persistido. A migration usa
  `household_id`, `DATE`, `BIGINT`, FK e check não negativo.
- [x] `rtk npm run check` — lint, typecheck e testes unitários passaram em
  sequência (`97` arquivos/`624` testes passados; `31` arquivos/`116` testes
  opt-in ignorados e `1` `todo` explícito de S09).
- [x] `rtk env ... npm run test:integration` no PostgreSQL 16 descartável —
  `29` arquivos/`108` testes passaram e `2` arquivos/`8` testes opt-in foram
  ignorados; T11 S08 `5/5`, T06 S08 `2/2`, fontes S07 `2/2` e boundary T13
  `1/1` passaram.
- [x] `rtk npm run build` — build Next.js de produção passou com exit 0 e
  gerou as rotas de card/breakdown; o aviso de múltiplos lockfiles é
  operacional e não impediu o build.
- [x] `rtk docker build --tag financas-gomes:t13-release-gate .` — imagem
  standalone construída com sucesso. O container smoke, com Sentry de teste
  desabilitado e banco descartável, retornou health HTTP 200 (`process=ok`),
  readiness HTTP 200 (`database=ok`, `schema=ok`), redirecionou breakdown
  sem sessão para `/` (307) e manteve o endpoint de probe Sentry em 404.
- [x] `rtk env E2E_PORT=3213 ... npm run test:e2e --
  tests/e2e/spendable.spec.ts --reporter=line` — os seis cenários S08
  passaram em `6,8 min`: positivo, zero, déficit, parcelas, fallback/erro e
  isolamento A/B. A regressão `npm run test:e2e` global confirmou esses seis
  passes, mas terminou em `24 passed`/`1 failed` no S06/T16 externo.
- [x] Redaction/telemetria: os testes focados
  `s08.test.ts`, `sanitize.test.ts`, `s07.test.ts` e o endpoint de teste
  Sentry passaram `29/29`; com a rota de probe, `15/15`. A revisão estática
  confirmou allow-list para log, breadcrumb, métrica e contexto Sentry,
  incluindo threshold/budget de consulta limitada a `60.000 ms`; nenhuma
  publicação Sentry foi simulada sem autorização externa.
- [x] `rtk yq eval` dos workflows CI/deploy e `rtk git diff --check` — ambos
  concluídos sem erro.

## Revalidação local de T13 (2026-09-02)

- [x] `rtk npm run check` passou novamente: `97` arquivos/`624` testes
  passaram; `31` arquivos/`116` testes opt-in foram ignorados e há `1` `todo`
  explícito de S09.
- [x] `rtk env DATABASE_URL=... MIGRATION_DATABASE_URL=... npm run
  db:migrate:local` e `db:migrate:status` passaram; o PostgreSQL descartável
  permaneceu em `18` migrations aplicadas, `0` pendentes e `0` divergentes.
- [x] `rtk env DATABASE_URL=... MIGRATION_DATABASE_URL=... npm run
  test:integration` passou: `29` arquivos/`108` testes passaram e `2`
  arquivos/`8` testes foram ignorados.
- [x] `rtk npm run build` e `rtk docker build --tag
  financas-gomes:t13-release-gate .` passaram; o build manteve as rotas de
  card e breakdown.
- [x] Smoke do container publicado localmente: `/api/health` retornou 200 com
  `process=ok`, `/api/readiness` retornou 200 com banco/schema ok,
  `/spendable/breakdown` sem sessão redirecionou com 307 e o `POST` do probe
  Sentry desabilitado retornou 404.
- [x] O caso focado de loading de Forecast passou isoladamente (`1 passed`),
  mas isso não substitui a revalidação E2E global, que permanece bloqueada
  pela falha intermitente registrada abaixo.

## Handoff S08 → S09

- [x] API/porta: `src/modules/spendable/reserve-adapter.ts` exporta a porta
  server-side `SpendableReserveAdapter`, contrato `s09.v1`,
  `ZeroReserveAdapter` e `MovementReserveAdapter`; o contexto de tenancy é
  resolvido antes da porta e o browser não fornece `householdId`.
- [x] Versões/formato: S08 continua em `s08.v1`/`spendable.v1`; componentes de
  reserva usam `Money`/`bigint` no domínio e strings na boundary serializável.
  O adapter pré-S09 retorna `UNAVAILABLE`, proteção/ajuste `0` e lista vazia.
- [x] Fixtures e testes: o manifesto em
  `tests/fixtures/s08-disponivel-para-gastar/manifest.json` e a matriz T11
  cobrem zero pré-S09, positivo/zero/déficit, parcelas, entradas futuras,
  cancelamento, effective-dated buffer, isolamento e não dupla contagem.
- [x] Obrigações de S09: `docs/S09-caixinhas.md` e ADR-011 identificam o
  owner domínio/backend de Caixinhas e movimentos e exigem saldo derivado,
  `CONTRIBUTION`/`WITHDRAWAL`, `BOX_BALANCE_PROTECTED`, referências opacas,
  `closedOn` efetivo, `RESTRICTED`/`EXCLUDED` fora do global e deduplicação.
- [x] Limite de escopo: testes de reserva protegida com persistência real,
  migrations/tabelas/CRUD/UI de caixinhas e integração final no spendable
  continuam explicitamente pendentes do S09; os critérios de aceite de
  caixinhas em `docs/S09-caixinhas.md` não foram marcados como concluídos.

## Bloqueio fora do escopo

Uma execução anterior do gate E2E global falhou em
`tests/e2e/credit-cards.spec.ts:267` (S06/T16): após clicar em “Criar nova
regra”, a aplicação exibia “As vigências das regras de cobrança não podem se
sobrepor.” enquanto o teste esperava “Nova regra de cobrança criada.”. Nenhum
arquivo de S06/T16 foi alterado por T13; a correção pertence ao slice
responsável.

Nova reprodução factual do gate externo (2026-09-02):
`tests/e2e/credit-cards.spec.ts` registrou `1 passed` e `1 failed`; o
encerramento falhou por artefato ZIP/vídeo truncado, e o servidor web também
reportou `EADDRINUSE 127.0.0.1:3100`. Esse registro é histórico e não altera o
escopo de T13.

Revalidação factual mais recente (2026-09-02):
`rtk env E2E_PORT=3100 E2E_NEXT_DIST_DIR=.next-e2e-s08-t13-20260902 npm run
test:e2e -- --reporter=line` iniciou com a porta 3100 livre e terminou com
exit 1 após 15,5 minutos: `24 passed`, `1 failed`. A única falha foi
`tests/e2e/forecast.spec.ts:423` (S07/T12), porque
`getByTestId('forecast-route-loading')` não ficou visível em 5 segundos; o
teste S06/T16 passou nesta execução. Os seis testes de S08 (T12) também
passaram. O código de S06/T16 e S07/T12 não foi alterado por T13.

Reprodução focada subsequente (2026-09-02): o caso de loading de
`tests/e2e/forecast.spec.ts` passou isoladamente (`1 passed`) em servidor E2E
próprio na porta 3101. Isso não substitui o gate global: apenas confirma que a
falha global não foi reproduzida de forma determinística neste ambiente.
