# ADR-002 — UUIDv7 para identificadores de domínio

- **Status:** Aceito
- **Data:** 2026-08-29
- **Escopo:** T03 do slice S01

## Contexto

Os identificadores de `households`, `household_invites` e das próximas
entidades de domínio precisam estar disponíveis antes do `INSERT`, ser
temporalmente ordenáveis e não depender de um valor incremental ou de UUIDv4.
O usuário local é persistido pelo Better Auth, mas continua sendo uma
entidade usada pelo domínio de tenancy.

## Decisões

### Ponto único de geração

`src/lib/uuidv7.ts` é o único gerador de IDs de domínio. O contrato público é:

```ts
import {
  generateUuidV7,
  type UuidV7,
} from "@/lib/uuidv7";

const householdId: UuidV7 = generateUuidV7();
```

O gerador implementa UUIDv7 conforme a [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html), usando `crypto.getRandomValues` para o payload aleatório. Ele mantém um contador monotônico no payload quando há mais de uma geração no mesmo milissegundo ou quando o relógio recua. Assim, o ID pode ser criado no use case antes da persistência e a ordenação textual acompanha a ordem de geração neste processo.

Schemas Drizzle devem usar o gerador como default da aplicação, e não um
default SQL aleatório:

```ts
id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
```

Quando o fluxo precisar do ID antes de montar o restante do comando, deve
chamar explicitamente `generateUuidV7()` e passá-lo ao `INSERT`. Nenhuma
entidade de domínio deve usar `crypto.randomUUID()`, `defaultRandom()`, CUID,
serial ou outro gerador local.

### IDs gerenciados pelo Better Auth

O [Better Auth documenta](https://better-auth.com/docs/concepts/database#id-generation) que seu gerador padrão é um identificador aleatório base62 e que `advanced.database.generateId: "uuid"` seleciona UUIDs aleatórios. Nenhuma dessas opções garante UUIDv7. Portanto, T04 deve configurar o callback do Better Auth para consumir o mesmo ponto único:

```ts
import { generateUuidV7 } from "@/lib/uuidv7";

advanced: {
  database: {
    generateId: () => generateUuidV7(),
  },
},
```

Essa configuração abrange `user`, `session`, `account` e `verification`.
Consequentemente, o `user.id` persistido pelo Better Auth será um UUIDv7 e
servirá diretamente como `household_members.user_id`; não haverá tabela de
espelho nem conversão para outro identificador. IDs externos de provedores
(por exemplo, `accountId` do Google) não são IDs de domínio e permanecem sob o
contrato do provedor.

## Consequências

- IDs de `households`, convites e futuras entidades podem ser usados para
  montar referências antes da transação.
- O tipo `UuidV7` documenta a fronteira e `isUuidV7` permite validar valores
  vindos de adapters ou migrations.
- A configuração do Better Auth precisa permanecer alinhada com este ADR;
  trocar o callback por `"uuid"`, `false` ou `"serial"` exige uma nova decisão.
- A ordenação é garantida entre IDs emitidos pelo mesmo processo; o timestamp
  embutido continua representando a ordem temporal aproximada entre processos.

