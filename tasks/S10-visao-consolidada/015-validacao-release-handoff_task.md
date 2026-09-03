# T15 — Validação de release, DoD e handoff para S11

- Status: Não iniciada
- Onda: 4
- Dependências: T04, T09, T13, T14
- Paralelização: Não

## Objetivo

Fechar o slice com prova executada de cada critério de aceite do S10 e entregar
ao S11 um handoff explícito do que a home consome e do que ela expõe.

## Escopo

- Executar e registrar os gates: `npm run lint`, `npm run typecheck`,
  `npm test`, a suíte de integração opt-in, `npm run test:e2e`, `db:check` e
  `rtk git diff --check`.
- Reconferir cada critério de aceite de `docs/S10-visao-consolidada.md` contra a
  evidência produzida por T02–T14, apontando o teste ou o comando que o prova.
- Confirmar que "quanto posso gastar" continua sendo exatamente o cálculo do
  S08 e que a home não introduziu nenhuma fórmula concorrente.
- Verificar a observabilidade em execução real: erro de agregação capturado,
  query lenta sinalizada e ausência de dado sensível nos logs.
- Registrar explicitamente os gates externos ainda abertos (por exemplo tasks
  pendentes do S09) e o que a home faz enquanto eles não fecham.
- Escrever o handoff S10 → S11 com as leituras usadas, os pontos de falha
  monitorados e o que a exportação/backup precisa considerar.
- Atualizar `tasks.md` e os status das tasks com evidência datada.

## Subtarefas

- [ ] Executar todos os gates e colar a saída resumida na task.
- [ ] Preencher a matriz critério → evidência.
- [ ] Validar observabilidade com um erro provocado em ambiente local.
- [ ] Escrever o handoff S10 → S11.
- [ ] Atualizar índice e status das tasks do slice.

## Critérios de aceite

- [ ] Todos os critérios de aceite do documento do S10 estão marcados com
  evidência rastreável, ou explicitamente reportados como não atendidos.
- [ ] Nenhum gate é declarado aprovado sem comando e resultado registrados.
- [ ] Falhas externas herdadas estão descritas com origem e não atribuídas ao
  S10.
- [ ] O handoff descreve o contrato `s10.v1` e seus consumidores.
- [ ] A Definition of Done do slice está integralmente avaliada.

## Entregáveis e evidência esperada

- [ ] Seção de evidências datada nesta task.
- [ ] Handoff S10 → S11 em `docs/` ou no ADR-013.
- [ ] `tasks/S10-visao-consolidada/tasks.md` atualizado.

## Sequenciamento

- Bloqueado por: T04, T09, T13, T14.
- Desbloqueia: início efetivo do S11.
- Paralelizável: não.

## Fora de escopo

Implementar exportação, backup ou runbook — escopo do S11.
