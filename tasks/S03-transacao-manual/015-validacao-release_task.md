# T15 — Validação de release e produção

- Slice: S03 — Transação manual end-to-end
- Status: Em andamento
- Onda: 6
- Dependências: T08, T13 e T14; pipeline de S01
- Paralelização: Fechamento serial

## Objetivo

Fechar o slice somente quando o fluxo puder ser usado na aplicação publicada sem acesso ao banco ou a ferramentas administrativas.

## Escopo

- Executar lint, typecheck, testes unitários, integração, build e E2E pelos gates existentes.
- Revisar migration contra banco PostgreSQL limpo e banco compatível com S01/S02.
- Aplicar migration por pipeline controlada; não executar migration no boot da aplicação.
- Publicar preview/produção conforme o fluxo de S01.
- Rodar smoke test publicado: autenticar, selecionar espaço, criar receita, criar despesa, listar, editar e cancelar.
- Confirmar observabilidade e redaction em ambiente publicado.
- Revisar manualmente todos os critérios de aceite de S03 e marcar evidências.
- Registrar limitações explícitas: campos financeiros exigem correção futura/cancelar-e-lançar novamente, se essa for a decisão da T01.

## Critérios de aceite

- [!] CI passa sem testes condicionais ignorados — os gates equivalentes locais
  passaram, mas `npm test` reporta 40 testes de integração opt-in pulados; a
  suíte completa `npm run test:integration` passou separadamente. Não existe
  execução do GitHub Actions disponível para este checkout remoto.
- [x] Migration controlada aplicada com sucesso em bancos PostgreSQL
  descartáveis: `db:migrate:deploy` e `db:check` retornaram 6 aplicadas, 0
  pendentes e 0 divergentes.
- [!] Smoke test passa na aplicação publicada — bloqueado: não há URL pública
  nem autoridade/configuração Vercel/Neon/Google para publicação e autenticação.
- [!] Sentry/logs não exibem dados financeiros sensíveis — os testes locais de
  redaction passaram (14/14), mas não há projeto/DSN nem eventos de ambiente
  publicado para inspecionar.
- [!] Não é necessário inserir, editar ou corrigir dados por script para
  demonstrar o fluxo — o E2E local executou as operações pela UI, porém o
  requisito publicado permanece sem comprovação enquanto o smoke público
  estiver bloqueado.
- [x] Exceção formal registrada abaixo para os critérios dependentes de
  publicação; o Definition of Done de `tasks.md` não é declarado concluído e
  a T15 permanece `Em andamento`.

## Subtarefas e evidências (2026-08-30)

- [x] Gates de código: `npm run lint` e `npm run typecheck` concluídos sem
  erros; `npm test` passou com 206 testes (40 integrações opt-in puladas).
- [x] Integração PostgreSQL: `npm run test:integration` passou com 40 testes
  em 11 arquivos no PostgreSQL 16 descartável.
- [x] E2E local: `npm run test:e2e` passou com 5 testes, incluindo receita e
  despesa no fluxo criar → listar → editar → cancelar; as operações do fluxo
  foram feitas pela UI.
- [x] Build/release local: `npm run build` e `docker build --tag
  financas-gomes:t15 .` concluídos com sucesso. O Next.js emitiu somente o
  aviso operacional de múltiplos lockfiles; o build da imagem concluiu com os
  avisos informativos do npm, sem falhar.
- [x] Consistência de migrations: `npm run db:check:files` concluído sem
  divergências.
- [x] Migration em PostgreSQL limpo: em um banco descartável novo,
  `db:migrate:deploy`, `db:migrate:status` e `db:check` retornaram 6 aplicadas,
  0 pendentes e 0 divergentes; a inspeção encontrou as 13 tabelas esperadas e
  nenhuma coluna `accounts.balance`.
- [x] Compatibilidade S01/S02: as cinco migrations anteriores foram aplicadas
  em banco descartável e a migration de S03 foi executada pelo deploy
  controlado sobre esse schema; todas as instruções SQL concluíram, os quatro
  tipos S03 e as 13 tabelas ficaram presentes e `accounts.balance` não foi
  criado.
