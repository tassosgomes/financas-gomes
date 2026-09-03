# T13 — Testes unitários e de integração PostgreSQL

- Status: Não iniciada
- Onda: 4
- Dependências: T02–T09 (escrita pode ser incremental desde T02)
- Paralelização: Com T10–T12 durante a escrita

## Objetivo

Provar, com PostgreSQL real e com testes puros, que os agregados reconciliam,
que não há dupla contagem e que nenhum dado de outro espaço financeiro alcança
a Visão Geral.

## Escopo

- Testes puros das derivações de T02 (totais, grupos, refund, parcela,
  categoria ausente, resíduo de arredondamento) e de T08 (alertas por regra e
  por limite).
- Testes puros da composição de T03 com fakes, cobrindo sucesso total, falha
  parcial e falha total.
- Testes de integração com PostgreSQL descartável e seed determinístico:
  - dataset vazio;
  - dataset representativo com transações, cartão, parcelas, forecast e
    caixinhas;
  - reconciliação agregado x tela de detalhe;
  - cross-space com dois households (A/B) e IDs forjados.
- Teste explícito de não dupla contagem cartão versus transação, com números.
- Teste de que erro de origem nunca vira zero monetário.
- Reutilizar o seed de T09 e as fixtures de S08/S09 em vez de criar novas
  fontes de dado divergentes.
- Registrar os flags `T10_INTEGRATION` no script `test:integration`.

## Subtarefas

- [ ] Escrever os testes puros das derivações e da composição.
- [ ] Escrever a suíte de integração opt-in com seed A/B.
- [ ] Escrever o teste de reconciliação que compara home x reads de origem.
- [ ] Escrever o teste cross-space com ID forjado e resultado opaco.
- [ ] Integrar a flag de integração ao `package.json` e à CI.

## Critérios de aceite

- [ ] Toda invariante de T01 tem pelo menos um teste que falharia se ela fosse
  violada.
- [ ] A suíte de integração roda contra PostgreSQL real e é determinística.
- [ ] O teste cross-space prova ausência de vazamento em número, nome,
  referência e link.
- [ ] A reconciliação é comparada em centavos, não em texto formatado.
- [ ] `npm run check` e a suíte de integração opt-in passam.

## Entregáveis e evidência esperada

- [ ] `src/modules/overview/*.test.ts` e `*.integration.test.ts`.
- [ ] Fixtures em `tests/fixtures/s10-visao-consolidada/`.
- [ ] Atualização de `package.json` e do workflow de CI.
- [ ] Saída dos comandos executados registrada na task.

## Sequenciamento

- Bloqueado por: T02–T09 para o fechamento; escrita começa antes.
- Desbloqueia: T14, T15.
- Paralelizável: sim, durante a escrita.

## Fora de escopo

E2E de navegador (T14) e validação final de release (T15).
