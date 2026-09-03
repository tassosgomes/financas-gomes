# T03 — Composição tenant-safe das leituras existentes

- Status: Concluída
- Onda: 1
- Dependências: T01; serviços públicos de S06, S07, S08 e S09
- Paralelização: Com T02, T04 e T05

## Objetivo

Criar a camada de composição que reúne, em uma única leitura server-side, os
resultados já produzidos por S06/S07/S08/S09, preservando cada dono de fórmula
e isolando falhas por bloco.

## Escopo

- Consumir `getSpendable`/`spendableService` do S08 sem recalcular a fórmula,
  sem reordenar componentes do breakdown e sem alterar o horizonte/cenário
  padrão fora do que o contrato de T01 declarar.
- Consumir o forecast do S07 para "próximos compromissos" e "próximas
  receitas", respeitando cenário, horizonte e a explicabilidade já existente.
- Consumir `budgetReadAccess` do S09 para o resumo de Caixinhas (saldo
  acumulado, aporte do período, gasto do período, progresso), sem derivar saldo
  próprio.
- Consumir as projeções de cartão do S06 para fatura/compromisso de cartão,
  sem transformá-las em despesa do período.
- Resolver o `FinancialContext` uma única vez no servidor e propagá-lo; nenhum
  serviço pode receber tenancy vinda do browser.
- Executar as leituras de forma concorrente e independente, com resultado
  `ok | error` por bloco, erro opaco e ausência distinguível de zero.
- Aplicar um limite de tempo por bloco definido no contrato, degradando aquele
  bloco em vez da página.
- Não introduzir cache na V1; qualquer exceção exige decisão registrada em T01
  e não pode sacrificar consistência.

## Subtarefas

- [x] Definir as portas de leitura (uma por origem) com injeção de dependência,
  para permitir fake em teste sem tocar nos módulos de origem.
- [x] Implementar o compositor com execução paralela e agregação de resultados
  parciais.
- [x] Mapear os erros de cada origem para os códigos opacos do contrato
  `s10.v1`, preservando a distinção entre "sem dados" e "falha".
- [x] Cobrir com teste cada combinação relevante de sucesso/falha parcial.
- [x] Garantir que nenhuma origem seja chamada mais de uma vez por render.

## Critérios de aceite

- [x] O valor de "quanto posso gastar" exibido é byte a byte o produzido pelo
  S08 para o mesmo contexto.
- [x] A falha de uma origem não impede o restante da home de carregar, e o
  bloco afetado informa erro em vez de zero.
- [x] Nenhuma chamada recebe `householdId` do cliente.
- [x] A composição é livre de dependência circular entre módulos e não importa
  detalhes internos das origens, apenas seus contratos públicos.
- [x] A ausência de S09 (gates ainda abertos) resulta em bloco vazio/indisponível
  contratado, nunca em erro global da página.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/composition.ts` e portas de leitura tipadas.
- [x] Testes unitários com fakes cobrindo sucesso total, falha parcial e falha
  total.
- [x] Evidência de que nenhuma fórmula foi reimplementada (diff sem cálculo
  monetário próprio fora de T02).
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T06.
- Paralelizável: sim, com T02, T04 e T05.

## Fora de escopo

Agregar categorias (T02), montar o read model público (T06), criar tela.