- [x] Não executar migration no boot: a imagem `financas-gomes:t15` iniciou
  contra banco vazio, retornou health HTTP 200 e readiness HTTP 503 com
  `database=ok`/`schema=degraded`; os logs mostraram somente o start do
  Next.js e a tabela `drizzle.__drizzle_migrations` permaneceu ausente.
- [x] Smoke local da imagem: com migrations aplicadas, `/api/health` e
  `/api/readiness` retornaram HTTP 200 com `process`, `database` e `schema`
  saudáveis.
- [x] Observabilidade local: `npm test -- --run src/modules/observability
  src/app/api/observability/test` passou com 14 testes, incluindo redaction,
  contexto S03 e probe desabilitado/configuração ausente.
- [x] Workflows YAML: `.github/workflows/ci.yml` e
  `.github/workflows/production-deploy.yml` foram parseados com `yq` sem erro;
  o workflow publicado não pôde ser executado neste checkout.
- [!] Publicação preview/produção e migration no alvo real — bloqueadas pela
  ausência de `VERCEL_TOKEN`, IDs Vercel, `MIGRATION_DATABASE_URL`,
  `PRODUCTION_URL`, projeto Neon e aprovação do ambiente protegido.
- [!] Smoke publicado (Google, espaço, receita, despesa, listagem, edição e
  cancelamento) — bloqueado pela ausência de domínio/credenciais/usuários de
  teste controlados.
- [!] Validação Sentry publicada — bloqueada pela ausência de DSN, projeto e
  janela autorizada para o endpoint de probe.

## Revisão manual do Definition of Done de S03 (2026-08-30)

Os critérios locais abaixo foram conferidos contra as suítes unitária,
PostgreSQL e Playwright; o último permanece pendente por depender de
publicação externa.

- [x] Receita e despesa criam `FinancialEvent` + `AccountEntry`.
- [x] Valores usam centavos/`Money`, datas usam `PlainDate`/`DATE` e não há
  perda de precisão.
- [x] Referências são tenant-scoped e categoria incompatível/inativa é
  rejeitada.
- [x] Saldo é derivado dos entries e não existe `accounts.balance`.
- [x] Criação atômica e idempotência não deixam registros parciais.
- [x] Listagem, filtros e empty state funcionam após a criação.
- [x] Edição permitida não sobrescreve efeitos financeiros `POSTED`.
- [x] Cancelamento preserva histórico e neutraliza o efeito sem hard delete.
- [x] E2E cobre criar → listar → editar → cancelar para receita e despesa.
- [x] Testes cobrem isolamento, constraints, precisão, rollback e
  idempotência.
- [x] Logs/breadcrumbs/Sentry local não contêm dados financeiros sensíveis.
- [!] Fluxo na aplicação publicada sem scripts/acesso administrativo —
  bloqueado pela ausência de ambiente publicado e credenciais controladas.

## Limitações funcionais confirmadas

Conforme T01/ADR-004, a edição de S03 é somente de metadados (descrição e
campos equivalentes permitidos). Valor, conta, data e tipo não são corrigidos
atomicamente depois de publicados; uma correção financeira futura deverá ter
contrato explícito ou usar cancelar-e-lançar novamente.

## Bloqueios e exceção formal

O runbook de produção registra que este checkout contém apenas placeholders e
não possui domínio publicado, `VERCEL_TOKEN`, IDs Vercel, URL Neon,
credenciais Google, DSNs Sentry ou usuários de smoke. A consulta ao remoto
também não encontrou branch padrão/execução de workflow disponível. Portanto,
não há evidência real para marcar publicação, migration no alvo produtivo,
smoke público ou Sentry como concluídos. A exceção é registrada para manter a
T15 em `Em andamento`; a conclusão exige a execução controlada no ambiente
externo e a coleta dessas evidências.
