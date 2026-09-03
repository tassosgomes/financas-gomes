# T05 — Contratos de UI e navegação de Settings/portabilidade

- Status: Não iniciada
- Onda: 1 (transversal)
- Dependências: T01
- Paralelização: Com T02, T03, T04 e T06

## Objetivo

Fechar os contratos de apresentação da portabilidade antes das telas, de modo
que a UI consuma tipos estáveis e nenhuma decisão de formato ou de estado seja
improvisada dentro de um componente.

## Escopo

- Definir os tipos de view model da exportação: datasets disponíveis, datasets
  indisponíveis por gate externo, estado da solicitação (ocioso, gerando,
  concluído, erro), tamanho/contagem informados ao usuário e mensagem de erro
  opaca.
- Definir a posição da portabilidade na navegação de Settings (TechSpec §95),
  sem criar item de navegação principal novo e sem alterar as rotas já
  existentes em `src/app/settings`.
- Definir os textos e rótulos em português, sem linguagem contábil
  desnecessária (PRD §28), incluindo o que a exportação contém e o que ela
  deliberadamente não contém.
- Definir a política de acessibilidade e responsividade mínima: foco, rótulo de
  botão em estado de carregamento, leitura em 360px, e feedback perceptível sem
  depender só de cor.
- Definir os formatadores compartilhados de tamanho de arquivo, contagem de
  linhas e data/hora de geração, sem introduzir formatação monetária.
- Declarar que a UI nunca envia `householdId` nem parâmetro de tenancy, e que o
  browser não escolhe dataset fora da lista contratada em T01.

## Subtarefas

- [ ] Escrever os contratos de UI em `src/components/export/contracts.ts` ou
  equivalente ao padrão do repositório.
- [ ] Escrever os formatadores e seus testes puros.
- [ ] Mapear cada estado do contrato para o componente responsável em T10/T11.
- [ ] Registrar os textos e a hierarquia de informação da tela.

## Critérios de aceite

- [ ] Todo estado possível da exportação tem representação declarada, incluindo
  dataset indisponível por gate externo.
- [ ] Nenhum componente precisará inventar formato, rótulo ou estado.
- [ ] Os contratos não expõem campo de tenancy nem detalhe técnico de erro.
- [ ] Os formatadores são puros e testados.

## Entregáveis e evidência esperada

- [ ] Contratos e formatadores versionados com testes.
- [ ] Registro da hierarquia de informação e dos textos na própria task.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T10, T11.
- Paralelizável: sim; é trilha transversal.

## Fora de escopo

Construir a tela, a server action ou o download.
