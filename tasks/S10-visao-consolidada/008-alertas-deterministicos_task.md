# T08 — Alertas determinísticos da V1

- Status: Concluída
- Onda: 2
- Dependências: T06
- Paralelização: Com T07 e T09

## Objetivo

Entregar o bloco de alertas da home como derivação determinística dos read
models já existentes, orientando o usuário sem criar uma nova fonte de verdade
e sem qualquer inferência de IA.

## Escopo

- Implementar apenas alertas cuja regra seja fechada, calculável a partir do
  read model consolidado e reproduzível: mês futuro projetado negativo,
  compromisso relevante próximo, receita prevista ainda não realizada,
  Caixinha com saldo insuficiente e disponibilidade para gastar não positiva.
- Derivar cada alerta de dados já retornados por T06; nenhuma query nova, nenhum
  limiar inventado fora do contrato de T01.
- Classificar em `normal | atenção | crítico`, com um teto de alertas exibidos e
  ordenação determinística por severidade e data.
- Escrever mensagens orientativas, sem tom punitivo, conforme o PRD.
- Cada alerta carrega o link de drill-down correspondente (T07).
- Tratar ausência de dado como ausência de alerta, nunca como alerta crítico.

## Subtarefas

- [x] Escrever a tabela de regras (condição, severidade, mensagem, destino) e
  aprová-la contra o ADR-013.
- [x] Implementar a derivação pura dos alertas com testes por regra.
- [x] Cobrir limites: exatamente no limiar, logo abaixo e logo acima.
- [x] Cobrir espaço vazio, dado parcial e origem em erro.
- [x] Garantir ordenação e teto determinísticos.

## Critérios de aceite

- [x] Toda regra é pura e determinística; a mesma entrada gera exatamente o
  mesmo conjunto de alertas.
- [x] Nenhum alerta consulta o banco por conta própria.
- [x] Uma origem em erro não gera alerta falso nem esconde alerta válido de
  outra origem.
- [x] As mensagens seguem o tom orientativo e não expõem cálculo interno.
- [x] Um espaço financeiro novo não recebe alerta crítico.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/alerts.ts` e testes por regra e por limite.
- [x] Tabela de regras registrada no ADR-013.
- [x] `vitest`, `eslint` e `tsc` aprovados.

## Sequenciamento

- Bloqueado por: T06.
- Desbloqueia: T11, T14.
- Paralelizável: sim, com T07 e T09.

## Fora de escopo

Notificação por e-mail/push, alerta configurável, insight de IA, alerta que
exija nova fonte de dados.
