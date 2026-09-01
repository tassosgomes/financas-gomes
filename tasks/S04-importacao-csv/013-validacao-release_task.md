# T13 — Validação de release

- Slice: S04 — Importação de extrato CSV
- Status: Bloqueada para promoção — validação local concluída em 2026-08-30; CI/build de release, deploy publicado e smoke de produção dependem de ambiente/credenciais externos ausentes.
- Onda: 4
- Dependências: T09 e T12
- Paralelização: Não; fechamento serial

## Subtarefas

- [x] Consumir os handoffs de T09 e T12 e revisar ressalvas pendentes.
- [x] Revisar o slice S04 contra o contrato, TechSpec, ADR-005 e Definition of Done.
- [x] Executar lint, typecheck, testes unitários/integração/E2E e gates de migration disponíveis; registrar o build remoto/local quando bloqueado.
- [x] Executar smoke local de preview, confirmação, listagem e reenvio bloqueado com fixture sintética.
- [x] Revisar segurança, privacidade, limites, tokens, isolamento tenant, constraints e retenção.
- [x] Verificar Sentry/logs e documentação operacional de rollout/rollback; nenhuma alteração adicional foi necessária.
- [x] Registrar decisões, ressalvas e evidências; manter o bloqueio de promoção explícito.

## Objetivo

Validar que o slice pode ser liberado com migration, segurança e experiência verificadas.

## Escopo

- Executar lint, typecheck, testes unitários/integração/E2E e checar migration em ambiente semelhante ao de produção.
- Revisar limites de upload, expiração/uso de token, isolamento tenant, constraints e política de retenção.
- Fazer smoke test publicado com fixture sintética: preview, confirmação, listagem e reenvio bloqueado.
- Verificar configuração de Sentry e logs contra a política de privacidade.
- Atualizar documentação de operação e rollout/rollback da migration quando necessário.

## Critérios de aceite

- [ ] Pipeline de release verde e migration aplicada sem dados órfãos ou duplicação. A migration e os gates locais passaram; o pipeline remoto e o build isolado de release permanecem pendentes/bloqueados.
- [x] Smoke local, em banco descartável isolado, confirma o Definition of Done do S04: preview → confirmação → resultado/listagem → reenvio bloqueado, além de arquivo estruturalmente inválido sem staging/lançamento (2/2 cenários S04).
- [x] Nenhuma lacuna de segurança/privacidade ou conflito pendente com TechSpec ficou sem decisão registrada; a promoção externa é o único bloqueio operacional restante.

## Evidências de validação (2026-08-30)

- Gates de código: `npm run lint -- --no-cache`, `npm run typecheck -- --pretty false` e `npm test -- --reporter=dot` passaram; a suíte unitária reportou 299 testes passados e 58 integrações opt-in ignoradas. `npm run db:check:files` também passou.
- Migration/schema: em banco PostgreSQL descartável exclusivo da T13, `applyMigrations()` aplicou as 11 migrations; `getMigrationStatus()` retornou `applied=11`, `pending=0`, `drifted=0`, e a verificação de tabelas confirmou as relações Better Auth e S04. A suíte de integração limpa passou 15 arquivos/58 testes.
- E2E/smoke S04: `tests/e2e/transaction-imports.spec.ts` passou 2/2 em banco isolado; confirmou duas linhas importadas, uma linha inválida reportada, relatório/listagem, reenvio com dataset já importado e arquivo estruturalmente inválido sem escrita. O handoff de T12 também registra a suíte crítica completa 7/7.
- Probes locais: `/api/health` e `/api/readiness` responderam HTTP 200 com `process=ok`, `database=ok` e `schema=ok` no ambiente local publicado.
- O `next build` foi tentado com configuração sintética sem DSN e compilou o código, mas a etapa de tipos falhou porque `.next/types/app/accounts/layout.ts` desapareceu durante a corrida com outro `next dev` no mesmo checkout. O `typecheck` independente passou; o build precisa ser repetido em runner/workspace isolado e não é tratado como verde.

## Segurança, privacidade e operação

- O limite de upload é 5 MiB por bytes recebidos, com no máximo 10.000 registros e 16 KiB por campo; valores usam `bigint`, sem float. O token de prévia é aleatório, dura 15 minutos e somente seu SHA-256 é persistido; confirmação revalida expiração, consumo, command e household.
- Staging/lotes/linhagem usam FKs compostas e predicados tenant-scoped; o lote confirmado tem unicidade parcial por `(household, account, fingerprint)`, preserva multiplicidade e não atualiza saldo materializado. O staging é removido após confirmação e expiração, conforme ADR-005.
- T09/T12 verificaram allow-list/redaction: logs, métricas e Sentry não recebem CSV, filename, descrição, valor, `external_id`, token, command, cookies ou credenciais. Validações esperadas não são capturadas como exceções inesperadas.
- [`docs/production-deploy.md`](../../docs/production-deploy.md) e [`docs/observability.md`](../../docs/observability.md) já documentam migration forward-only, rollout/rollback, health/readiness, Sentry e probe controlado. Não há domínio publicado, `MIGRATION_DATABASE_URL`, Vercel/Neon/Google/Sentry autorizados ou contas de teste de produção neste checkout; nenhum segredo foi criado ou registrado.

## Ressalvas T12 (T04/T03) e decisão de release

T12 manteve cinco overrides explícitos porque o manifesto de T04 e a fronteira
do parser T03 não coincidem. A decisão de T13 é manter ADR-005/T03 como fonte
normativa, sem relaxar o parser nem reabrir a evidência E2E:

1. `invalid-header` recebe `CSV_UNKNOWN_COLUMN` quando a coluna é desconhecida; `CSV_INVALID_HEADER` fica para ordem/forma não canônica.
2. `field-too-large` é erro por linha (`CSV_FIELD_TOO_LARGE`) e a prévia pode continuar com as demais linhas, conforme a estratégia parcial.
3. NUL é rejeitado antes da decodificação como erro de arquivo `CSV_INVALID_UTF8`, não como erro de campo; isso segue a proibição de NUL da ADR-005.
4. Uma linha vazia mantém `CSV_EMPTY_ROW` e também os erros acionáveis dos campos obrigatórios vazios; nenhum conteúdo bruto é ecoado.
5. `mixed-valid-invalid` aponta a linha lógica 3 no parser (cabeçalho = 1 e a linha inválida é a segunda linha de dados); a expectativa de linha 4 no manifesto está desatualizada.

Essas diferenças são catalogadas e testadas por overrides determinísticos em
T12, portanto não constituem lacuna de segurança nem divergência normativa do
produto. A reconciliação editorial do manifesto de T04 deve ocorrer antes de
uma nova versão da matriz; não foi alterada nesta T13 para respeitar o escopo
de não modificar outras tasks. O único bloqueio para promoção é externo:
executar CI/build em workspace isolado, configurar o alvo de migration e
publicar a versão para então repetir os probes, smoke controlado e probe Sentry
conforme o runbook.
