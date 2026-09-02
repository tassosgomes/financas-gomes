# S09 — Caixinhas

## Objetivo

Permitir que o usuário reserve dinheiro mental e operacionalmente para objetivos futuros sem misturá-lo ao valor livre para consumo.

## Valor entregue

O usuário cria caixinhas, define quanto pretende reservar e acompanha quanto já está destinado a cada objetivo.

## Terminologia

O produto utiliza o nome **caixinhas**.

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

Esses cenários pertencem ao fechamento do S09; o slice S08 comprova apenas a
porta, o zero explícito e o adaptador puro de movimentos.

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

- [ ] Usuário cria uma caixinha.
- [ ] Usuário reserva valor nela.
- [ ] Saldo da caixinha é consistente com seus movimentos.
- [ ] Valor reservado não continua aparecendo como livre para gastar quando a regra do produto determinar sua proteção.
- [ ] Retirada ajusta corretamente saldo e disponibilidade.
- [ ] Encerrar caixinha não perde o histórico necessário.

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
