# T03 — Serialização CSV determinística e segura

- Status: Não iniciada
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T04, T05 e T06

## Objetivo

Implementar o encoder CSV do slice como unidade pura, determinística e testável,
de modo que nenhuma task posterior precise decidir aspas, escape, encoding ou
formato de dinheiro por conta própria.

## Escopo

- Implementar o encoder em `src/modules/export/csv.ts` conforme o dialeto
  fechado em T01: cabeçalho, separador, aspas, escape de aspas, quebras de
  linha dentro de campo, encoding UTF-8 e política de BOM.
- Formatar dinheiro sem perda: `bigint`/`Money` serializado como string, sem
  símbolo, sem separador de milhar e sem arredondamento oportunista.
- Formatar datas a partir de `Temporal.PlainDate`/ISO, sem conversão implícita
  de fuso.
- Neutralizar injeção de fórmula: campos iniciados por `=`, `+`, `-`, `@`, tab
  ou CR recebem tratamento definido em T01, sem alterar o valor semântico do
  dado.
- Garantir ordem determinística de colunas e estabilidade de saída: a mesma
  entrada produz byte a byte o mesmo arquivo.
- Suportar geração incremental/streaming por linha, para que T07 não precise
  materializar um dataset inteiro em memória.
- Manter o encoder puro: sem acesso a banco, sessão, ambiente ou relógio.

## Subtarefas

- [ ] Implementar o encoder e os formatadores de dinheiro e data.
- [ ] Implementar a definição tipada de dataset (colunas × extrator de linha)
  para que T06 declare dados e não formatação.
- [ ] Escrever testes de propriedade e de tabela para escape, injeção de
  fórmula, unicode, campo vazio, valor negativo e valor alto.
- [ ] Provar a estabilidade byte a byte com fixture versionada.

## Critérios de aceite

- [ ] Qualquer conteúdo textual sobrevive ao round-trip de leitura em um parser
  CSV padrão sem corromper colunas.
- [ ] Nenhum valor monetário perde precisão nem ganha formatação de locale.
- [ ] Campo com potencial de fórmula é neutralizado sem alterar o valor lido
  pelo usuário.
- [ ] A mesma entrada gera saída idêntica em execuções repetidas.
- [ ] O encoder não importa nada de banco, sessão ou ambiente.

## Entregáveis e evidência esperada

- [ ] `src/modules/export/csv.ts` e `csv.test.ts`.
- [ ] Fixtures em `tests/fixtures/s11-operacao-confiavel/`.
- [ ] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T01.
- Desbloqueia: T07.
- Paralelizável: sim.

## Fora de escopo

Ler dados, montar arquivo final, empacotar em ZIP ou entregar download.
