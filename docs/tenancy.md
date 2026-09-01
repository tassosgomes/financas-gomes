# Acesso tenant-scoped

O household ativo é uma decisão do servidor. Toda leitura ou escrita privada
deve começar com `requireFinancialContext()` (diretamente ou através de
`withFinancialContext`) e usar somente o `householdId` retornado por esse
guard.

## Convenção para as próximas slices

Uma operação privada segue esta forma:

```ts
const context = await requireFinancialContext();

return db
  .select()
  .from(resource)
  .where(eq(resource.householdId, context.householdId));
```

Para operações que também recebem um ID de recurso, o predicado sempre inclui
os dois valores:

```ts
.where(and(
  eq(resource.id, resourceId),
  eq(resource.householdId, context.householdId),
))
```

Criações preenchem `householdId` e o usuário servidor-side a partir do
contexto. O comando vindo do browser não deve conter `householdId`; se houver
um campo adulterado, ele é ignorado e não pode substituir o valor resolvido.
Atualizações não aceitam alterar o ID ou o household. “Não encontrado” e “ID
de outro household” compartilham o mesmo resultado para não revelar dados de
outro espaço.

`src/modules/households/protected-resource.ts` contém o repositório mínimo que
materializa essa convenção. `protected_resources` é uma fixture de domínio
neutro para os testes de isolamento; ela não antecipa o Ledger nem deve ser
usada como modelo para lançamentos financeiros.

## Integridade no PostgreSQL

Além do filtro obrigatório na aplicação, `protected_resources` vincula
`(household_id, created_by)` à chave composta de `household_members`. Assim,
mesmo uma tentativa server-side de combinar um usuário de A com o household B
é rejeitada pelo banco. O mesmo padrão já protege o criador em
`household_invites`. Recursos futuros que carreguem uma referência a outro
recurso e ao household devem usar uma FK composta equivalente e uma chave
única compatível no recurso pai.

RLS permanece fora da V1 conforme a TechSpec: a barreira obrigatória nesta
versão é a resolução server-side do contexto, queries tenant-scoped e as
constraints do PostgreSQL.

## Fronteira do browser

O browser não possui credenciais nem acesso direto ao PostgreSQL. Ele chama
rotas, Server Actions ou Server Components; esses pontos de entrada executam o
guard, usam o contexto autenticado e só então acessam Drizzle/PostgreSQL. Não
se deve expor `DATABASE_URL`, credenciais, um driver SQL ou uma query privada
ao bundle do cliente. Um `householdId` recebido por formulário, query string
ou body é no máximo uma dica de seleção validada pelo guard, nunca autoridade
de tenant.
