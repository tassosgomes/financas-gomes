# T14 — Testes unitários e de integração PostgreSQL

- Status: Não iniciada
- Onda: 4
- Dependências: T03, T06, T07, T08 e T09 quando aplicável
- Paralelização: Com T10–T13 durante a escrita

## Objetivo

Provar por teste automatizado os comportamentos que o slice promete: exportação
correta e isolada, serialização estável, idempotência de retry e falha de job
visível.

## Escopo

- Testes puros: encoder CSV (escape, unicode, injeção de fórmula,
  determinismo), formatadores de dinheiro e data, contratos de UI e
  classificação de erro de retry.
- Testes de integração PostgreSQL, no padrão opt-in por variável já usado pelo
  repositório, com a variável registrada em `test:integration`:
  - exportação com espaço vazio e com espaço completo;
  - exportação com os filtros da tela de transações aplicados, incluindo filtro
    sem resultado;
  - isolamento cross-space com IDs forjados de outro household, em todos os
    datasets;
  - reconciliação: o total de linhas e as chaves exportadas batem com a
    consulta de origem;
  - idempotência de job: execução dupla e execução concorrente na mesma janela
    lógica não duplicam efeito;
  - retomada após falha no meio da execução.
- Teste de simulação de falha de job: erro transitório repetido com backoff,
  erro determinístico encerrado com estado registrado, evento emitido.
- Teste de redaction dedicado ao S11: nenhum campo proibido em log, breadcrumb,
  evento, manifesto, nome de arquivo ou resposta de erro.
- Seed determinístico de volume representativo reutilizável por T15, em
  `tests/fixtures/s11-operacao-confiavel/`.
- Medição do tempo de exportação com volume representativo, comparada ao limite
  definido em T01.

## Subtarefas

- [ ] Escrever os testes puros do encoder e dos formatadores.
- [ ] Escrever os testes de integração de exportação e isolamento.
- [ ] Escrever os testes de idempotência, retry e falha de job.
- [ ] Escrever o teste de redaction do S11.
- [ ] Construir o seed de volume representativo e medir a exportação.

## Critérios de aceite

- [ ] Exportação com dados vazios e completos coberta por teste executado.
- [ ] Isolamento cross-space coberto em todos os datasets exportáveis.
- [ ] Retry e idempotência de job comprovados por teste, incluindo execução
  concorrente.
- [ ] Simulação de falha de job comprova o estado registrado e o evento emitido.
- [ ] O teste de redaction falha ao introduzir qualquer campo proibido.
- [ ] A suíte de integração opt-in roda por comando documentado e é
  determinística.

## Entregáveis e evidência esperada

- [ ] Testes versionados junto aos módulos correspondentes.
- [ ] Seed determinístico em `tests/fixtures/s11-operacao-confiavel/`.
- [ ] Variável de integração adicionada ao script `test:integration`.
- [ ] Saída resumida de `npm test` e da suíte de integração registrada na task.

## Sequenciamento

- Bloqueado por: T03, T06, T07, T08.
- Desbloqueia: T15, T16.
- Paralelizável: sim; a escrita pode começar na Onda 1.

## Fora de escopo

Teste E2E de navegador (T15) e teste de restauração de infraestrutura (T13).
