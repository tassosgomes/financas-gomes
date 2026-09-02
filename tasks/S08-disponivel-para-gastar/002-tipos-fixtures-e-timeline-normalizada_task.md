# T02 — Tipos, fixtures e timeline normalizada

- Status: Concluída
- Onda: 1
- Dependências: T01 e contrato de forecast de S07
- Paralelização: Com T04 e T05

## Objetivo

Criar o contrato tipado que isola o engine puro das fontes de persistência e
uma matriz de fixtures financeiras reutilizável.

## Escopo

- Modelar `ForecastItem`, ponto agregado diário, cenário, certeza, referência
  opaca e componente de saldo em `Money`/`bigint` e `Temporal.PlainDate`.
- Normalizar a timeline de S07 sem conhecer Drizzle/PostgreSQL, ordenar datas
  de forma estável e agregar todos os itens do mesmo dia antes de alterar o
  saldo.
- Construir fixtures para saldo sem eventos, entrada confiável/incerta,
  compromisso futuro, parcelas, pagamento de cartão e fronteira de ano.
- Incluir cenários que provem que item já realizado ou uma parcela não entra
  duas vezes; usar IDs opacos e nunca descrições/valores em telemetria.

## Subtarefas

- [x] Publicar os tipos de domínio/serialização de S08, usando `Money`/`bigint`
  para centavos e `Temporal.PlainDate` para datas financeiras.
- [x] Implementar a normalização da timeline `s07.v1`, com agregação diária,
  ordenação canônica e independência da ordem de entrada.
- [x] Criar fixtures reutilizáveis para os cenários da matriz da ADR-011,
  incluindo a prova de não dupla contagem de realizados e parcelas.
- [x] Executar verificações focadas, registrar evidências e concluir somente
  após os critérios de aceite estarem comprovados.

## Critérios de aceite

- [x] Nenhum `number`, `float` ou `Date` participa de cálculo financeiro.
- [x] A mesma coleção em ordem distinta produz a mesma timeline diária.
- [x] Fixtures cobrem os casos de aceite de S08 e podem ser usadas por T03/T11.

## Entregáveis

- [x] [`src/modules/spendable/contracts.ts`](../../src/modules/spendable/contracts.ts)
  publica o vocabulário `s08.v1`/`spendable.v1`, tipos serializáveis do
  breakdown e tipos internos com `bigint`, `Money` e `Temporal.PlainDate`, sem
  household, autorização, SQL, Drizzle ou `Date`.
- [x] [`src/modules/spendable/timeline.ts`](../../src/modules/spendable/timeline.ts)
  consome somente o contrato serializável `ForecastTimeline` de S07, valida e
  copia os itens, rejeita referências conflitantes, ordena por chaves
  canônicas, agrega todos os itens do dia antes do replay e inclui a abertura
  no mínimo. A serialização devolve apenas strings ISO/centavos.
- [x] [`src/modules/spendable/fixtures.ts`](../../src/modules/spendable/fixtures.ts)
  exporta a matriz reutilizável (positivo, zero, déficit, mesmo dia, horizonte
  sem eventos, receitas confiáveis/incertas, compromisso, parcelas, realizado,
  pagamento de cartão, virada de ano, recursos e buffer/reserva), com IDs
  opacos e referências excluídas explicitamente para as provas de não dupla
  contagem.
- [x] [`tests/fixtures/s08-disponivel-para-gastar/manifest.json`](../../tests/fixtures/s08-disponivel-para-gastar/manifest.json)
  registra a matriz em formato estático para T03/T11.

## Evidências de verificação (2026-09-01)

- [x] `rtk npm exec vitest -- run src/modules/spendable --reporter=dot` — 3
  arquivos, 18/18 testes passaram, incluindo contrato serializável, ordem de
  entrada, agregação intradiária, PlainDate, `Money`/`bigint`, JSON, cenário,
  realizado e parcelas únicas.
- [x] `rtk npm exec vitest -- run src/modules/forecast src/modules/spendable
  --reporter=dot` — 11 arquivos, 57/57 testes focados passaram; 5 testes de
  integração opt-in foram ignorados sem flag.
- [x] `rtk npm run typecheck` — passou sem diagnósticos TypeScript.
- [x] `rtk npm exec eslint -- src/modules/spendable --max-warnings=0` — passou
  sem warnings.
- [x] `rtk git diff --check` — passou sem erros de whitespace.

O próximo engine (T03) pode consumir `NormalizedSpendableTimeline` ou a
sobrecarga de itens/range da normalização; T11 pode reutilizar
`SPENDABLE_FIXTURES`/manifest sem consultar persistência.
