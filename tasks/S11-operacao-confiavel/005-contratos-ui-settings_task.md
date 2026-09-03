# T05 — Contratos de UI e navegação de Settings/portabilidade

- Status: Concluída
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

## Hierarquia de informação e textos (registro T05)

Rota: `/settings/data` (`EXPORT_SETTINGS_ROUTE`). Item de navegação:
**Dados** (`EXPORT_SETTINGS_NAV_LABEL`) no grupo Configurações, ao lado de
Categorias — sem item na navegação principal.

1. **Cabeçalho** — eyebrow "Configurações", título "Seus dados", descrição
   sobre baixar uma cópia do espaço financeiro em planilhas CSV.
2. **O que está incluído** — contas, categorias, lançamentos, cartões,
   recorrências, Caixinhas, ZIP + manifesto.
3. **O que não está incluído** — senhas/tokens, e-mails e nomes de membros,
   sessões, saldos/projeções calculados.
4. **Conjuntos de dados** — lista com título, descrição e disponibilidade por
   dataset; indisponível por gate externo com motivo em português.
5. **Ação primária** — "Baixar uma cópia" (ocioso) / "Gerando cópia…"
   (gerando).
6. **Painel de resultado** — sucesso com download, vazio sem dados (distinto de
   erro) ou erro opaco com código fechado da ADR.

Estados: `idle`, `generating`, `completed`, `completed_empty`, `error`.
Códigos de erro: `UNAUTHENTICATED`, `EXPORT_IN_PROGRESS`, `EXPORT_RATE_LIMITED`,
`EXPORT_TIMEOUT`, `EXPORT_TOO_LARGE`, `EXPORT_UNAVAILABLE`, `EXPORT_FAILED`.

## Subtarefas

- [x] Escrever os contratos de UI em `src/components/export/contracts.ts` ou
  equivalente ao padrão do repositório.
- [x] Escrever os formatadores e seus testes puros.
- [x] Mapear cada estado do contrato para o componente responsável em T10/T11.
- [x] Registrar os textos e a hierarquia de informação da tela.

## Critérios de aceite

- [x] Todo estado possível da exportação tem representação declarada, incluindo
  dataset indisponível por gate externo.
- [x] Nenhum componente precisará inventar formato, rótulo ou estado.
- [x] Os contratos não expõem campo de tenancy nem detalhe técnico de erro.
- [x] Os formatadores são puros e testados.

## Entregáveis e evidência esperada

- [x] Contratos e formatadores versionados com testes.
- [x] Registro da hierarquia de informação e dos textos na própria task.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T10, T11.
- Paralelizável: sim; é trilha transversal.

## Fora de escopo

Construir a tela, a server action ou o download.
