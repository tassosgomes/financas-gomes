# T07 — Fluxo de exportação autenticado, empacotamento e entrega

- Status: Concluída
- Onda: 2
- Dependências: T03, T06; observabilidade de T04
- Paralelização: Com T08

## Objetivo

Ligar leitura e serialização em um fluxo autenticado que entrega ao usuário os
dados do seu espaço financeiro, com limites explícitos, falha previsível e
nenhum vazamento de dado ou de segredo.

## Escopo

- Implementar o caso de uso de exportação em `src/modules/export/use-cases.ts`,
  compondo T06 e T03 por streaming, e a superfície autenticada correspondente
  (server action e/ou route handler, conforme o padrão do repositório para
  entrega de arquivo).
- Autenticar a requisição e resolver o espaço financeiro no servidor; recusar
  qualquer tentativa de escolher household, usuário ou dataset fora do contrato.
- Definir o empacotamento: um CSV por dataset, agrupados em um único arquivo
  compactado quando houver mais de um, com nomes de arquivo estáveis, sem dado
  do usuário no nome e com manifesto opcional declarando versão do contrato,
  datasets, contagem de linhas e instante de geração em UTC.
- Definir e aplicar limites operacionais: tamanho máximo, tempo máximo de
  geração e comportamento ao ultrapassá-los, respeitando os limites de runtime
  da plataforma de deploy.
- Garantir headers corretos de download e ausência de cache em qualquer camada
  intermediária.
- Retornar erro opaco ao usuário, com correlação registrada por T04; nunca
  expor mensagem de driver, SQL, caminho de arquivo ou detalhe de provedor.
- Tornar a operação idempotente do ponto de vista de efeito: exportar não altera
  estado financeiro, não cria evento e não muda nada além do registro
  operacional.
- Aplicar proteção contra abuso proporcional ao escopo (limite simples de
  concorrência ou de frequência por usuário), sem introduzir infraestrutura
  nova, conforme TechSpec §104.

## Subtarefas

- [x] Implementar o caso de uso e a superfície autenticada.
- [x] Implementar empacotamento, manifesto e nomes de arquivo estáveis.
- [x] Implementar limites de tamanho/tempo e o caminho de erro correspondente.
- [x] Testar exportação com espaço vazio, espaço completo e filtro sem
  resultado.
- [x] Testar recusa de acesso não autenticado e de tentativa cross-space.

## Critérios de aceite

- [x] Usuário autenticado exporta os dados do seu espaço em formato aberto, em
  uma única ação.
- [x] Nenhuma linha de outro espaço financeiro aparece no arquivo, comprovado
  por teste com IDs forjados.
- [x] Espaço vazio produz saída válida e explicável, não erro e não arquivo
  corrompido.
- [x] Nenhum segredo, token, cookie, URL de banco ou detalhe técnico aparece no
  arquivo, no manifesto, no nome do arquivo ou na resposta de erro.
- [x] A exportação não altera nenhum dado financeiro.
- [x] Ultrapassar o limite de tamanho/tempo produz erro contratado e
  observável, não resposta truncada silenciosa.

## Entregáveis e evidência esperada

- [x] Caso de uso, superfície autenticada e testes unitários/integração.
- [x] Amostra de exportação gerada a partir de fixture, versionada em
  `tests/fixtures/s11-operacao-confiavel/`.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T03, T06.
- Desbloqueia: T10, T14.
- Paralelizável: sim, com T08.

## Fora de escopo

Construir a tela, o feedback visual e o backup externo.
