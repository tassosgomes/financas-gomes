# T01 — Contrato CSV e decisões de importação

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — ADR, contrato CSV e decisões de importação concluídos em 2026-08-30.
- Onda: 0
- Dependências: S01, S02 e S03 concluídos
- Paralelização: Não; gate para schema, parser e UI

## Objetivo

Eliminar ambiguidades de formato, persistência e semântica antes de implementar upload ou migrations.

## Escopo

- Registrar que S04 é uma exceção deliberada à seção 98 da TechSpec e limita-se a CSV canônico normalizado.
- Fechar o CSV UTF-8: cabeçalho obrigatório `occurred_on,description,amount_cents`; coluna opcional `external_id`; datas `YYYY-MM-DD`; centavos inteiros assinados e diferentes de zero; descrição não vazia após trim.
- Definir BOM, newline, aspas, delimitador, ordem de colunas, colunas desconhecidas, arquivo vazio, limite de bytes e limite de linhas.
- Mapear sinal para `INCOME`/`EXPENSE`, `POSTED`, origem `IMPORT`, valor absoluto no evento e sinal no entry; confirmar que categoria e tags ficam ausentes nesta V1.
- Escolher estratégia parcial explícita, política de preview token e expiração, fingerprint do conjunto normalizado, resposta para conjunto repetido e política de reimportação intencional.
- Definir entidades persistidas, índices, retenção de dados de prévia e quais metadados de arquivo podem ser exibidos/guardados.
- Registrar códigos de erro e o contrato de contagens: processadas, válidas, inválidas, ignoradas por duplicidade e importadas.

## Subtarefas

- [x] Registrar ADR do contrato CSV e das decisões de importação, com precedência explícita sobre a seção 98 da TechSpec — [`ADR-005`](../../docs/adr/005-s04-importacao-csv-contract.md).
- [x] Fechar formato, limites, normalização e regras de sinal do CSV canônico — UTF-8/BOM, CSV estrito, limites de 5 MiB/10.000 registros, `PlainDate`, `bigint` e mapeamento para `INCOME`/`EXPENSE`.
- [x] Fechar preview, persistência mínima, fingerprint, idempotência e política de reimportação — staging server-side com token de 15 minutos, SHA-256 por multiconjunto e reimportação intencional fora da V1.
- [x] Definir contratos de comandos, respostas, erros, contagens e metadados para consumo por T02–T13 — confirmação somente com `commandId` + token, relatório sanitizado e handoff no ADR.
- [x] Validar compatibilidade com S01–S03 e registrar referências/handoff para as tasks dependentes — ADR-005 referencia S01/S02/S03 e inclui handoff explícito para T02–T13.

## Critérios de aceite

- [x] Existe decision record referenciado pelas tasks T02–T13 — [`ADR-005`](../../docs/adr/005-s04-importacao-csv-contract.md) contém handoff com links individuais para T02–T13 e a documentação do S04 o torna normativo.
- [x] Um exemplo válido e exemplos inválidos não admitem interpretação de locale ou float — layout, encoding, delimitador, datas e centavos têm gramática estrita e exemplos no ADR.
- [x] O contrato não aceita tenant, conta nem linhas confiáveis vindas do cliente na confirmação — `ConfirmTransactionImportCommand` recebe somente `commandId` e `previewToken`; contexto e staging são server-side.
- [x] Reimportação e linhas idênticas legítimas têm comportamento distinto e documentado — o fingerprint preserva multiplicidade, enquanto o conjunto confirmado é único por household/conta.
- [x] O contrato é compatível com as invariantes de S03 e o ledger da TechSpec — origem `IMPORT` é extensão controlada; eventos absolutos e entries assinados permanecem `POSTED`, tenant-safe e transacionais.

## Verificações

- [x] `git diff --check --no-index /dev/null docs/adr/005-s04-importacao-csv-contract.md` — sem whitespace inválido.
- [x] `git diff --check --no-index /dev/null docs/S04-importacao-csv.md` — sem whitespace inválido.
- [x] Links do ADR para T02–T13 e para a T01 — arquivos de destino existentes.
- [x] Não foram necessários testes de código: esta T01 altera somente contrato/documentação; parser, schema, UI e integração são gates das tasks seguintes.

## Fora de escopo

Layouts nativos de bancos, OFX, categorização, conciliação e importação recorrente.
