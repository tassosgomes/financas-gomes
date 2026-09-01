# T04 — Fixtures, documentação e matriz de casos

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — documentação, fixtures sintéticas e matriz de testes concluídas em 2026-08-30.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T03 e T05

## Objetivo

Disponibilizar contrato consumível ao usuário e uma base de testes que represente os casos reais do slice.

## Escopo

- Documentar layout, encoding, exemplo mínimo, significado do sinal, limites e como normalizar extratos externamente.
- Criar fixtures versionadas: válido, com aspas, cabeçalho inválido, linha inválida, data/valor inválidos, vazio, duplicidade de conjunto e limites.
- Criar matriz ligando cada critério de aceite a teste unitário, integração ou E2E.
- Garantir que fixtures não tragam dados financeiros reais.

## Critérios de aceite

- [x] Usuário entende como produzir um CSV sem conhecer formato de banco.
- [x] Todas as classes de erro previstas para o CSV têm fixture; códigos de
  sessão/conta/token/command estão representados como cenários de boundary.
- [x] A documentação não promete reconciliação, parser bancário ou categorização automática.

## Subtarefas

- [x] Catalogar o contrato de uso externo do CSV canônico, incluindo encoding,
  cabeçalho, normalização, sinal, limites e exemplo mínimo.
- [x] Criar fixtures sintéticas versionadas para sucesso, quoting, erros
  estruturais, erros por linha, duplicidade e limites, sem dados financeiros
  reais.
- [x] Representar casos que exigem bytes/volumes gerados (UTF-8 inválido,
  NUL, BOM, arquivo acima de 5 MiB e mais de 10.000 registros) de forma
  determinística e consumível pelos testes.
- [x] Criar matriz de critérios/códigos para testes unitários, integração e
  E2E, distinguindo fixtures de CSV dos cenários dependentes de sessão,
  conta, preview e persistência.
- [x] Validar links, integridade do manifesto e expectativas de cada fixture;
  registrar evidências nesta task e concluir o status.

## Subtarefas e evidências (2026-08-30)

- [x] Criado o [guia operacional e catálogo de fixtures](../../docs/S04-importacao-csv-fixtures.md),
  com instruções para produzir CSV canônico sem conhecer layout bancário,
  exemplo mínimo, quoting, normalização, limites, sinal e limites explícitos
  de escopo (sem parser bancário, reconciliação ou categorização automática).
- [x] Criado o [catálogo versionado](../../tests/fixtures/s04-importacao-csv/README.md)
  com 38 entradas em [`manifest.json`](../../tests/fixtures/s04-importacao-csv/manifest.json):
  casos válidos, aspas, BOM/CRLF, normalização, duplicidade de linhas,
  fingerprint independente da ordem, conjunto repetido, erros estruturais,
  erros por linha, arquivo vazio e ausência de linhas válidas.
- [x] Incluídas receitas determinísticas para campo acima de 16 KiB, 10.001
  registros e arquivo de 5 MiB + 1 byte; payloads hex cobrem UTF-8 inválido,
  BOM inválido, CR isolado, NUL em descrição e controle em `external_id` sem
  colocar bytes binários diretamente em CSV textual.
- [x] Criada a [matriz de critérios e casos](../../docs/S04-importacao-csv-matriz-testes.md),
  cobrindo os sete critérios de aceite, os 24 códigos CSV de ADR-005, os
  11 cenários de boundary (sessão, conta, preview, command e duplicidade),
  fingerprint, contagens, rollback, isolamento e redaction.
- [x] Declarado no manifesto que os dados são sintéticos e nenhum arquivo
  contém extrato financeiro real; `external_id` e descrições são marcadores
  fictícios.

## Verificações finais

- [x] `jq empty tests/fixtures/s04-importacao-csv/manifest.json` — manifesto
  JSON válido, com 38 fixtures e 11 cenários de boundary.
- [x] Todos os caminhos do manifesto existem; links Markdown do guia, matriz,
  README e página S04 foram resolvidos contra o filesystem.
- [x] CSVs textuais passaram por validação UTF-8 estrita e não contêm CR
  acidental; os sete payloads `.hex` têm somente hex par e foram decodificados
  com sucesso.
- [x] Receitas conferidas: descrição de 16.385 code points (16.438 bytes
  materializados), 10.001 registros e 5.242.881 bytes.
- [x] `git diff --check --no-index /dev/null` aplicado aos documentos e ao
  manifesto — sem whitespace inválido.
- [x] Escopo conferido: alterações próprias da T04 ficaram em sua task, na
  documentação S04 e em `tests/fixtures/s04-importacao-csv`; nenhuma task de
  outro ID foi alterada.

## Bloqueios

Nenhum bloqueio técnico restante para T04. A execução do parser e das suítes
unitárias/integração/E2E consumindo este catálogo pertence às tasks T03, T06–T12,
conforme a matriz.
