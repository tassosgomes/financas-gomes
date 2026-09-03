# T15 — Testes E2E de portabilidade

- Status: Concluída
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

- [x] Escrever o cenário feliz com verificação do arquivo baixado.
- [x] Escrever os cenários de espaço vazio e de erro.
- [x] Escrever a verificação de disparo duplicado.
- [x] Escrever a verificação móvel.
- [x] Estabilizar o tempo de espera do download sem `sleep` arbitrário.

## Critérios de aceite

- [x] O fluxo completo de exportação passa de ponta a ponta no CI.
- [x] O arquivo baixado é inspecionado, não apenas o evento de download.
- [x] Espaço vazio e erro têm cenários próprios e passam.
- [x] Os testes são determinísticos e não dependem de dados residuais.
- [x] Nenhum artefato de teste contém dado real.

## Entregáveis e evidência esperada

- [x] Especificações Playwright versionadas (`tests/e2e/export.spec.ts`).
- [x] Saída de `npm run test:e2e` registrada na task.
- [x] Artefatos de falha (trace/captura) configurados para o CI.

### Saída de `npm run test:e2e`

```
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/financas_gomes_test npm run test:e2e -- tests/e2e/export.spec.ts

Running 5 tests using 1 worker

  ✓ fluxo feliz: exporta ZIP com contrato e sem campos proibidos (28.3s)
  ✓ espaço vazio: conclusão distinta de erro (5.4s)
  ✓ erro simulado: mensagem opaca e retry utilizável (5.8s)
  ✓ disparo duplicado durante geração não inicia segunda exportação (4.5s)
  ✓ viewport móvel 360px mantém a tela operável (5.5s)

  5 passed (52.1s)
```

## Sequenciamento

- Bloqueado por: T10, T11, T14.
- Desbloqueia: T16.
- Paralelizável: não.

## Fora de escopo

E2E de backup, restauração e alerta — esses são validados por execução
operacional em T12 e T13.
