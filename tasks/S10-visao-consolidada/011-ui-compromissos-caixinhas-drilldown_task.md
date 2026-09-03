# T11 — UI: compromissos futuros, caixinhas, alertas e drill-down

- Status: Não iniciada
- Onda: 3
- Dependências: T05, T06, T07, T08
- Paralelização: Com T10

## Objetivo

Completar a Visão Geral com a parte de futuro e finalidade: próximos
compromissos, próximas receitas, resumo de caixinhas e alertas, todos
navegáveis para a tela de origem.

## Escopo

- Renderizar "próximos compromissos" e "próximas receitas" a partir do bloco de
  forecast do read model, com data, descrição curta, valor e certeza quando o
  contrato expuser.
- Renderizar o resumo de caixinhas com saldo acumulado, aporte do período,
  gasto do período e progresso, conforme o vocabulário do S09.
- Renderizar os alertas de T08 com severidade, mensagem orientativa e destino.
- Aplicar os links de drill-down de T07 em cada item e em cada cabeçalho de
  bloco, com rótulo acessível.
- Limitar a quantidade de itens por bloco conforme o contrato, com um link
  "ver todos" para a tela de origem em vez de paginação na home.
- Respeitar os gates abertos do S09: enquanto os movimentos e a UI de Caixinhas
  não estiverem entregues, o bloco mostra o estado contratado de
  indisponibilidade, sem número inventado.

## Subtarefas

- [ ] Implementar os blocos de compromissos e receitas futuras.
- [ ] Implementar o bloco de caixinhas consumindo o read model do S09 via T06.
- [ ] Implementar o bloco de alertas com severidades e teto de itens.
- [ ] Ligar todos os drill-downs e validar rótulos acessíveis.
- [ ] Testar cada bloco com dado cheio, poucos itens, vazio e erro.

## Critérios de aceite

- [ ] Cada item exibido navega para a tela que contém o lançamento/origem
  correspondente.
- [ ] O resumo de caixinhas reconcilia com `/budgets` no mesmo período.
- [ ] Compromisso de cartão aparece como compromisso futuro e não é contado
  novamente como despesa realizada do período.
- [ ] Blocos indisponíveis por gate externo são explicados, não silenciados.
- [ ] Nenhum bloco excede o teto de itens definido no contrato.

## Entregáveis e evidência esperada

- [ ] Componentes de bloco em `src/components/overview/` e composição na página.
- [ ] Testes de renderização por estado.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T05, T06, T07, T08.
- Desbloqueia: T12, T14.
- Paralelizável: sim, com T10.

## Fora de escopo

Editar dados a partir da home, criar filtro próprio, paginar na home.
