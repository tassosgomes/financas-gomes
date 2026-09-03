# T06 — Leituras tenant-safe dos datasets exportáveis

- Status: Não iniciada
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T03, T04 e T05

## Objetivo

Produzir, para cada dataset contratado em T01, uma leitura server-side
determinística, isolada por espaço financeiro e adequada a volume, entregando
linhas já no formato declarado — sem formatar CSV e sem recalcular valor.

## Escopo

- Implementar as leituras em `src/modules/export/reads.ts`, reutilizando as
  leituras e adapters existentes de S02–S09 sempre que elas já resolvem o
  dataset; criar SQL próprio apenas quando não existir leitura equivalente.
- Resolver o espaço financeiro exclusivamente no servidor, no padrão de
  tenancy já usado pelos demais módulos, e aplicar o filtro de household em
  toda consulta.
- Aplicar aos dados de transações os mesmos filtros da tela de transações
  quando eles forem informados (TechSpec §98), com a mesma semântica de
  período, conta, categoria e status.
- Garantir ordenação total e determinística por dataset (chave de negócio +
  desempate por ID), para que duas exportações do mesmo estado sejam iguais.
- Ler em páginas/cursor, entregando linhas por streaming, sem materializar o
  dataset inteiro em memória.
- Excluir na origem toda coluna proibida por T01; a redaction não pode depender
  apenas da camada de formatação.
- Declarar o comportamento de dataset cujo slice de origem ainda está aberto:
  ausência explícita e sinalizada, nunca arquivo vazio silencioso nem coluna
  inventada.
- Instrumentar cada dataset com o adapter de T04.

## Subtarefas

- [ ] Implementar a leitura de cada dataset da lista contratada.
- [ ] Reaproveitar leituras existentes e registrar, por dataset, qual foi a
  origem escolhida e por quê.
- [ ] Adicionar testes de integração PostgreSQL de isolamento cross-space com
  IDs forjados.
- [ ] Medir `EXPLAIN (ANALYZE)` das consultas novas e registrar plano e índice
  usado; criar índice apenas se o plano provar necessidade.
- [ ] Integrar a instrumentação de T04.

## Critérios de aceite

- [ ] Nenhuma consulta aceita `householdId` ou `userId` vindo do browser.
- [ ] Teste cross-space com IDs de outro espaço não retorna nenhuma linha.
- [ ] A ordenação é total e reproduzível para todos os datasets.
- [ ] Nenhuma coluna proibida por T01 sai da camada de leitura.
- [ ] Nenhum valor financeiro é recalculado, reagregado ou arredondado aqui.
- [ ] Volume representativo é lido sem carregar o dataset inteiro em memória.

## Entregáveis e evidência esperada

- [ ] `src/modules/export/reads.ts` com testes unitários e de integração
  opt-in.
- [ ] Registro de `EXPLAIN (ANALYZE)` na própria task e migration de índice, se
  necessária, com `db:check` aprovado.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T07.
- Paralelizável: sim.

## Fora de escopo

Serializar CSV, empacotar arquivo, entregar download ou criar tela.
