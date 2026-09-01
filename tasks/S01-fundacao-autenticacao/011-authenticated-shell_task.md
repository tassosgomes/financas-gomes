# T11 — Shell autenticado e tela inicial vazia

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T07 e T10
- Paralelização: Pode executar em paralelo com T08 e T09; desbloqueia T12 e T16

## Objetivo

Provar visualmente o caminho completo de sessão, contexto financeiro e navegação privada sem antecipar funcionalidades financeiras.

## Escopo

- Criar layout autenticado protegido por requireAuth/requireFinancialContext.
- Criar rota inicial privada com estado vazio.
- Exibir o nome do espaço financeiro e identificação básica do usuário.
- Disponibilizar logout.
- Tratar loading, erro de sessão e contexto ausente.
- Buscar o espaço pelo contexto server-side.
- Usar componentes mínimos e responsivos, sem projetar uma experiência mobile-first.

## Critérios de aceite

- [ ] Usuário autenticado chega à área privada sem erro.
- [ ] Usuário não autenticado é bloqueado pela camada server-side.
- [ ] A tela exibe o espaço financeiro persistido no banco.
- [ ] Logout retorna à entrada pública.
- [ ] Um householdId fornecido manualmente pelo cliente não muda o espaço exibido.
- [ ] A tela permanece vazia de propósito, sem criar entidades financeiras fora do S01.
