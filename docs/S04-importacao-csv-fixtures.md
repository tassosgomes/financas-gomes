# S04 — Guia do CSV canônico e catálogo de fixtures

Este guia é a documentação operacional do formato `s04-csv-v1`. O contrato
normativo continua sendo a [ADR-005](adr/005-s04-importacao-csv-contract.md);
em caso de divergência, a ADR prevalece. Os arquivos do catálogo em
[`tests/fixtures/s04-importacao-csv`](../tests/fixtures/s04-importacao-csv)
são sintéticos e servem para testes automatizados e exemplos locais.

## Como produzir um CSV aceito

O produto aceita um CSV já normalizado. Para adaptar um extrato externo,
converta-o antes do upload e confira esta sequência:

1. Exporte ou copie as movimentações para uma ferramenta local de sua
   preferência.
2. Mantenha somente as colunas canônicas, nesta ordem exata:
   `occurred_on,description,amount_cents`.
3. Se precisar rastrear o identificador do sistema de origem, acrescente
   `external_id` como última coluna:
   `occurred_on,description,amount_cents,external_id`.
4. Salve o arquivo em UTF-8. Vírgula é o único delimitador; LF ou CRLF são
   aceitos. Um BOM UTF-8 único no início é opcional.
5. Escreva a data como `YYYY-MM-DD`, a descrição em texto legível e o valor
   como centavos inteiros, sem moeda, ponto, vírgula decimal ou separador de
   milhar. Receita é positiva; despesa é negativa; zero não é aceito.
6. Abra o arquivo como texto e confirme o cabeçalho, as aspas e algumas linhas
   antes de fazer o upload. A prévia da aplicação ainda é a última validação
   antes da confirmação.

Não inclua conta, household, categoria, tipo, status, origem ou saldo no CSV.
A conta de destino é selecionada na aplicação e validada no servidor.

### Exemplo mínimo

```csv
occurred_on,description,amount_cents
2026-08-29,Receita de teste,125000
2026-08-30,Despesa de teste,-1875
```

### Exemplo com identificador e aspas

```csv
occurred_on,description,amount_cents,external_id
2026-08-29,"Bônus, sintético",5000,"origem ""demo"""
2026-08-30,Café de teste,-2500,linha-002
```

Aspas envolvem o campo inteiro. Uma aspa literal é representada por duas
aspas (`""`). Vírgulas, LF e CR dentro de um campo citado são compreendidos
pelo parser CSV, mas LF, CR e NUL não podem permanecer na descrição ou no
`external_id` depois do parse.

## Normalização externa recomendada

O adaptador que converter o extrato deve trabalhar com texto e inteiros, sem
usar `Number`/float para dinheiro:

- remova colunas que não fazem parte do layout e não invente aliases para o
  cabeçalho;
- converta a data para ISO `YYYY-MM-DD` e rejeite datas impossíveis;
- normalize a descrição com NFKC, remova espaços nas pontas e compacte
  whitespace interno para um espaço;
- converta reais para centavos com uma regra explícita e revise o resultado;
  o arquivo final deve conter somente dígitos ASCII com sinal opcional;
- converta crédito em valor positivo e débito em valor negativo;
- deixe `external_id` vazio quando não existir, em vez de usar um marcador
  inventado;
- escreva UTF-8 e valide o CSV resultante com uma biblioteca que implemente
  quoting RFC 4180.

O sistema não interpreta o layout nativo de nenhum banco e não faz
reconciliação, matching, categorização automática ou conversão por IA dentro
do produto. A adaptação externa é responsabilidade de quem prepara o arquivo.

## Limites e significado do sinal

O arquivo deve ter no máximo 5 MiB (medidos nos bytes recebidos, antes do BOM),
10.000 registros de dados e 16 KiB por campo antes da normalização. A data
não pode ser futura nem anterior ao `tracking_started_on` da conta escolhida.

Cada linha válida vira uma receita quando `amount_cents > 0` e uma despesa
quando `amount_cents < 0`. O evento grava o módulo do valor e o lançamento da
conta conserva o sinal. Linhas idênticas dentro do mesmo arquivo continuam
sendo ocorrências distintas; o produto só bloqueia a reimportação do mesmo
multiconjunto já confirmado para a mesma conta e household.

Arquivo vazio, cabeçalho ausente/inválido, bytes inválidos, quoting malformado
ou qualquer limite estrutural abortam o arquivo antes de gerar candidatos.
Erros de linha são relatados com registro/campo/código, e as linhas válidas
podem aparecer na prévia conforme a estratégia parcial da ADR-005. Um arquivo
sem nenhuma linha válida não recebe token confirmável.

## Catálogo de fixtures sintéticas

O catálogo usa apenas descrições como “Receita de teste”, “Café de teste” e
“Bônus, sintético”; nenhum valor foi copiado de extrato real. O manifesto
[`manifest.json`](../tests/fixtures/s04-importacao-csv/manifest.json) é a
fonte de expectativas para os testes.

Arquivos `.csv` são UTF-8 textual. Arquivos `.hex` representam exatamente os
bytes recebidos, em hexadecimal minúsculo sem separadores, para permitir casos
de UTF-8 inválido, BOM, NUL e CR isolado. Arquivos `.recipe.json` são receitas
determinísticas para limites que seriam grandes ou inconvenientes de manter
literalmente no repositório; o runner deve materializá-las antes de chamar o
parser. A convenção está descrita no
[`README das fixtures`](../tests/fixtures/s04-importacao-csv/README.md).

Os arquivos cobrem sucesso, quoting, todas as classes de erro CSV da ADR-005,
arquivo vazio, conjunto duplicado, ordem equivalente, limites e mistura de
linhas válidas e inválidas. Erros de autenticação, sessão, conta, token,
command e autorização são cenários de integração/E2E, não propriedades que um
CSV possa reproduzir isoladamente; eles estão mapeados na matriz de testes.

Consulte a [matriz de critérios e casos](S04-importacao-csv-matriz-testes.md)
para ligar cada expectativa a teste unitário, integração ou E2E.
