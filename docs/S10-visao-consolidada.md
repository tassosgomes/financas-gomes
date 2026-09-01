# S10 — Visão financeira consolidada

## Objetivo

Unificar os dados construídos nos slices anteriores em uma visão que responda rapidamente às perguntas centrais do produto.

## Valor entregue

Ao abrir o sistema, o usuário entende onde o dinheiro está indo, quanto pode gastar e se seus compromissos/objetivos futuros estão encaminhados.

## Perguntas que a tela deve responder

- Onde está indo o dinheiro?
- O que posso gastar agora sem comprometer o que já planejei?
- Como estão meus compromissos futuros?
- Como estão minhas caixinhas/objetivos?

## Escopo

- Resumo do período atual.
- Despesas por categoria ou agrupamento principal.
- Receitas/despesas realizadas.
- Disponível para gastar vindo do cálculo único do S08.
- Próximos compromissos relevantes.
- Resumo de caixinhas.
- Links/drill-down para as telas de origem.
- Empty states coerentes para usuário novo.

## Fora de escopo

- BI configurável.
- Dashboard com dezenas de widgets.
- Relatórios customizados pelo usuário.
- Benchmark contra outros usuários.
- Insights de IA não previstos no PRD.

## Dependências

- S05.
- S07.
- S08.
- S09.

## Dados / domínio

Esta slice deve **consumir serviços de domínio existentes**, evitando reimplementar fórmulas no frontend ou criar agregações concorrentes que possam divergir.

## Backend

- Queries agregadas eficientes.
- Contrato de dashboard consolidado ou composição eficiente de endpoints existentes.
- Paginação/drill-down onde necessário.
- Cache somente se necessário e sem sacrificar consistência da V1.

## Frontend

- Página principal autenticada final da V1.
- Hierarquia visual priorizando os indicadores centrais.
- Navegação para detalhes.
- Estados de loading/erro/empty.

## Critérios de aceite

- [ ] Totalizações reconciliam com as telas de detalhe.
- [ ] "Quanto posso gastar" é exatamente o mesmo cálculo do S08.
- [ ] Usuário consegue navegar de um agregado para os lançamentos que o compõem.
- [ ] Não há dupla contagem de cartão versus transação.
- [ ] Dashboard permanece compreensível com nenhum dado, poucos dados e volume representativo.
- [ ] Nenhum dado de outro espaço financeiro aparece em agregações.

## Testes

- Dataset vazio.
- Dataset representativo com transações, cartão e caixinhas.
- Reconciliação de agregados.
- Testes cross-space.
- E2E da home para detalhes.

## Observabilidade

- Capturar erros de agregação.
- Monitorar queries lentas.
- Medir falhas de carregamento da home se houver infraestrutura para isso.

## Tarefas internas sugeridas

1. Definir contrato de dados da home.
2. Implementar agregações reutilizando serviços existentes.
3. Criar layout da visão consolidada.
4. Adicionar drill-down.
5. Validar reconciliação numérica.
6. Testar performance com volume representativo.

## Definition of Done

A home da aplicação entrega, sem cálculo manual do usuário, uma visão coerente do presente e do futuro financeiro conforme a proposta de valor da V1.
