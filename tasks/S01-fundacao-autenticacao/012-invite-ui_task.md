# T12 — Interface de compartilhamento e aceite de convite

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T09 e T11
- Paralelização: Pode executar em paralelo com T15 e T16 depois que os contratos de backend estiverem estáveis

## Objetivo

Dar ao usuário uma forma simples de compartilhar o espaço financeiro e ao convidado uma forma clara de aceitar o vínculo.

## Escopo

- Adicionar ação de gerar convite na área autenticada.
- Permitir copiar o link.
- Exibir confirmação de criação sem revelar o token armazenado.
- Criar rota/tela de aceite de convite.
- Solicitar autenticação quando o convidado ainda não estiver autenticado.
- Após autenticação, concluir o aceite usando o token da URL e o backend de T09.
- Exibir estados para convite inválido, expirado, já utilizado e sucesso.
- Mostrar o espaço financeiro ao qual o usuário foi associado.

## Critérios de aceite

- [ ] Um membro consegue gerar e copiar um link.
- [ ] Um convidado consegue abrir o link e autenticar-se.
- [ ] O convidado termina no mesmo espaço financeiro do remetente.
- [ ] Convites inválidos não expõem dados de outro household.
- [ ] O token bruto não aparece em mensagens de erro, logs ou Sentry.
- [ ] A interface não introduz papéis ou permissões diferentes.
