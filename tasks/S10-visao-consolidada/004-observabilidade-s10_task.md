# T04 — Observabilidade segura da Visão Geral

- Status: Não iniciada
- Onda: 1 (transversal)
- Dependências: T01; infraestrutura de observabilidade do S01
- Paralelização: Com T02, T03, T05 e demais tasks de backend

## Objetivo

Instrumentar a home para diagnosticar erro de agregação, query lenta e falha de
carregamento, sem jamais registrar dado financeiro ou de tenancy.

## Escopo

- Criar a extensão `src/modules/observability/s10.ts` seguindo o padrão já
  usado em `s08.ts`/`s09.ts`: versão de contrato, operações fechadas por tipo,
  estágios derivados, resultados e outcomes enumerados.
- Cobrir as operações mínimas: `overview.read`, `overview.aggregate`,
  `overview.compose`, `overview.render`.
- Registrar duração por bloco e marcar query lenta acima do limite definido em
  T01, com contadores agregados (quantidade de grupos, de itens, de caixinhas),
  nunca com valores.
- Capturar exceção de agregação no Sentry com contexto operacional agregado e
  correlação, preservando erro opaco na resposta.
- Medir falha de carregamento da home distinguindo falha total de degradação
  parcial por bloco.
- Proibir por teste: centavos, saldos, nomes, descrições, categorias,
  referências financeiras, IDs de household/usuário, SQL, payloads, cookies e
  tokens em log, breadcrumb ou evento.

## Subtarefas

- [ ] Implementar o contrato de observabilidade S10 com tipos fechados.
- [ ] Implementar o adapter de instrumentação componível, aplicável às leituras
  de T02/T03 sem que elas conheçam o transporte.
- [ ] Adicionar teste de redaction que falha se qualquer campo proibido chegar
  ao payload.
- [ ] Documentar em `docs/observability-s10-overview.md` as operações, os
  limites de lentidão e o que nunca é registrado.
- [ ] Integrar a instrumentação nas leituras entregues por T02, T03 e T06.

## Critérios de aceite

- [ ] Um erro de agregação gera evento correlacionado e resposta opaca.
- [ ] Query acima do limite é sinalizada com duração e contadores agregados.
- [ ] O teste de redaction cobre todos os campos proibidos e falha ao
  introduzir um deles.
- [ ] Nenhum log da home contém valor monetário ou identificador de tenancy.
- [ ] A instrumentação não altera o resultado nem a ordem das leituras.

## Entregáveis e evidência esperada

- [ ] `src/modules/observability/s10.ts` e `s10.test.ts`.
- [ ] Teste dedicado de redaction.
- [ ] `docs/observability-s10-overview.md`.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: fechamento de T06 e T15.
- Paralelizável: sim; é trilha transversal.

## Fora de escopo

Criar dashboard de métricas externo, alterar observabilidade de S05–S09.
