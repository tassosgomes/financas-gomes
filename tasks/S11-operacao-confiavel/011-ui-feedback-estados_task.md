# T11 — UI: feedback de geração, conclusão, erro e estados vazios

- Status: Não iniciada
- Onda: 3
- Dependências: T05, T10
- Paralelização: Com T09 e T12

## Objetivo

Tornar a exportação previsível para o usuário: ele precisa saber que a geração
começou, quando terminou, o que recebeu e o que fazer quando falhou — sem
mensagem técnica e sem estado ambíguo.

## Escopo

- Implementar os estados contratados em T05: ocioso, gerando, concluído com
  arquivo entregue, concluído sem dados e erro.
- Impedir disparo duplicado enquanto uma geração está em andamento, e refletir
  isso no rótulo e no estado do controle.
- Apresentar erro de forma acionável e opaca: o que aconteceu em linguagem de
  usuário, o que ele pode fazer e, quando útil, uma referência de correlação
  opaca — nunca mensagem de driver, SQL, caminho ou detalhe de provedor.
- Tratar o caso de espaço vazio e o caso de filtro sem resultado como estados
  próprios, distintos de erro.
- Tratar o estouro de limite de tamanho/tempo definido em T07 com orientação
  concreta, em vez de falha genérica.
- Garantir feedback perceptível sem depender apenas de cor e anunciar mudanças
  de estado para leitores de tela.

## Subtarefas

- [ ] Implementar os estados e as transições no componente de exportação.
- [ ] Implementar a proteção contra disparo duplicado.
- [ ] Escrever os textos de erro e de estado vazio.
- [ ] Cobrir cada estado com teste de componente, incluindo o de erro.

## Critérios de aceite

- [ ] Cada estado contratado em T05 é alcançável e distinguível na tela.
- [ ] Nenhum estado de erro é apresentado como sucesso vazio.
- [ ] Disparo duplicado não gera duas exportações concorrentes do mesmo usuário.
- [ ] Nenhuma mensagem exibida contém detalhe técnico interno.
- [ ] Mudança de estado é perceptível sem depender de cor e é anunciada para
  tecnologia assistiva.

## Entregáveis e evidência esperada

- [ ] Componentes de estado e testes cobrindo todos os estados.
- [ ] Registro visual dos estados de geração, conclusão e erro.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T05, T10.
- Desbloqueia: T15.
- Paralelizável: parcialmente, por estado.

## Fora de escopo

Notificação por e-mail, histórico de exportações e fila assíncrona com
acompanhamento — evolução posterior.
