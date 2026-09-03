# T13 — Retenção, runbook de restauração e teste de restauração executado

- Status: Não iniciada
- Onda: 4
- Dependências: T02, T09, T12
- Paralelização: Com T14 durante a escrita

## Objetivo

Transformar a política de T01 e a decisão de T02 em um procedimento que uma
pessoa consegue executar sob pressão, e provar que ele funciona restaurando de
verdade em ambiente não produtivo.

## Escopo

- Escrever `docs/backup-restore.md` como runbook curto e sequencial: quando
  restaurar, quem autoriza, pré-requisitos, passos numerados, verificação de
  sucesso e o que fazer se um passo falhar.
- Documentar a política mínima de retenção efetivamente vigente: janela, o que
  é retido, onde, por quanto tempo e como o expurgo acontece.
- Documentar RPO e RTO reais medidos, não os desejados, e a diferença em
  relação ao alvo de T01.
- Cobrir os dois caminhos possíveis: restauração pelo mecanismo nativo (PITR) e,
  se T09 seguiu o caminho A, restauração a partir do artefato externo.
- Incluir a verificação pós-restauração: migrations aplicadas, `db:check`,
  `/api/readiness`, e uma checagem de consistência financeira que use dados
  fictícios conhecidos em vez de inspecionar dados reais.
- Executar o teste de restauração em ambiente seguro e registrar data, duração,
  o que foi restaurado, o que falhou e o que foi corrigido no runbook depois da
  execução.
- Respeitar a TechSpec §112: o teste não pode envolver baixar produção para
  máquina de desenvolvedor nem usar household real.
- Referenciar o runbook a partir de `docs/production-deploy.md` e do
  `docs/00-README.md`.

## Subtarefas

- [ ] Escrever o runbook com passos numerados e critérios de verificação.
- [ ] Documentar retenção, RPO e RTO medidos.
- [ ] Executar a restauração em ambiente não produtivo e cronometrar.
- [ ] Corrigir o runbook com o que a execução real mostrou.
- [ ] Registrar a evidência datada na própria task.

## Critérios de aceite

- [ ] O runbook é executável por alguém que não escreveu o código, sem
  conhecimento tácito.
- [ ] Existe procedimento documentado de restauração e ele foi tecnicamente
  testado em ambiente seguro, com registro datado.
- [ ] A política de retenção documentada corresponde ao que está de fato
  configurado.
- [ ] RPO e RTO registrados são medidos, e qualquer distância do alvo está
  declarada.
- [ ] O procedimento não expõe segredo, URL de banco nem identificador de
  provedor.
- [ ] Nenhuma etapa do teste usa dados reais de produção.

## Entregáveis e evidência esperada

- [ ] `docs/backup-restore.md`.
- [ ] Registro datado do teste de restauração nesta task.
- [ ] Atualizações de `docs/production-deploy.md` e `docs/00-README.md`.

## Sequenciamento

- Bloqueado por: T02, T09, T12.
- Desbloqueia: T16.
- Paralelizável: sim, com T14.

## Fora de escopo

Disaster recovery multi-região, automação de restauração e ensaio periódico
agendado — registrar como evolução, se desejado.
