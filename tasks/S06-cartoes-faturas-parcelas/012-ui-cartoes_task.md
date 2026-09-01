# T12 — UI de cadastro e manutenção de cartões

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Parcial tecnicamente concluída — rotas e componentes de
  cadastro/manutenção implementados, typecheck/lint/build atuais verdes e
  integração E2E do fluxo autenticado permanece no T16.
- Onda: 3
- Dependências: T05 e T11
- Paralelização: Com T13; integra o resumo T07 quando disponível

## Objetivo

Entregar a entrada de cartões na aplicação e permitir manutenção segura da
configuração sem confundir conta, limite, fatura ou saldo credor.

## Escopo

- Criar rota autenticada de coleção/cadastro e integrar o item **Cartões** à
  navegação existente; criar detalhe `/credit-cards/[id]` conforme TechSpec.
- Implementar formulário de cartão com nome, limite em `MoneyInput`,
  fechamento, vencimento e conta padrão de pagamento quando aplicável.
- Carregar contas e cartões por Server Component/actions tenant-scoped; não
  aceitar `householdId` vindo da URL nem usar fetch genérico no browser.
- Exibir cartões ativos/arquivados, regra vigente, fechamento, vencimento,
  limite contratual e estados vazio/loading/erro.
- Implementar edição de metadados e criação de nova regra de billing com
  vigência; deixar claro que compras antigas mantêm suas datas.
- Implementar arquivamento com confirmação e retirar cartão arquivado dos
  seletores de novas compras/pagamentos, mantendo links históricos.
- Adicionar acessibilidade, layout desktop e responsividade suficiente para
  consulta ocasional mobile, sem criar app nativo.

## Critérios de aceite

- [ ] Usuário autenticado cria cartão pela UI e recebe feedback sem reload
  destrutivo; o cartão aparece no seletor de compra (o seletor de compra é
  consumo do T13; a tela T12 exibe sucesso e link para o detalhe).
- [x] Limite/dias/conta padrão inválidos mostram erro no campo correto e não
  deixam cartão parcial, usando schemas T11 e actions atômicas T05.
- [x] Alterar billing mostra a data de vigência e não promete recalcular
  compras antigas.
- [x] Arquivar exige confirmação, preserva histórico e desabilita novos writes
  no cartão arquivado.
- [x] Household distinto, ID inválido e sessão ausente não vazam existência de
  cartão nem dados técnicos: contexto é resolvido no servidor, IDs inválidos
  usam 404 genérico e erros usam mapa allow-listed.
- [x] A tela diferencia limite contratual, obrigações/faturas/créditos futuros
  e não usa “saldo do cartão” ambíguo.

## Handoff

- T13 usa o seletor de cartões ativos e a conta do detalhe.
- T14 incorpora faturas e pagamento no detalhe.
- T16 cobre cadastro e manutenção por fluxo de usuário.

## Verificações

- [x] Rotas `/credit-cards`, `/credit-cards/new` e `/credit-cards/[id]`, com
  layout autenticado, loading/error/empty, cadastro, edição de metadados,
  versionamento de billing e confirmação de arquivamento implementados em
  `src/app/credit-cards` e `src/components/credit-cards/card-management-screen.tsx`.
- [x] `rtk npm exec -- eslint src/app/credit-cards
  src/components/credit-cards/card-management-screen.tsx
  src/components/credit-cards/card-management-screen.test.tsx
  src/components/auth/authenticated-shell.tsx
  src/components/credit-cards/ui-contracts.ts --max-warnings=0` — passou em
  2026-08-31.
- [x] `rtk npm test -- --run src/components/credit-cards --reporter=dot` — 20
  testes passaram em 2026-08-31, incluindo 2 testes da coleção T12 para
  limite contratual, link canônico, estado vazio e ausência de `householdId`.
- [x] `rtk npm run typecheck` — execução atual sem diagnósticos após a
  integração T13/T14; os erros históricos de `.next-e2e`/`createPayment` não se
  reproduzem.
- [x] `rtk npm run build` — compilação e geração das rotas T12 passaram em
  2026-08-31; os reexports antigos de pagamento/compra foram resolvidos.
- [ ] Prova de fluxo autenticado completo (criar cartão e vê-lo no seletor de
  compra) ainda não está registrada nesta task; permanece no E2E T16.

## Fora de escopo

Dashboard bancário, integração com operadora, cartão virtual, aplicativo
nativo e edição de fatura/limite usado como saldo disponível.
