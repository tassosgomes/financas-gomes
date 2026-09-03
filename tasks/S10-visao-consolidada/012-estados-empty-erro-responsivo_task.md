# T12 — Estados vazio/erro/loading e consulta mobile

- Status: Não iniciada
- Onda: 3
- Dependências: T10, T11 (primitivas em T05)
- Paralelização: Parcial, após os blocos existirem

## Objetivo

Fazer a Visão Geral permanecer compreensível com nenhum dado, poucos dados e
volume representativo, em desktop e na consulta ocasional pelo celular.

## Escopo

- Fechar o estado do usuário novo: cada bloco explica o que aparecerá ali e
  oferece a ação inicial correspondente (criar conta, registrar transação,
  criar Caixinha), sem transformar a home em onboarding.
- Diferenciar visualmente "sem dados" de "falha ao carregar" em todos os
  blocos, sem exibir zero monetário para erro.
- Implementar loading em nível de página e por bloco (streaming/skeleton),
  evitando salto de layout.
- Implementar recuperação: link de tentar novamente por bloco e fallback global
  em `error.tsx` sem perder a navegação.
- Garantir responsividade a partir de 360px: sem scroll horizontal, alvos de
  toque adequados, tabelas/listas longas com rolagem contida.
- Revisar densidade de informação para não violar o princípio de "registrar
  pouco, entender muito" do PRD.

## Subtarefas

- [ ] Escrever os textos de estado vazio por bloco e revisá-los quanto ao tom.
- [ ] Implementar skeletons por bloco e verificar ausência de layout shift.
- [ ] Implementar retry por bloco e o fallback de página.
- [ ] Validar breakpoints 360/768/1280 e a ordem de leitura em cada um.
- [ ] Testar com espaço vazio, poucos dados e o seed de volume de T09.

## Critérios de aceite

- [ ] Espaço financeiro novo abre a home sem erro, sem número inventado e com
  próximo passo claro em cada bloco.
- [ ] Falha de um bloco é visualmente distinta de ausência de dados.
- [ ] Nenhum breakpoint de 360px em diante produz scroll horizontal.
- [ ] Loading não causa deslocamento perceptível do conteúdo já renderizado.
- [ ] A página continua legível com volume representativo, sem truncar número
  de forma ambígua.

## Entregáveis e evidência esperada

- [ ] Estados finais implementados nos componentes de `src/components/overview/`.
- [ ] Testes de renderização por estado e por breakpoint relevante.
- [ ] Evidência visual (screenshot) dos três volumes de dados.
- [ ] `vitest`, `eslint` e `tsc` aprovados.

## Sequenciamento

- Bloqueado por: T10, T11.
- Desbloqueia: T14, T15.
- Paralelizável: parcialmente, por bloco.

## Fora de escopo

App nativo, PWA, offline, experiência mobile-first.
