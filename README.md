# Finanças Gomes

Monólito modular para gestão financeira compartilhada. A aplicação usa Next.js com App Router, TypeScript e Tailwind CSS/shadcn no frontend. Os módulos de domínio ficam em `src/modules` e compartilham o mesmo processo e deploy.

## Executar localmente

Requisitos: Node.js 20+ e npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Abra <http://localhost:3000>. O bootstrap renderiza a página inicial sem exigir uma conexão durante a compilação; as integrações de PostgreSQL e Better Auth serão habilitadas pelas tasks seguintes.

## Comandos de qualidade

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript sem emissão
npm test           # Vitest em modo não interativo
npm run build      # build de produção Next.js
npm run check      # lint + typecheck + testes
```

## Variáveis de ambiente

`src/lib/env.ts` é o único ponto de validação das variáveis de runtime. Copie `.env.example` para `.env.local` e preencha as credenciais por ambiente. `BETTER_AUTH_SECRET` precisa ter pelo menos 32 caracteres; valores ausentes ou inválidos geram uma mensagem de configuração explícita, sem incluir segredos no erro.

## PostgreSQL e migrations

O desenvolvimento usa PostgreSQL real via Docker Compose, sem SQLite. Suba o
banco com `docker compose up -d db` e aplique o schema com
`npm run db:migrate:local`. Consulte [`docs/database.md`](docs/database.md)
para gerar migrations, verificar pendências, preparar testes de integração e
executar a etapa controlada de migration do Neon antes do deploy. Nenhuma
migration é executada automaticamente no boot da aplicação.

O procedimento de produção, incluindo configuração de Vercel/Neon/Google/Sentry,
deploy controlado, smoke test e rollback, está em
[`docs/production-deploy.md`](docs/production-deploy.md).

## Contratos do slice S01

- `households` é o nome canônico no domínio e na persistência; **Espaço financeiro** é o texto de interface.
- `household_members` representa a relação N:N entre o usuário do Better Auth e os households.
- `household_invites` será a tabela de convites por link.
- O `user` persistido pelo Better Auth é a entidade de usuário local; não haverá uma tabela de espelho.
- A V1 usa somente Google OAuth. Não existe fluxo de senha local.
- Sessões são persistentes por aproximadamente 30 dias (`src/modules/auth/contracts.ts`).
- O contexto ativo é derivado no servidor da sessão e de uma membership válida. Um `householdId` recebido do cliente nunca é autoridade.

As decisões e o protocolo de seleção de contexto estão detalhados em [`docs/adr/001-bootstrap-contracts.md`](docs/adr/001-bootstrap-contracts.md).

A convenção para queries tenant-scoped, o recurso protegido de fixture e a
fronteira server-only do PostgreSQL estão em [`docs/tenancy.md`](docs/tenancy.md).
