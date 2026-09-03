# S09 — Caixinhas

## Objetivo

Permitir que o usuário reserve dinheiro mental e operacionalmente para objetivos futuros sem misturá-lo ao valor livre para consumo.

## Valor entregue

O usuário cria caixinhas, define quanto pretende reservar e acompanha quanto já está destinado a cada objetivo.

## Terminologia

O produto utiliza o nome **caixinhas**.

## Contrato fechado pela T01

As decisões normativas de fronteira, associação com categoria, vigência,
movimentos, alocação, metas, saldo derivado e integração com Spendable estão
em [`ADR-012 — Contrato de Caixinhas, fronteira e integração S09`](adr/012-s09-caixinhas-contract.md).
A matriz de dependências, cenários e gates de T02–T15 está em
[`Matriz de dependências, decisões e gates`](S09-caixinhas-contract-matrix.md).

Em resumo: a UI chama o recurso de **Caixinha**; o domínio usa `Budget` e a
porta do S08 usa `ReserveBox`. Cada Caixinha tem uma categoria `EXPENSE`, uma
categoria só pode ter uma Caixinha vigente por vez e a Caixinha mais específica
vence para uma despesa na data econômica. `activeFrom` é inclusivo e
`closedOn` é exclusivo para proteção: a data de encerramento preserva
histórico, mas não protege o Spendable.

Movimentos têm amount positivo em centavos e o tipo carrega o sinal:
`CONTRIBUTION` soma e `WITHDRAWAL` subtrai. Saldo, rollover, progresso e
proteção são derivados com `Money`/`bigint`; não existe saldo persistido.
Somente uma receita realizada gera distribuição automática, usando as regras
`budget_allocation_rules.amount_cents` efetivas na data e arredondamento
determinístico que totaliza exatamente a receita. Ausência de regra não cria
aporte implícito.

## Fluxo principal

1. Usuário cria uma caixinha.
2. Define nome e informações mínimas do objetivo.
3. Adiciona ou ajusta valor reservado.
4. Visualiza total reservado e progresso.
5. O valor protegido passa a impactar a visão de dinheiro disponível conforme regra da V1.

## Escopo

- Criar/editar/encerrar caixinha.
- Valor reservado atual.
- Meta e/ou data-alvo somente se previstas no PRD.
- Movimentações de aporte/retirada ou estratégia equivalente auditável no nível de domínio, sem exigir auditoria por usuário.
- Total reservado.
- Integração com "Quanto posso gastar".

## Fora de escopo

- Conta bancária real separada.
- Transferência automática bancária.
- Investimentos associados à caixinha.
- Regras complexas de rendimento.

## Dependências

- S01.
- S08 para integração final; a modelagem da caixinha pode ser implementada em paralelo após a base financeira.

## Handoff S08 → S09 (T08)

O proprietário da implementação final é o **domínio/backend do S09 —
Caixinhas e movimentos**. S08 mantém somente a porta de leitura; T06 apenas a
consumirá quando o domínio estiver disponível. Nenhuma tabela, migration ou
CRUD de caixinhas é criada no slice S08.

Este handoff é detalhado e fechado por
[`ADR-012`](adr/012-s09-caixinhas-contract.md) e pela
[`matriz T01`](S09-caixinhas-contract-matrix.md). Em particular, T08 S09 deve
consumir a fonte de movimentos normalizada pelo S09, sem assumir saldo
persistido ou criar ledger/forecast paralelo.

A porta versionada publicada em
[`src/modules/spendable/reserve-adapter.ts`](../src/modules/spendable/reserve-adapter.ts)
usa `s09.v1` e recebe, no servidor, apenas `asOf`, cenário, horizonte e as
referências já refletidas. Não recebe `householdId`, `userId`, conta ou
qualquer autoridade do browser. O contexto de tenancy é resolvido antes da
porta pelo leitor server-side.

O fornecedor S09 deve devolver saldo derivado dos movimentos efetivos até a
data de corte, nunca um saldo persistido:

- `CONTRIBUTION` soma e `WITHDRAWAL` subtrai, com `amount` positivo em
  `Money`/centavos e `effectiveOn` em `Temporal.PlainDate`;
- a caixinha é identificada por referência opaca e regra
  `BOX_BALANCE_PROTECTED`; referências de movimentos são únicas;
- saldo negativo é preservado no balanço da caixinha, mas gera proteção zero e
  nunca aumenta o spendable global;
- `closedOn` é efetivo: a consulta anterior ao encerramento preserva a
  proteção histórica; na data de encerramento ou depois, a caixinha não
  protege o global e seu histórico continua disponível;
