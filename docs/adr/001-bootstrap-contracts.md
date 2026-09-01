# ADR-001 — Bootstrap e contratos da fundação

- **Status:** Aceito
- **Data:** 2026-08-29
- **Escopo:** T01 do slice S01

## Contexto

O repositório precisava de uma base executável para que autenticação,
tenancy, frontend, testes e operação evoluíssem no mesmo monólito. Esta ADR
registra os contratos que as tasks seguintes devem consumir.

## Decisões

### Monólito modular server-first

O runtime é um único projeto Next.js com App Router e TypeScript. Módulos de
domínio ficam em `src/modules/<domínio>` e não haverá microsserviços no slice
S01. Server Components e Server Actions serão o padrão quando as features
forem adicionadas.

### Vocabulário e persistência

`Household`/`households` é o nome canônico no domínio e no banco. A interface
usa **Espaço financeiro** como termo amigável. A associação N:N usa
`household_members` e convites usam `household_invites`. Não devem ser
introduzidos aliases como `financial_spaces` ou `financial_space_users`.

### Usuário e autenticação

O `user` persistido pelo Better Auth é a entidade de usuário local. Não será
criada uma tabela de espelho nem um mapeamento paralelo. A V1 aceita somente
Google OAuth; senha local, recuperação de senha e outros provedores não fazem
parte deste contrato. O identificador do provedor e o shape mínimo da
identidade estão em `src/modules/auth/contracts.ts`.

Sessões persistem por aproximadamente 30 dias, usando
`AUTH_SESSION_MAX_AGE_SECONDS` como valor comum para a configuração do Better
Auth e para testes.

### Contexto com múltiplas memberships

O servidor deriva o contexto a partir da sessão autenticada e das linhas de
`household_members`. A resolução deve seguir este protocolo:

1. Sem membership válida, negar o acesso com erro de contexto ausente.
2. Com uma única membership, selecioná-la automaticamente.
3. Com mais de uma membership, exigir uma seleção explícita de um household
   pertencente à sessão (ou usar a seleção persistida em sessão/cookie
   assinado, sempre revalidada no servidor).
4. Se a seleção não pertencer às memberships do usuário, negar o acesso.

Qualquer `householdId` vindo de formulário, query string, body ou outro input
do cliente é apenas uma dica não confiável. Toda query e Server Action deve
usar o `householdId` retornado pelo guard server-side. A implementação desse
guard está fora de T01 e será entregue em T07.

### Configuração

`src/lib/env.ts` é o ponto único para validar configuração de runtime. O
arquivo `.env.example` documenta os nomes e valores de desenvolvimento. A
validação é lazy para permitir que lint, typecheck e o build do shell inicial
rodem antes de PostgreSQL/OAuth serem configurados; qualquer integração que
precise de runtime deve chamar `getServerEnv()` e receber erro explícito para
variável ausente ou inválida.

## Consequências

- Tasks de Better Auth e banco podem evoluir sem renomear o vocabulário de
  tenancy.
- O contrato evita que a UI vire autoridade de tenant quando o suporte a
  múltiplos households for ativado.
- A validação lazy não substitui um check de ambiente no deploy; o entrypoint
  ou health/readiness deverá chamar `getServerEnv()` quando essas integrações
  existirem.

## Divergência da TechSpec

Nenhuma. Esta ADR apenas torna explícitas, no código e na documentação local,
as decisões já previstas nos capítulos de stack, tenancy e autenticação da
TechSpec.
