# T10 — UI: hierarquia de decisão da página principal

- Status: Concluída
- Onda: 3
- Dependências: T05, T06
- Paralelização: Com T11

## Objetivo

Reconstruir a página autenticada principal (`/app`) como Visão Geral, com
hierarquia visual que priorize a decisão: quanto posso gastar, como está o
período e onde o dinheiro está indo.

## Escopo

- Transformar `src/app/app/page.tsx` em Server Component que consome apenas o
  read model consolidado de T06, sem chamar serviços de domínio diretamente.
- Ordenar a página segundo o contrato: bloco de "pode gastar com segurança",
  resumo do período (receitas e despesas planejadas x realizadas, saldo),
  despesas por categoria e ações rápidas de registro.
- Preservar o `SpendableCard` já existente como apresentação do S08 quando ele
  atender ao contrato, evitando um segundo card concorrente para o mesmo número.
- Manter os pontos de entrada rápidos do fluxo semanal (adicionar receita,
  adicionar despesa) previstos no PRD.
- Remover da home o placeholder de estado vazio genérico atual, substituindo-o
  pelos estados reais de cada bloco.
- Preservar o `InviteShareCard` ou reposicioná-lo conforme a hierarquia
  aprovada, sem competir com os indicadores centrais.
- Usar apenas componentes de T05; nada de formatação monetária local.

## Subtarefas

- [x] Implementar a página com composição server-side e `loading.tsx` coerente.
- [x] Montar o bloco de resumo do período e o de despesas por categoria.
- [x] Integrar as ações rápidas sem transformar a home em formulário.
- [x] Ajustar o teste existente `src/app/app/page.test.tsx` ao novo contrato.
- [x] Validar hierarquia de cabeçalhos, landmarks e ordem de foco.

## Critérios de aceite

- [x] A página não importa serviço de domínio de S06/S07/S08/S09 diretamente.
- [x] O número de "pode gastar" na home é o mesmo de `/spendable/breakdown`.
- [x] A hierarquia visual coloca decisão antes de detalhe, sem excesso de
  indicadores, conforme o PRD.
- [x] A página renderiza sem erro com espaço financeiro vazio.
- [x] Nenhum cálculo financeiro acontece no componente.

## Entregáveis e evidência esperada

- [x] `src/app/app/page.tsx` e `src/app/app/loading.tsx` atualizados.
- [x] `src/app/app/page.test.tsx` atualizado e aprovado.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T05, T06.
- Desbloqueia: T12, T14.
- Paralelizável: sim, com T11.

## Fora de escopo

Blocos de compromissos/caixinhas/alertas (T11), estados finais e mobile (T12).
