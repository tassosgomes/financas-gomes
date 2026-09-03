# T09 — Backup lógico externo condicional (pg_dump → S3/R2)

- Status: Não iniciada — condicional à decisão de T02
- Onda: 2
- Dependências: T02 (decisão), T08 (runtime de jobs)
- Paralelização: Com T10 e T11, depois que T08 fecha

## Objetivo

Fechar a lacuna de backup identificada em T02 — implementando o backup lógico
externo quando ele for necessário, ou registrando formalmente a não
implementação quando o backup nativo já satisfizer a política de T01.

## Escopo

**Caminho A — a decisão de T02 é implementar:**

- Implementar o job de backup lógico usando o runtime de T08: `pg_dump` do
  banco alvo, compressão, envio para storage S3-compatible e verificação de
  integridade do artefato enviado (tamanho e checksum).
- Nomear artefatos de forma determinística por janela lógica, para que reenviar
  a mesma janela sobrescreva de forma segura em vez de acumular duplicata.
- Aplicar a política de retenção de T01 no storage, com expurgo previsível e
  reversível dentro da janela.
- Manter as credenciais fora do repositório e fora dos logs, com falha explícita
  e observável quando ausentes ou inválidas.
- Garantir que o job não roda em ambiente de desenvolvimento por acidente e que
  nenhum dado de produção é baixado para máquina de desenvolvedor (TechSpec
  §112).
- Emitir sucesso/falha por T04 e alimentar o alerta de T12.

**Caminho B — a decisão de T02 é não implementar:**

- Registrar a não implementação com a evidência da auditoria, a política que o
  backup nativo satisfaz e o gatilho objetivo que reabre a decisão.
- Verificar e documentar o que já está habilitado no provedor, sem expor
  identificadores.
- Garantir que T13 documente a restauração pelo mecanismo nativo com o mesmo
  rigor.

## Subtarefas

- [ ] Confirmar por escrito qual caminho a decisão de T02 selecionou.
- [ ] Caminho A: implementar job, verificação de integridade, retenção e
  configuração de segredos.
- [ ] Caminho A: testar falha de credencial, falha de rede e reenvio da mesma
  janela.
- [ ] Caminho B: registrar a não implementação, a cobertura nativa e o gatilho
  de revisão.
- [ ] Atualizar `docs/production-deploy.md` com a configuração operacional
  resultante.

## Critérios de aceite

- [ ] O slice termina com backup automático compatível com a política
  operacional da V1, seja ele nativo ou adicional.
- [ ] No caminho A, reexecutar a mesma janela não gera artefato duplicado nem
  corrompe o anterior.
- [ ] No caminho A, falha de envio é detectável, classificada e alertável.
- [ ] Nenhuma credencial, URL de banco ou identificador de projeto entra no
  repositório, nos logs ou na documentação.
- [ ] No caminho B, a decisão está documentada com evidência e gatilho de
  revisão, não como omissão.

## Entregáveis e evidência esperada

- [ ] Caminho A: job versionado, testes e registro de execução em ambiente não
  produtivo.
- [ ] Caminho B: seção de decisão na ADR-014 com evidência datada.
- [ ] Atualização de `docs/production-deploy.md`.

## Sequenciamento

- Bloqueado por: T02, T08.
- Desbloqueia: T12, T13.
- Paralelizável: sim, com as tasks de UI.

## Fora de escopo

Disaster recovery multi-região, replicação contínua, backup de storage de
terceiros e escrita do runbook (T13).
