# T06 — Provisionamento idempotente do primeiro acesso

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 4
- Dependências: T04 e T05
- Paralelização: Deve ser concluída antes de T07; pode ser desenvolvida em paralelo com T10

## Objetivo

Transformar uma autenticação concluída em um usuário local com contexto financeiro persistido, sem criar duplicidades em retries ou acessos concorrentes.

## Escopo

- Criar um use case explícito para garantir usuário, household e membership.
- Após o primeiro login sem convite válido:
  - localizar o usuário autenticado;
  - criar um household;
  - criar a membership do usuário nesse household.
- Tornar a operação idempotente.
- Usar transaction e constraints para evitar dois households no caso de requests concorrentes.
- Definir o comportamento de um usuário que já possui membership.
- Integrar o caminho de convite: um convite válido deve associar o usuário ao household convidado em vez de criar outro household.
- Revalidar a membership no servidor antes de retornar o contexto.
- Retornar erros esperados de forma tratável e encaminhar falhas inesperadas à observabilidade.

## Critérios de aceite

- [ ] O primeiro acesso cria exatamente um usuário local, um household e uma membership.
- [ ] Repetir o primeiro acesso não cria registros duplicados.
- [ ] Dois usuários diferentes podem ser associados ao mesmo household.
- [ ] Aceitar convite válido não cria um household novo para o convidado.
- [ ] Uma tentativa concorrente não produz memberships ou households duplicados.
- [ ] A operação é atômica: não existe estado parcial de usuário sem contexto recuperável.
- [ ] O resultado contém o contexto que será consumido por T07.

## Fora de escopo

- Criação de conta financeira, saldo inicial, categorias, caixinhas ou qualquer dado financeiro.
- Wizard obrigatório de onboarding.
