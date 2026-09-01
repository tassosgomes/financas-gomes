# T01 — Bootstrap técnico e contratos do slice

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 1
- Dependências: Nenhuma
- Paralelização: Não há dependência anterior; desbloqueia as demais tasks

## Objetivo

Criar a base executável do monólito modular e registrar as decisões locais que serão usadas por autenticação, tenancy, frontend, testes e deploy.

## Escopo

- Inicializar Next.js com App Router, TypeScript e a estrutura mínima de módulos.
- Configurar os scripts de desenvolvimento, lint, typecheck, testes e build.
- Criar a estrutura inicial para os módulos auth, households, observability e health.
- Configurar Tailwind/shadcn apenas no nível necessário para o shell inicial.
- Criar validação centralizada das variáveis de ambiente e um arquivo de exemplo.
- Definir o contrato de nomes:
  - Household/households no domínio e persistência.
  - Espaço financeiro na interface.
  - household_members para a associação N:N.
  - household_invites para convites.
- Confirmar que o User persistido pelo Better Auth será a entidade de usuário local, ou registrar explicitamente um mapeamento equivalente.
- Confirmar Google OAuth como login e cadastro da V1; não implementar senha local.
- Confirmar sessão persistente por aproximadamente 30 dias.
- Definir o comportamento para um usuário com mais de uma membership: o contexto ativo deve ser escolhido e validado no servidor, nunca recebido como um householdId confiável do cliente.
- Registrar as decisões locais em documentação/ADR quando divergirem de uma decisão da TechSpec.

## Critérios de aceite

- [ ] O projeto inicia localmente com um comando documentado.
- [ ] O build e o typecheck possuem comandos reproduzíveis.
- [ ] Variáveis obrigatórias ausentes falham com mensagem clara.
- [ ] A estrutura inicial dos módulos está criada sem introduzir microsserviços.
- [ ] Os nomes Household, Espaço financeiro e household_members estão consistentes.
- [ ] O contrato de autenticação não contém fluxo de senha local.
- [ ] O comportamento de múltiplas memberships está documentado.

## Fora de escopo

- Regras financeiras, contas, transações, categorias, caixinhas e onboarding financeiro.
- Papéis, permissões diferentes ou auditoria por usuário.
- RLS, Redis e rate limiting preventivo.
