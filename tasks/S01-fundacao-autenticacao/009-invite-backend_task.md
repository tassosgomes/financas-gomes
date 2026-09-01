# T09 — Convites por link no backend

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T05 e T07
- Paralelização: Pode executar em paralelo com T08 e T11

## Objetivo

Permitir que um membro compartilhe seu espaço financeiro com outro usuário através de um link copiável, sem introduzir serviço de e-mail ou permissões complexas.

## Escopo

- Permitir que um membro do household crie um convite.
- Gerar token criptograficamente aleatório.
- Armazenar apenas o hash do token.
- Definir expiração configurável e registrar expiresAt.
- Aceitar o token somente uma vez e registrar usedAt.
- Aceitar o convite depois que o convidado estiver autenticado.
- Criar a membership no household do convite de forma transacional.
- Revalidar o household e o criador com requireFinancialContext.
- Tratar token inexistente, expirado, já usado e tentativa de acesso cross-tenant.
- Não enviar token bruto para logs, Sentry ou banco.
- Tornar o aceite seguro contra duas requisições simultâneas.

## Critérios de aceite

- [ ] Um membro consegue gerar um link copiável.
- [ ] O token persistido é um hash, nunca o valor bruto.
- [ ] Um segundo usuário autenticado consegue entrar no mesmo household pelo link.
- [ ] O mesmo convite não pode ser aceito duas vezes.
- [ ] Convite expirado ou inválido é rejeitado sem criar membership.
- [ ] Usuário que não pertence ao household não consegue gerar convite para ele.
- [ ] O aceite é atômico e não cria membership duplicada.
- [ ] Não existe dependência de serviço de e-mail.

## Fora de escopo

- Aprovação de convite, ownership, papéis, permissões ou auditoria.
- Convites em massa ou gestão avançada de membros.