- a contribuição/retirada já refletida em `POSTED` ou em item do forecast não
  gera ajuste novamente. A retirada não refletida libera a proteção uma única
  vez; o ajuste de abertura é aplicado antes do mínimo, nunca como subtração
  posterior do `rawSpendable`.

Antes da entrega do S09, `ZeroReserveAdapter` retorna explicitamente
`status=UNAVAILABLE`, `protectedCents="0"`,
`appliedOpeningAdjustmentCents="0"` e `components=[]`. A serialização é a
mesma do `SpendableReserveSnapshot` público, de modo que plugar o fornecedor
de S09 não altera a API do S08.

### Cenários que S09 deve habilitar

Os testes de integração do S09 devem provar, com dados tenant-scoped:

1. uma reserva reduz o bruto uma vez, mesmo quando a caixinha tem vários
   aportes;
2. uma retirada aumenta o disponível uma vez, sem devolver também o mesmo
   movimento como entrada do forecast;
3. saldo negativo e caixinha encerrada não aumentam o spendable global, mas
   continuam explicáveis no domínio/histórico;
4. recursos `RESTRICTED` e `EXCLUDED` não são somados à abertura `GENERAL`;
5. referências de contribuição, retirada e despesa já refletidas são
   deduplicadas, e uma parcela/compra/pagamento não é tratada como fonte de
   reserva concorrente.

Esses cenários pertencem ao fechamento do S09; a preparação T08 também
comprova o mapeamento tenant-safe das linhas persistidas disponíveis em T05/T06
para o adapter, mas o provider vertical e a reconciliação financeira aguardam
T07. O slice S08 continua comprovando a porta, o zero explícito e a derivação
pura, sem assumir semântica de movimentos ainda não publicada.

O provider deve montar seu stream tenant-scoped a partir de movimentos
`CONTRIBUTION`/`WITHDRAWAL`, despesas de categoria e refunds na data efetiva.
Compra parcelada reduz a Caixinha pelo valor econômico total uma única vez;
parcelas, fatura e pagamento não são fontes concorrentes. A porta aceita
somente `asOf`, cenário, horizonte e referências já refletidas; o household é
resolvido antes da chamada. `protectedCents` é positivo, saldo negativo fica
explicável no domínio e `appliedOpeningAdjustmentCents` entra antes do mínimo
do S08, sem subtrair a proteção novamente.

## Dados / domínio

Possíveis entidades:

- `boxes`
- `box_movements` ou equivalente

Preferir movimentos de aporte/retirada em vez de sobrescrever saldo sem histórico, caso isso seja necessário para manter consistência.

## Backend

- CRUD de caixinha.
- Aporte/retirada.
- Cálculo de saldo reservado.
- Regras contra saldo inválido quando aplicáveis.
- Integração com serviço de disponibilidade para gasto.

## Frontend

- Lista de caixinhas.
- Criar/editar.
- Aportar/retirar.
- Exibir saldo/progresso.
- Mostrar impacto no valor disponível.

## Critérios de aceite

- [x] Usuário cria uma caixinha.
- [x] Usuário reserva valor nela.
- [x] Saldo da caixinha é consistente com seus movimentos.
- [x] Valor reservado não continua aparecendo como livre para gastar quando a regra do produto determinar sua proteção.
- [x] Retirada ajusta corretamente saldo e disponibilidade.
- [x] Encerrar caixinha não perde o histórico necessário.

Fechamento funcional auditado em T15 (2026-09-03): os seis critérios têm
prova unitária, PostgreSQL vertical e matriz E2E ampla final (28/28). A
promoção do worktree está liberada; publicação/smoke de produção depende de
credenciais e autorização do ambiente, conforme registrado em
tasks/S09-caixinhas/015-validacao-release-handoff_task.md.

## Testes

- Criar e aportar.
- Múltiplos aportes/retiradas.
- Limites e valores inválidos.
- Encerramento.
- Integração com S08.

## Observabilidade

- Capturar falhas de consistência e persistência.
- Alertar tecnicamente para saldo derivado inconsistente se existir invariant aplicável.

## Tarefas internas sugeridas

1. Fechar modelo de saldo/movimentos.
2. Criar migrations.
3. Implementar CRUD.
4. Implementar aporte/retirada.
5. Criar UI.
6. Integrar com disponibilidade para gasto.
7. Cobrir invariantes com testes.

## Definition of Done

O usuário consegue separar parte dos seus recursos em objetivos chamados caixinhas e essa reserva é respeitada pelo cálculo de disponibilidade financeira.
