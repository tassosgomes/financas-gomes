# S05 — Revisão e organização das transações

## Objetivo

Transformar a massa de transações manuais/importadas em informação organizada e confiável para os cálculos posteriores.

## Valor entregue

O usuário consegue revisar rapidamente seus lançamentos, corrigir classificação e encontrar movimentações que precisam de atenção.

## Fluxo principal

1. Usuário abre a lista de transações.
2. Filtra ou identifica lançamentos sem classificação adequada.
3. Abre uma transação.
4. Ajusta descrição, categoria ou demais campos editáveis.
5. Continua a revisão até que os dados estejam confiáveis.

## Escopo

- Filtros úteis para revisão.
- Estado de transação sem categoria quando permitido.
- Edição eficiente de categoria.
- Alteração dos campos permitidos sem destruir a origem/importação.
- Busca textual simples, se necessária para o fluxo.
- Indicadores de lançamentos que precisam de revisão.

## Fora de escopo

- Motor complexo de regras automáticas.
- IA de categorização automática.
- Reconciliação bancária avançada.
- Auditoria granular de alterações.

## Dependências

- S03.
- S04 para validar o caso principal de alto volume, embora parte do slice possa começar antes.

## Dados / domínio

- Preservar `source/origin` da transação.
- Separar dado de origem de campos editáveis quando isso evitar perda de rastreabilidade.
- Categoria pode permanecer `null` nos casos definidos para simplificar o fluxo manual.

## Backend

- Filtros paginados/performáticos.
- Update seguro dos campos editáveis.
- Query para itens que precisam de revisão.
- Integridade por espaço financeiro.

## Frontend

- Listagem com filtros.
- Sinalização de item pendente de organização.
- Edição rápida ou detalhe suficientemente eficiente.
- Preservar contexto da lista após edição.

## Critérios de aceite

- [ ] Usuário encontra transações sem categoria quando existirem.
- [ ] Usuário altera categoria sem recriar a transação.
- [ ] Alteração não remove informação necessária sobre a origem do lançamento.
- [ ] Filtros retornam apenas dados do espaço atual.
- [ ] Lista continua utilizável com volume representativo de extrato real.

## Testes

- Integração dos filtros.
- Edição de categoria.
- Preservação de origem.
- Casos com categoria nula.
- Teste de performance básico sobre volume representativo.

## Observabilidade

- Erros de query/update no Sentry.
- Instrumentar consultas lentas quando a stack escolhida permitir.

## Tarefas internas sugeridas

1. Definir estados que exigem revisão.
2. Implementar filtros/query.
3. Implementar edição rápida ou fluxo equivalente.
4. Garantir preservação da origem.
5. Criar cenários de volume.
6. Cobrir testes.

## Definition of Done

Após importar um extrato real, o usuário consegue deixar suas transações suficientemente organizadas para alimentar relatórios e cálculos da V1 sem intervenção no banco.
