# T12 — Consolidação do Sentry nos runtimes e alertas operacionais

- Status: Não iniciada
- Onda: 3
- Dependências: T04, T08; T09 quando aplicável; T02 para o alvo do alerta
- Paralelização: Com T10 e T11

## Objetivo

Fechar a V1 com detecção de falha que não dependa de alguém olhar por acaso:
todo runtime relevante reporta ao Sentry, com release e ambiente
identificáveis, e as falhas operacionais importantes geram alerta.

## Escopo

- Auditar a cobertura atual do Sentry em `src/modules/observability` e nos
  arquivos de configuração, identificando qual runtime está coberto (browser,
  server, edge quando existir) e qual não está.
- Estender a cobertura ao runtime de jobs de T08 e ao job de backup de T09,
  quando existir, com inicialização própria e desligamento limpo — um job que
  termina antes do flush perde o evento.
- Garantir que release e ambiente estejam corretos em todos os runtimes,
  reutilizando o fallback já existente por SHA de commit.
- Definir e configurar os alertas mínimos: falha de job recorrente relevante,
  falha de backup e pico de erro na exportação. Registrar o destino do alerta,
  o limiar e o responsável — sem incluir identificadores de projeto no
  repositório.
- Revalidar a política de redaction de ponta a ponta com o probe controlado já
  existente (`/api/observability/test`), confirmando que nenhum dado financeiro
  ou pessoal chega ao Sentry a partir dos runtimes novos.
- Atualizar `docs/observability.md` com a matriz runtime × cobertura × release e
  com os alertas configurados.

## Subtarefas

- [ ] Levantar e registrar a cobertura atual por runtime.
- [ ] Instrumentar os runtimes descobertos, incluindo flush antes do término de
  processo em jobs.
- [ ] Configurar os alertas e registrar limiar, destino e responsável.
- [ ] Provocar uma falha controlada de job em ambiente não produtivo e
  confirmar que o alerta dispara.
- [ ] Atualizar a documentação de observabilidade.

## Critérios de aceite

- [ ] Todo runtime relevante da V1 reporta ao Sentry com release e ambiente
  corretos.
- [ ] Falha de job recorrente relevante chega ao Sentry e dispara alerta,
  comprovado por execução controlada.
- [ ] Um job que falha e termina imediatamente ainda entrega o evento.
- [ ] Nenhum evento contém valor monetário, nome, descrição, e-mail, cookie,
  token ou payload financeiro.
- [ ] A documentação descreve a cobertura real, não a pretendida.

## Entregáveis e evidência esperada

- [ ] Configuração de Sentry por runtime versionada.
- [ ] Registro datado da falha controlada e do alerta recebido.
- [ ] `docs/observability.md` atualizado.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T04, T08 e, quando aplicável, T09.
- Desbloqueia: T13, T16.
- Paralelizável: sim.

## Fora de escopo

Plataforma completa de observabilidade, SIEM, auditoria por ação de usuário e
dashboard de métricas externo.
