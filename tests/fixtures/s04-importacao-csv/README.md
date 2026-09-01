# Fixtures sintéticas do CSV `s04-csv-v1`

Estas fixtures são dados inventados para T03/T06–T13. Não use nomes, valores,
identificadores ou linhas de extrato real neste diretório. O contrato
normativo está em [`docs/adr/005-s04-importacao-csv-contract.md`](../../../docs/adr/005-s04-importacao-csv-contract.md),
o guia de uso está em [`docs/S04-importacao-csv-fixtures.md`](../../../docs/S04-importacao-csv-fixtures.md)
e as expectativas completas estão em [`manifest.json`](manifest.json).

## Convenções

- `.csv`: bytes UTF-8 textuais, com LF salvo quando o caso não estiver
  explicitamente testando CRLF. A última quebra de linha é opcional.
- `.hex`: bytes exatos recebidos pelo upload, em hexadecimal minúsculo e sem
  espaços. A quebra de linha textual final desta representação não faz parte
  do payload; o runner deve removê-la antes de decodificar. Depois disso, deve
  decodificar o conteúdo como bytes, sem primeiro convertê-lo para uma string.
  Isso permite testar UTF-8 inválido, BOM, NUL e CR isolado sem corromper o
  repositório.
- `.recipe.json`: descrição determinística de uma entrada grande ou vazia. O
  runner deve materializar os bytes conforme a receita antes de chamar o
  parser. Receitas não são uma nova entrada no contrato CSV; apenas evitam
  manter milhares de linhas ou 5 MiB literais.

Todas as entradas têm um `id` único no manifesto e uma expectativa de sucesso,
erro de arquivo ou erro por linha. O `rowNumber` considera o cabeçalho como
registro 1, portanto a primeira linha de dados é 2. Nos casos de bytes
estruturais, a validação deve acontecer antes de qualquer candidato.

O campo `boundaryScenarios` do manifesto cobre os códigos que dependem de
sessão, conta, relógio, token, command ou estado persistido. Esses cenários
reutilizam uma fixture válida ou explicitam `fixture: null` quando a entrada
correta é a ausência de arquivo; não devem ser confundidos com um novo layout
CSV.

## Receitas materializáveis

O campo `kind` define a operação:

- `exact-bytes`: `hex` é o payload completo. É usado para vazio (`hex` vazio),
  BOM, NUL, UTF-8 inválido e newline inválido.
- `repeat-data-row`: escreva `header`, uma quebra `newline` e `dataRows`
  cópias de `row`, usando exatamente os bytes UTF-8 declarados. Serve para o
  limite de registros.
- `repeat-field`: use `header` e `rowTemplate`; substitua o marcador
  `{field}` por `fill` repetido `fieldCodePoints` vezes. Serve para o limite
  de campo e não deve normalizar antes de medir o tamanho bruto.
- `pad-bytes`: monte `prefixHex` e acrescente `fillHex` até `totalBytes`; o
  resultado é deliberadamente rejeitado no limite de bytes antes do parse.

Os runners podem implementar essas quatro operações em qualquer linguagem,
mas devem conferir que o tamanho final da entrada coincide com o manifesto.
