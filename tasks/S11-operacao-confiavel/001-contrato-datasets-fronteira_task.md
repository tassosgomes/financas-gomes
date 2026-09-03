# T01 — Contrato do S11, datasets exportáveis e fronteira do slice

- Status: Não iniciada
- Onda: 0
- Dependências: modelo de dados final da V1 (S01–S10) e handoff S10 → S11
- Paralelização: Serial; desbloqueia todo o slice

## Objetivo

Fechar, antes de qualquer código, o que é exportado, em que formato, com quais
garantias de isolamento e o que o slice considera "operação confiável" na V1.
O resultado deve eliminar ambiguidade sobre datasets, colunas, redaction,
retenção e fronteira entre backup nativo e backup adicional.

## Escopo

- Declarar a fronteira do slice: **o S11 exporta, protege e diagnostica; ele
  não recalcula fórmula financeira nem cria número novo.** Toda linha exportada
  vem de um dado já persistido ou de uma leitura já existente de S02–S09.
- Definir o contrato versionado `s11.v1` da exportação: lista fechada de
  datasets, nome de arquivo, colunas, tipos serializados, ordem determinística
  e chave de reconciliação de cada linha.
- Definir o conjunto de datasets da V1 e o dono de cada um, por exemplo:
  contas, categorias, transações/eventos financeiros, lançamentos de ledger,
  cartões, compras, parcelas, transferências, recorrências, caixinhas,
  movimentos de caixinha e itens de forecast. Cada dataset precisa de
  justificativa de portabilidade ou reconciliação; nenhum entra por simetria.
- Fechar o dialeto CSV: separador, aspas, escape, quebra de linha, encoding,
  BOM, cabeçalho, representação de vazio/nulo, formato de dinheiro (string de
  centavos ou decimal explícito, sem símbolo e sem separador de milhar) e
  formato de data ISO derivado de `Temporal.PlainDate`.
- Fechar a regra de tenancy: a exportação usa exclusivamente o espaço
  financeiro resolvido no servidor; `householdId` e `userId` nunca vêm do
  browser, e nenhum ID exportado pode servir de vetor para ler outro espaço.
- Fechar a lista de **segredos e dados proibidos** na exportação: tokens,
  sessões, cookies, credenciais OAuth, DSNs, URLs de banco, hashes internos,
  metadados de infraestrutura e qualquer coluna técnica sem valor de
  portabilidade. Definir também o tratamento de e-mail/nome de membros.
- Fechar como filtros da tela de transações se refletem na exportação
  (TechSpec §98) e o que acontece quando o filtro resulta em conjunto vazio.
- Definir a **política mínima de retenção e restauração**: janela de retenção
  alvo, RPO e RTO aceitos para a V1, e o que conta como restauração
  bem-sucedida.
- Definir o que é "job recorrente relevante" para o slice e qual é o estado
  observável mínimo de sucesso/falha que ele precisa deixar.
- Declarar os limites de escopo: sem plataforma de observabilidade, sem SIEM,
  sem auditoria por ação de usuário, sem DR multi-região, sem exportador de
  formato bancário proprietário e sem pipeline de importação.
- Registrar a decisão como ADR (`docs/adr/014-s11-portabilidade-backup.md`) e
  publicar a matriz de contrato/cenários no padrão de S08/S09.

## Subtarefas

- [ ] Inventariar as tabelas e leituras existentes candidatas a dataset,
  registrando origem, colunas disponíveis e sensibilidade de cada campo.
- [ ] Publicar a ADR-014 com o contrato `s11.v1`, invariantes, exemplos de
  linha e a precedência entre PRD §25–26, TechSpec §4, §98, §102–103, §112–113
  e este slice.
- [ ] Publicar a matriz de cenários: espaço vazio, espaço completo, filtro sem
  resultado, dataset de slice ainda aberto, volume representativo, caracteres
  especiais/injeção de fórmula em CSV e tentativa cross-space.
- [ ] Mapear cada critério de aceite de `docs/S11-operacao-confiavel.md` para
  as tasks T02–T16 e para a evidência que vai prová-lo.
- [ ] Publicar a lista de gates externos abertos (S09 T04/T07/T08/T11–T15 e
  todo o S10) e o comportamento contratado da exportação enquanto o dataset
  correspondente não existir.

## Critérios de aceite

- [ ] Nenhuma coluna, formato ou regra de exclusão depende da interpretação
  local de uma task posterior.
- [ ] Todo dataset tem justificativa explícita de portabilidade ou
  reconciliação e um dono declarado.
- [ ] A lista de dados proibidos é fechada e verificável por teste.
- [ ] O contrato proíbe autoridade de tenancy vinda do browser em qualquer
  etapa da exportação.
- [ ] A política de retenção e restauração declara janela, RPO, RTO e critério
  de sucesso, mesmo que conservadores.
- [ ] O contrato afirma que a exportação não recalcula nem reinterpreta valor
  financeiro derivado.

## Entregáveis e evidência esperada

- [ ] `docs/adr/014-s11-portabilidade-backup.md` com o contrato versionado.
- [ ] `docs/S11-operacao-confiavel-contract-matrix.md` com cenários e o
  mapeamento de critérios para tasks.
- [ ] Atualização de `docs/S11-operacao-confiavel.md` apenas com decisões
  compatíveis com o escopo do slice.
- [ ] `rtk npm exec tsc -- --noEmit` e revisão dos links da documentação.

## Sequenciamento

- Bloqueado por: handoff do S10 e estabilização do modelo da V1.
- Desbloqueia: T02, T03, T04, T05, T06.
- Paralelizável: não.

## Fora de escopo

Escrever encoder, query, endpoint, componente, job ou migration. Escolher
provedor de storage — isso é decidido com evidência em T02.
