# T07 — Drill-down determinístico para as telas de origem

- Status: Concluída
- Onda: 2
- Dependências: T06; rotas e filtros de S05, S06, S07, S08 e S09
- Paralelização: Com T08 e T09

## Objetivo

Permitir que o usuário navegue de qualquer agregado da home para os lançamentos
que o compõem, chegando a uma tela que mostra exatamente o mesmo conjunto de
dados.

## Escopo

- Gerar, no servidor, os links de drill-down de cada bloco a partir das chaves
  de reconciliação publicadas por T06.
- Mapear os destinos: categoria → `/transactions` com período + categoria;
  receitas/despesas realizadas → `/transactions` com tipo e período; pode gastar
  → `/spendable/breakdown`; próximos compromissos → `/forecast` com horizonte e
  cenário; caixinhas → `/budgets` (e detalhe da Caixinha quando disponível);
  cartão → `/credit-cards/[id]`.
- Usar as constantes de rota já existentes (`routes.ts` de cada módulo) em vez
  de literais espalhados.
- Manter os filtros na URL, no formato que a tela de destino já entende, sem
  criar um segundo dialeto de query string.
- Tratar destino indisponível (por exemplo, gates abertos de S09) com link
  desabilitado e explicação, nunca com link quebrado.
- Preservar acessibilidade: cada link tem rótulo descritivo e alvo de toque
  adequado no mobile.

## Subtarefas

- [x] Implementar o construtor de links a partir do read model, com testes.
- [x] Validar cada URL gerada contra o parser de filtros da tela de destino.
- [x] Cobrir o caso de destino indisponível e o de agregado vazio.
- [x] Garantir que nenhum link exponha identificador de outro household.
- [x] Registrar no ADR-013 o mapa final agregado → destino → filtros.

## Critérios de aceite

- [x] Abrir o link de um agregado mostra na tela de destino o mesmo total
  exibido na home, para o mesmo `asOf`.
- [x] Nenhum link é montado por concatenação improvisada de string na camada de
  apresentação.
- [x] Filtros permanecem na URL e sobrevivem a refresh e a compartilhamento
  dentro do mesmo espaço financeiro.
- [x] Destinos ainda não entregues aparecem como indisponíveis e explicados.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/links.ts` e testes.
- [x] Testes que parseiam a URL gerada com o contrato de filtro da tela de
  destino.
- [x] Atualização do mapa de drill-down no ADR-013.
- [x] `vitest`, `eslint` e `tsc` aprovados.

## Sequenciamento

- Bloqueado por: T06.
- Desbloqueia: T11, T14.
- Paralelizável: sim, com T08 e T09.

## Fora de escopo

Criar novos filtros nas telas de destino ou alterar o comportamento delas.
