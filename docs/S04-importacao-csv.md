# S04 — Importação de extrato CSV

O contrato normativo do slice está em [`ADR-005 — Contrato CSV e decisões de importação`](adr/005-s04-importacao-csv-contract.md). As tasks T02–T13 devem consumi-lo antes de alterar parser, schema, actions ou UI.

O [guia do CSV canônico e catálogo de fixtures](S04-importacao-csv-fixtures.md)
explica como preparar um arquivo sem conhecer o formato de um banco e aponta
para fixtures sintéticas versionadas. A [matriz de critérios e casos de teste](S04-importacao-csv-matriz-testes.md)
liga cada aceite, código de erro e cenário de segurança à camada de teste
correspondente.

## Objetivo

Permitir que o usuário traga para o sistema, de uma só vez, transações provenientes de um extrato bancário previamente convertido para o formato CSV aceito pela aplicação.

## Valor entregue

Em vez de digitar movimentações uma a uma, o usuário importa um arquivo normalizado e transforma suas linhas em transações persistidas.

## Premissa de produto

Na V1 o sistema **não precisa entender o formato nativo de cada banco**. O usuário pode adaptar externamente o extrato — inclusive com ajuda de IA — para o layout CSV documentado pelo produto. Suporte específico a formatos bancários fica para versão futura.

## Fluxo principal

1. Usuário escolhe a conta de destino.
2. Seleciona um CSV no layout suportado.
3. Sistema valida estrutura e conteúdo.
4. Exibe resumo/prévia da importação.
5. Usuário confirma.
6. Linhas válidas viram transações.
7. Sistema apresenta quantidade importada, ignorada e com erro.

## Escopo

- Definir e documentar layout CSV canônico.
- Upload de arquivo.
- Parsing seguro.
- Validação por linha.
- Preview antes da confirmação.
- Importação atômica ou estratégia explícita de importação parcial.
- Mecanismo contra duplicação acidental.
- Registro de origem = importação.
- Relatório final do processamento.

## Fora de escopo

- Parser específico do Bradesco ou outros bancos.
- OFX.
- Open Finance.
- IA dentro do produto para converter arquivos.
- Matching avançado entre instituições.

## Dependências

- S01.
- S02.
- S03, para reutilizar o modelo e regras de transação.

## Dados / domínio

Além de `transactions`, pode ser necessária uma entidade de importação, por exemplo:

- `transaction_imports`
- identificador/fingerprint de linha ou arquivo

A estratégia de idempotência deve impedir que o usuário importe acidentalmente o mesmo conjunto duas vezes sem qualquer aviso ou proteção.

## Backend

- Endpoint/action de upload.
- Parser CSV com limites de tamanho/linhas.
- Validador do schema canônico.
- Preview estruturado.
- Persistência transacional.
- Fingerprint/idempotência.
- Resultado resumido e erros por linha.

## Frontend

- Tela de importação.
- Link/descrição do formato CSV esperado.
- Seletor de conta.
- Upload.
- Preview.
- Confirmação.
- Resultado final.

## Critérios de aceite

- [ ] CSV válido gera preview correto.
- [ ] CSV estruturalmente inválido não cria nenhuma transação inadvertidamente.
- [ ] Linhas inválidas são identificadas com mensagem acionável.
- [ ] Usuário sabe quantas transações serão criadas antes de confirmar.
- [ ] Importação concluída cria transações vinculadas à conta correta.
- [ ] Reenvio do mesmo arquivo/conjunto não duplica silenciosamente as transações.
- [ ] Usuário de outro espaço não acessa nem reaproveita importações alheias.

## Testes

- Fixtures de CSV válido.
- Fixtures com cabeçalho inválido.
- Valores/data inválidos.
- Duplicidade.
- Arquivo vazio.
- Limites de tamanho.
- Integração de persistência.
- E2E completo do upload à listagem.

## Observabilidade

- Falhas de parsing/importação no Sentry.
- Métricas/logs de quantidade de linhas, sucesso e falha sem enviar conteúdo financeiro bruto desnecessário.

## Tarefas internas sugeridas

1. Fechar schema CSV canônico.
2. Criar modelo de importação/fingerprint se necessário.
3. Implementar parser e validação.
4. Implementar preview.
5. Implementar confirmação/persistência.
6. Implementar idempotência.
7. Criar UI de importação.
8. Documentar exemplo CSV.
9. Criar matriz de testes.

## Definition of Done

Um extrato já normalizado pode ser importado pela interface e aparecer na mesma listagem usada pelas transações manuais, com proteção básica contra duplicidade.
