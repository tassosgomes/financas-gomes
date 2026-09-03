# T04 — Observabilidade segura da exportação e da operação

- Status: Não iniciada
- Onda: 1 (transversal)
- Dependências: T01; infraestrutura de observabilidade do S01
- Paralelização: Com T02, T03, T05, T06 e demais tasks de backend

## Objetivo

Instrumentar exportação e jobs para diagnosticar falha, lentidão e resultado
parcial sem jamais registrar dado financeiro, dado pessoal ou segredo.

## Escopo

- Criar a extensão `src/modules/observability/s11.ts` seguindo o padrão já
  usado em `s08.ts`/`s09.ts`: versão de contrato, operações fechadas por tipo,
  estágios derivados, resultados e outcomes enumerados.
- Cobrir as operações mínimas: `export.request`, `export.dataset`,
  `export.serialize`, `export.deliver`, `job.start`, `job.attempt`,
  `job.finish`.
- Registrar por dataset apenas contexto operacional agregado: nome do dataset,
  contagem de linhas, bytes gerados, duração e outcome. Nunca conteúdo de
  linha, valor monetário, descrição, nome de conta ou de categoria.
- Registrar por job: identificador opaco de execução, tentativa, motivo de
  retry, duração e resultado final, com correlação entre tentativas da mesma
  execução lógica.
- Marcar exportação lenta e dataset lento acima do limite definido em T01.
- Capturar exceção no Sentry com contexto agregado e correlação, preservando
  erro opaco na resposta ao usuário.
- Proibir por teste em log, breadcrumb e evento: centavos, saldos, nomes,
  descrições, categorias, e-mails, IDs de household/usuário, nomes de arquivo
  contendo dado do usuário, SQL, payloads, URLs de banco, chaves de storage,
  cookies e tokens.

## Subtarefas

- [ ] Implementar o contrato de observabilidade S11 com tipos fechados.
- [ ] Implementar o adapter de instrumentação componível, aplicável às leituras
  de T06 e ao runtime de jobs de T08 sem que eles conheçam o transporte.
- [ ] Adicionar teste de redaction que falha se qualquer campo proibido chegar
  ao payload.
- [ ] Documentar em `docs/observability-s11-operacao.md` as operações, os
  limites de lentidão e o que nunca é registrado.
- [ ] Integrar a instrumentação em T06, T07, T08 e, se existir, T09.

## Critérios de aceite

- [ ] Uma falha de exportação gera evento correlacionado e resposta opaca.
- [ ] Exportação ou dataset acima do limite é sinalizado com duração e
  contadores agregados.
- [ ] Tentativas de retry do mesmo job são correlacionáveis por identificador
  opaco.
- [ ] O teste de redaction cobre todos os campos proibidos e falha ao
  introduzir um deles.
- [ ] A instrumentação não altera resultado, ordem nem conteúdo da exportação.

## Entregáveis e evidência esperada

- [ ] `src/modules/observability/s11.ts` e `s11.test.ts`.
- [ ] Teste dedicado de redaction do S11.
- [ ] `docs/observability-s11-operacao.md`.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: fechamento de T07, T08, T12 e T16.
- Paralelizável: sim; é trilha transversal.

## Fora de escopo

Configurar projeto/alertas no Sentry (T12) e alterar a observabilidade de
S02–S10.
