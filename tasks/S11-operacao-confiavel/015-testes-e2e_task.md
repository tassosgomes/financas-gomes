# T15 — Testes E2E de portabilidade

- Status: Não iniciada
- Onda: 4
- Dependências: T10, T11, T14
- Paralelização: Não

## Objetivo

Provar, no navegador, que o usuário consegue chegar à portabilidade, exportar
seus dados e entender o que aconteceu — inclusive quando dá errado.

## Escopo

- Fluxo feliz: login, navegar até Settings → portabilidade, disparar a
  exportação, receber o arquivo e ver o estado de conclusão.
- Verificar o conteúdo do arquivo baixado: datasets esperados presentes,
  cabeçalhos corretos e ausência de coluna proibida.
- Fluxo de espaço vazio: estado próprio, distinguível de erro.
- Fluxo de erro: falha simulada na geração produz mensagem acionável e opaca, e
  o controle volta a um estado utilizável.
- Verificar que disparo duplicado durante a geração não inicia uma segunda
  exportação.
- Verificar a leitura em viewport móvel (360px).
- Reutilizar o seed determinístico de T14 e a infraestrutura de autenticação de
  teste já existente, sem criar caminho de autenticação novo.

## Subtarefas

- [ ] Escrever o cenário feliz com verificação do arquivo baixado.
- [ ] Escrever os cenários de espaço vazio e de erro.
- [ ] Escrever a verificação de disparo duplicado.
- [ ] Escrever a verificação móvel.
- [ ] Estabilizar o tempo de espera do download sem `sleep` arbitrário.

## Critérios de aceite

- [ ] O fluxo completo de exportação passa de ponta a ponta no CI.
- [ ] O arquivo baixado é inspecionado, não apenas o evento de download.
- [ ] Espaço vazio e erro têm cenários próprios e passam.
- [ ] Os testes são determinísticos e não dependem de dados residuais.
- [ ] Nenhum artefato de teste contém dado real.

## Entregáveis e evidência esperada

- [ ] Especificações Playwright versionadas.
- [ ] Saída de `npm run test:e2e` registrada na task.
- [ ] Artefatos de falha (trace/captura) configurados para o CI.

## Sequenciamento

- Bloqueado por: T10, T11, T14.
- Desbloqueia: T16.
- Paralelizável: não.

## Fora de escopo

E2E de backup, restauração e alerta — esses são validados por execução
operacional em T12 e T13.
