# T16 — Validação de release, DoD do S11 e fechamento da V1

- Status: Não iniciada
- Onda: 4
- Dependências: T12, T13, T14, T15
- Paralelização: Não

## Objetivo

Fechar o slice — e com ele a V1 — com prova executada de cada critério de
aceite, e com registro honesto do que ficou fora e por quê.

## Escopo

- Executar e registrar os gates: `npm run lint`, `npm run typecheck`,
  `npm test`, a suíte de integração opt-in, `npm run test:e2e`, `db:check` e
  `rtk git diff --check`.
- Reconferir cada critério de aceite de `docs/S11-operacao-confiavel.md` contra
  a evidência produzida por T02–T15, apontando o teste, a execução ou o
  documento que o prova.
- Confirmar as decisões de T02 ainda válidas no fechamento: cobertura de
  backup, ausência ou presença de orquestrador durável e o gatilho de revisão
  de cada uma.
- Verificar a política de segredos de ponta a ponta: exportação, manifesto,
  nomes de arquivo, logs, eventos de Sentry, documentação e repositório.
- Auditar a Definition of Done da V1 no conjunto dos slices S01–S11 e registrar
  os gates externos ainda abertos (S09 e S10) com origem, sem atribuí-los ao
  S11.
- Escrever o fechamento da V1 em `docs/`: o que existe, o que foi
  deliberadamente adiado, e o que a próxima versão herda.
- Atualizar `tasks.md` e o status de cada task do slice com evidência datada.

## Subtarefas

- [ ] Executar todos os gates e colar a saída resumida na task.
- [ ] Preencher a matriz critério → evidência.
- [ ] Reconfirmar as decisões de T02 e registrar a data da reconfirmação.
- [ ] Escrever o documento de fechamento da V1.
- [ ] Atualizar o índice e os status das tasks do slice.

## Critérios de aceite

- [ ] Todos os critérios de aceite do documento do S11 estão marcados com
  evidência rastreável, ou explicitamente reportados como não atendidos.
- [ ] Nenhum gate é declarado aprovado sem comando e resultado registrados.
- [ ] Falhas externas herdadas estão descritas com origem e não atribuídas ao
  S11.
- [ ] A Definition of Done do slice está integralmente avaliada.
- [ ] O documento de fechamento distingue o que foi entregue do que foi adiado.

## Entregáveis e evidência esperada

- [ ] Seção de evidências datada nesta task.
- [ ] Documento de fechamento da V1 em `docs/`.
- [ ] `tasks/S11-operacao-confiavel/tasks.md` atualizado.

## Sequenciamento

- Bloqueado por: T12, T13, T14, T15.
- Desbloqueia: fechamento da V1.
- Paralelizável: não.

## Fora de escopo

Implementar qualquer funcionalidade nova ou reabrir escopo de slices
anteriores.
