# T08 — Runtime de jobs recorrentes: idempotência, retry e estado observável

- Status: Concluída
- Onda: 2
- Dependências: T01, T04
- Paralelização: Com T07

## Objetivo

Estabelecer o mínimo necessário para que um job recorrente do produto seja
seguro: repetir não duplica efeito, falhar é visível, e o estado de cada
execução é consultável sem inspeção manual casual.

## Escopo

- Definir a chave de idempotência de execução (job + janela lógica + tentativa)
  e a tabela/registro de execuções com estado, início, fim, tentativa, resultado
  e motivo de falha — sem armazenar payload financeiro.
- Implementar o wrapper de execução idempotente: uma execução lógica já
  concluída com sucesso não repete o efeito; uma execução interrompida pode ser
  retomada sem duplicar.
- Implementar retry com backoff limitado e classificação de erro: falha
  transitória tenta de novo, falha determinística não entra em laço.
- Reutilizar o padrão de idempotência já adotado na aplicação (TechSpec §72) em
  vez de criar um mecanismo concorrente; registrar a decisão se divergir.
- Garantir transação e limites corretos (TechSpec §73): efeito e marcação de
  conclusão não podem ficar em transações distintas de forma que uma falha
  parcial gere efeito sem registro.
- Emitir os eventos de observabilidade `job.start`, `job.attempt` e
  `job.finish` de T04, com correlação entre tentativas.
- Expor o estado das execuções recentes de forma consultável pelo operador, no
  nível mínimo suficiente para diagnosticar (sem tela nova se um endpoint ou
  consulta documentada resolver).
- Manter o runtime independente de provedor: o agendador escolhido em T02 chama
  o job, mas o job não conhece o agendador.

## Subtarefas

- [x] Definir chave de idempotência e o modelo de registro de execução, com
  migration versionada quando houver tabela.
- [x] Implementar o wrapper de execução com retry, backoff e classificação de
  erro.
- [x] Escrever testes de integração para execução dupla, execução concorrente e
  retomada após falha.
- [x] Integrar a instrumentação de T04 e provar a correlação entre tentativas.
- [x] Documentar como o operador consulta o estado das execuções.

## Critérios de aceite

- [x] Executar o mesmo job duas vezes na mesma janela lógica não duplica efeito,
  comprovado por teste.
- [x] Uma falha transitória é repetida com backoff e uma falha determinística
  para com resultado registrado.
- [x] Toda execução deixa estado de sucesso ou falha consultável.
- [x] Falha de job chega ao Sentry com correlação e sem dado sensível.
- [x] O runtime não depende de Vercel, Neon ou de qualquer agendador
  específico.
- [x] Nenhum registro de execução contém valor monetário, nome, descrição ou
  segredo.

## Entregáveis e evidência esperada

- [x] Runtime de jobs com testes unitários e de integração PostgreSQL opt-in.
- [x] Migration versionada, se aplicável, com `db:check` aprovado.
- [x] Documentação do estado observável em `docs/observability-s11-operacao.md`.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01, T04.
- Desbloqueia: T09, T12, T14.
- Paralelizável: sim, com T07.

## Fora de escopo

Implementar o job de backup em si (T09), criar fila distribuída, adotar
orquestrador não decidido em T02.
