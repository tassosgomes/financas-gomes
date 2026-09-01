# T17 — CI e gates de qualidade

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 6
- Dependências: T15 e T16
- Paralelização: A configuração inicial pode começar antes; a regra final depende das suítes prontas

## Objetivo

Impedir que alterações que quebrem a fundação, o isolamento ou o build avancem para deploy.

## Escopo

- Criar workflow de Pull Request no GitHub Actions.
- Executar lint.
- Executar typecheck.
- Executar testes unitários.
- Executar testes de integração com PostgreSQL real.
- Validar migrations e schema.
- Executar build da aplicação.
- Executar os poucos E2E críticos via Playwright.
- Validar docker build quando apropriado.
- Separar jobs independentes para reduzir tempo total, mantendo dependências explícitas.
- Publicar Preview Deployment pela integração com Vercel quando configurada.
- Não executar migration de produção em Pull Request.

## Critérios de aceite

- [ ] Um Pull Request executa lint, typecheck, testes, integração e build.
- [ ] A integração usa PostgreSQL real.
- [ ] Falha de isolamento ou autenticação bloqueia o pipeline.
- [ ] O E2E smoke está incluído como gate crítico.
- [ ] O build Docker é verificável no CI ou em job equivalente.
- [ ] O workflow não contém migration automática de produção.
