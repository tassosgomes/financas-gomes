# T06 — Read model consolidado da home e reconciliação

- Status: Concluída
- Onda: 2
- Dependências: T02, T03; instrumentação de T04
- Paralelização: Com o acabamento de T04 e a escrita incremental de T13

## Objetivo

Publicar o read model público `s10.v1` da Visão Geral, unindo a agregação do
período (T02) e a composição das origens (T03) em um contrato único, estável e
reconciliável com as telas de detalhe.

## Escopo

- Implementar `getOverviewForContext` / `overviewReadAccess` no módulo de visão
  geral, recebendo `FinancialContext` resolvido no servidor e `asOf`.
- Montar todos os blocos contratados em T01, cada um com seu estado
  (`ready | empty | error`) e sua origem declarada.
- Garantir que o bloco de "pode gastar" seja repasse direto do S08, incluindo
  cenário, horizonte e as referências necessárias ao drill-down do breakdown.
- Garantir que o resumo de Caixinhas seja repasse do S09 e que reserva não seja
  somada nem subtraída novamente nos totais do período.
- Expor as chaves de reconciliação de cada agregado: filtro equivalente,
  período e contagem de itens, para que T07 gere links que reproduzem
  exatamente o número exibido.
- Serializar tudo com strings de centavos, datas ISO e erros opacos; nenhum
  campo interno de tenancy pode vazar.
- Instrumentar a leitura com a extensão S10 de T04.
- Criar a Server Action fina de leitura da home, sem lógica financeira.

## Subtarefas

- [x] Implementar o serviço de leitura consolidada e seu contrato público.
- [x] Compor T02, T03 e T04 sem duplicar chamada às origens.
- [x] Implementar as chaves de reconciliação por agregado.
- [x] Criar `src/app/actions/overview.ts` como Server Action fina.
- [x] Cobrir com testes: espaço vazio, dados parciais, falha por bloco e
  reconciliação numérica contra os reads de origem.

## Critérios de aceite

- [x] Total de despesas do período == soma dos grupos de categoria == total
  retornado pelo read de transações com o filtro equivalente.
- [x] "Quanto posso gastar" é idêntico ao valor da tela `/spendable/breakdown`
  para o mesmo `asOf` e contexto.
- [x] Resumo de caixinhas reconcilia com `/budgets` para o mesmo período.
- [x] Não há dupla contagem de cartão versus transação em nenhum total.
- [x] Um household vizinho com dados nunca altera qualquer número retornado.
- [x] Uma origem indisponível produz bloco em erro e o restante permanece
  `ready`.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/service.ts` e `read-contracts.ts`.
- [x] `src/app/actions/overview.ts`.
- [x] Testes unitários com fakes e teste PostgreSQL opt-in de reconciliação e
  isolamento cross-space.
- [x] `vitest`, `eslint`, `tsc` e `rtk git diff --check` aprovados.

## Sequenciamento

- Bloqueado por: T02, T03.
- Desbloqueia: T07, T08, T09, T10, T11.
- Paralelizável: parcialmente, com T04 e T13.

## Fora de escopo

Renderizar tela, definir alerta (T08), otimizar índice (T09).
