# T02 — Auditoria do backup nativo e decisão sobre backup externo e workflows duráveis

- Status: Concluída (2026-09-03)
- Onda: 1
- Dependências: T01
- Paralelização: Com T03, T04, T05 e T06

## Objetivo

Decidir com evidência, e não por simetria arquitetural, se a V1 precisa de
backup lógico externo (R2/S3) e de um orquestrador de workflows duráveis, ou se
o backup nativo da infraestrutura já satisfaz a política definida em T01.

## Escopo

- Auditar a capacidade real de backup do banco em uso (Neon: PITR, janela de
  retenção do plano contratado, granularidade de restauração, tempo estimado de
  restore, escopo de branch/projeto) e registrar o que foi verificado, como e
  quando.
- Auditar o que a plataforma de aplicação cobre e o que ela explicitamente não
  cobre (a Vercel não faz backup dos dados do PostgreSQL).
- Confrontar a capacidade nativa com a política de retenção/RPO/RTO de T01 e
  apontar cada lacuna concreta, sem antecipar solução.
- Decidir se o backup lógico externo `pg_dump → R2/S3` entra na V1. A TechSpec
  §113 coloca esse backup no backlog e §112 proíbe manipular dados de produção
  como processo normal; a decisão precisa vencer esse padrão com lacuna
  demonstrada, não com preferência.
- Decidir se algum workflow durável do slice justifica um orquestrador
  (Temporal). Registrar que a TechSpec V1 não prevê esse componente — o termo
  "Temporal" na stack refere-se ao polyfill de datas — e que §104 rejeita
  infraestrutura preventiva. Se a decisão for positiva, listar quais workflows
  a exigem e por quê; se for negativa, declarar o mecanismo alternativo
  (agendamento do provedor, GitHub Actions agendado, cron do host) e os limites
  desse mecanismo.
- Verificar que a decisão preserva a portabilidade da TechSpec §4: nenhuma
  regra de domínio pode passar a depender de Vercel, Neon ou do storage
  escolhido.
- Definir a superfície de configuração da decisão: variáveis de ambiente
  necessárias, onde ficam os segredos e o comportamento quando estão ausentes.

## Subtarefas

- [x] Levantar e registrar as capacidades nativas verificadas, com data e
  origem da informação.
- [x] Preencher a matriz política × capacidade nativa × lacuna.
- [x] Registrar a decisão sobre backup externo com alternativas consideradas e
  consequências.
- [x] Registrar a decisão sobre orquestrador durável com o mesmo rigor.
- [x] Atualizar a ADR-014 com ambas as decisões e o gatilho que faria
  revisitá-las.

## Critérios de aceite

- [x] Cada capacidade afirmada tem origem verificável, não suposição.
- [x] Toda lacuna está descrita em relação à política de T01, com impacto.
- [x] A decisão sobre R2/S3 é binária, datada e justificada; se for "não
  implementar", a justificativa e o gatilho de revisão ficam registrados.
- [x] A decisão sobre workflow durável é binária e não introduz componente sem
  workflow real que o exija.
- [x] Nenhuma decisão cria dependência de domínio em provedor específico.
- [x] Nenhum segredo, URL de banco ou identificador de projeto entra na
  documentação.

## Entregáveis e evidência esperada

- [x] Seção de auditoria e decisão na ADR-014.
- [x] Matriz política × capacidade × lacuna publicada em `docs/`.
- [x] Atualização de `docs/production-deploy.md` com o que o operador precisa
  confirmar no provedor.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T09 (condicional), T12, T13.
- Paralelizável: sim.

## Fora de escopo

Implementar job, contratar plano, criar bucket ou escrever runbook — o runbook
é T13 e a implementação condicional é T09.
