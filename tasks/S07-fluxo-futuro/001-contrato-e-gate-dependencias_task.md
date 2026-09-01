# T01 — Contrato do forecast e gate de dependências

- Slice: S07 — Fluxo futuro
- Status: Concluída
- Onda: 0
- Dependências: S03 e S06 concluídos; contratos de `FinancialEvent`, ledger, `Money`, `PlainDate`, UUIDv7 e tenancy preservados
- Paralelização: Não; desbloqueia T02–T13

## Objetivo

Fechar a semântica de compromisso, realizado, previsto e projeção antes de criar fontes, consultas ou interface.

## Subtarefas

- [x] Revisar contratos e dependências S03/S06.
- [x] Publicar ADR/decision record e matriz de exemplos.
- [x] Validar os critérios de aceite e o handoff.

## Escopo

- Registrar a precedência de `docs/S07-fluxo-futuro.md` e das seções 42–57 da TechSpec sobre lacunas de implementação dos slices anteriores.
- Definir os contratos serializáveis de `ForecastItem`, `ForecastTimeline`, totais por período, origem/drill-down e os cenários `CONSERVATIVE` e `EXPECTED`.
- Fechar a regra anti-duplicidade: realização substitui a ocorrência/previsão equivalente; uma parcela do S06 entra uma vez por competência; compra econômica, pagamento de cartão e parcela não são fontes concorrentes.
- Delimitar as fontes V1: recorrência mensal/anual, ocorrência com override, evento planejado explícito e parcela futura; metas, orçamento/caixinha, spendable, estornos e forecast probabilístico ficam fora.
- Definir período por `Temporal.PlainDate`, agregação por dia antes do saldo, navegação futura sem limite conceitual e comportamento de período passado/atual/futuro.
- Definir chaves de reconciliação (`recurringRuleId + occurrenceKey`, `referenceId`), certeza, direção, precedência, erros, idempotência e autorização server-side.

## Critérios de aceite

- [x] O contrato explica `PLANNED`, `EXPECTED`, `POSTED` e `CANCELLED` sem inferir realizado por data de hoje.
- [x] Para a mesma fonte, período e dados, o resultado e a ordenação são determinísticos.
- [x] O contrato permite S08 consumir saldo/timeline sem consultar tabelas internas e deixa extensão para S10 explícita.
- [x] Nenhum payload recebe `householdId` ou autorização do client; referências cross-tenant são opacas.

## Handoff e verificações

- Publicar ADR/decision record e matriz de exemplos: salário realizado versus previsto, recorrência alterada, parcela cancelada, virada de ano e mês vazio.
- Revisar contra `docs/prd.md` §§6–11, `docs/techspec.md` §§42–57/116/ADR-010 e `docs/S06-cartoes-faturas-parcelas.md`.
- Executar `rtk git diff --check`; links de handoff devem apontar para T02–T13.

## Auditoria de fechamento T01 (2026-08-31)

- [x] [`docs/adr/008-s07-forecast-contract.md`](../../docs/adr/008-s07-forecast-contract.md)
  foi publicado como ADR-008 Aceito. Ele registra a precedência de S07,
  TechSpec, PRD e S06; o gate de S03/S06; fontes V1; estados; cenários;
  reconciliação; contrato serializável; erros; idempotência; autorização;
  matriz de exemplos; e o handoff para cada task T02–T13.
- [x] A matriz cobre explicitamente salário previsto versus realizado,
  realização parcial, alteração prospectiva de recorrência, parcela
  cancelada, compra/pagamento de cartão sem duplicidade, arredondamento,
  virada de ano, mês vazio, item planejado atrasado, mesmo dia, cenários e
  conflito de chave.
- [x] O contrato define `ForecastItem` e `ForecastTimeline` sem `householdId`,
  autorização, `Date`, `bigint`, SQL ou dependência de tabela no payload;
  centavos e datas são serializáveis e referências são resolvidas no
  servidor.
- [x] A verificação `rtk git diff --check` passou em 2026-08-31; os doze links
  de handoff da ADR-008 apontam para tasks existentes. Não foram alterados
  código, schema, migration, actions ou UI: essas entregas continuam nas
  tasks correspondentes.

## Resultado do gate

T01 está concluída e libera semanticamente T02–T13 para execução conforme a
matriz de dependências de [`tasks.md`](tasks.md). Isso libera a Onda 1
(T02/T03/T07/T08) imediatamente; as ondas seguintes continuam sujeitas aos
gates próprios de T02–T06, T08–T12 e T13. T01 não declara o S07 entregue nem
antecipa a implementação dessas tasks.

## Fora de escopo

Implementação, previsão probabilística, metas, caixinhas, orçamento, conta de investimento, refund/correction genérico e UI final.
