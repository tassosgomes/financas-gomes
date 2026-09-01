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
