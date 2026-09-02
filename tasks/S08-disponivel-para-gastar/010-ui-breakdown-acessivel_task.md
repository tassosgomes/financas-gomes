# T10 — UI de breakdown acessível

- Status: Concluída
- Onda: 3
- Dependências: T04 e T07
- Paralelização: Com T09

## Objetivo

Permitir que o usuário abra uma composição clara do cálculo e navegue para as
origens que levaram ao ponto mais restritivo.

## Escopo

- Mostrar saldo de referência, menor saldo projetado, buffer, resultado bruto,
  disponível exibido, déficit quando houver e a regra/período aplicados.
- Listar/permitir drill-down dos itens causais pelo identificador autorizado;
  tratar lista vazia, truncada e origem removida/cancelada de forma explícita.
- Implementar semântica de diálogo/página, foco, teclado, leitor de tela e
  valores não dependentes exclusivamente de cor.

## Subtarefas

- [x] Criar a página server-side de breakdown consumindo o read model de T06,
  sem receber identificador de household do navegador.
- [x] Renderizar a composição completa e a relação financeira exatamente como
  fornecidas pelo contrato, com semântica de página, foco, teclado e leitor de
  tela.
- [x] Expor os itens causais com drill-down por links autorizados pelo
  servidor, incluindo lista vazia, resposta truncada e origem removida/cancelada.
- [x] Cobrir reconciliação com o card, isolamento de tenant e estados de
  carregamento, ausência e erro em testes focados.
- [x] Registrar evidências de verificação e concluir a task somente após os
  critérios de aceite passarem.

## Critérios de aceite

- [x] Soma/relação exibida reconcilia exatamente o valor do card.
- [x] Navegação a uma origem não amplia escopo de household nem quebra quando
  a origem deixou de estar disponível.

## Entrega e evidências (2026-09-01)

- [x] `src/app/spendable/layout.tsx`, `src/app/spendable/loading.tsx` e
  `src/app/spendable/breakdown/page.tsx` publicam uma página autenticada
  server-first. A rota aceita apenas `asOf`, `scenario` e `horizon`; ignora
  `householdId`, `returnTo` e referências fornecidas pela URL, enquanto o
  serviço resolve o contexto financeiro no servidor.
- [x] A página mostra o card e o breakdown com saldo de referência, menor
  saldo projetado, buffer, bruto, exibido, déficit, reserva, regra e período.
  A seção “Reconciliação com o card” explicita a relação mínimo − buffer =
  bruto e o limite de zero aplicado ao valor exibido.
- [x] `SpendableBreakdownView` preserva os pontos empatados, oferece links
  somente por `spendableCausalOriginHref` e informa explicitamente página vazia,
  contagem/truncamento, cursor pendente e origem removida/cancelada. Landmarks,
  headings, `aria-live`, texto independente de cor e estados de foco suportam
  teclado e leitor de tela.
- [x] `src/app/spendable/breakdown/page.test.tsx` cobre leitura server-side,
  reconciliação, origem autorizada, isolamento contra seletor de household,
  ausência, erro sem vazamento, truncamento e origem indisponível.
- [x] `rtk npm exec vitest -- run src/app/app/page.test.tsx
  src/components/spendable src/app/spendable/breakdown/page.test.tsx
  src/modules/spendable --reporter=dot` — 13 arquivos passaram, 73 testes
  passaram, 7 testes PostgreSQL opt-in foram ignorados e 1 caso permaneceu
  `todo` de S09.
- [x] `rtk npm exec eslint -- src/app/spendable
  src/components/spendable/spendable-breakdown.tsx
  src/modules/spendable/ui-contracts.ts --max-warnings=0`, `rtk npm exec tsc
  -- --noEmit --pretty false --incremental false` e `rtk git diff --check` —
  passaram sem erros.

## Handoff

- [x] T11 pode reutilizar o teste de rota e os componentes compartilhados sem
  duplicar a fórmula; T12/T13 permanecem fora do escopo desta task.
