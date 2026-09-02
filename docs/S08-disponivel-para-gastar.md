# S08 — Quanto posso gastar

## Objetivo

Responder diretamente uma das perguntas centrais do produto: **quanto posso gastar sem comprometer obrigações e planos já conhecidos?**

## Valor entregue

O usuário recebe um número explicável de disponibilidade para gasto, em vez de inferi-lo manualmente a partir de saldo, cartão e compromissos futuros.

## Fluxo principal

1. Usuário abre a visão principal/planejamento.
2. Sistema calcula recursos considerados disponíveis.
3. Subtrai compromissos protegidos pela regra da V1.
4. Exibe o montante disponível para gastar.
5. Usuário consegue abrir a composição do cálculo.

## Escopo

- Fórmula determinística baseada nos conceitos fechados no PRD.
- Considerar saldos/entradas relevantes.
- Considerar compromissos futuros conhecidos.
- Considerar reservas/caixinhas quando o domínio estiver disponível; antes de S09, manter contrato preparado sem bloquear entrega.
- Explicação detalhada da composição.
- Tratamento explícito de resultado negativo.

## Fora de escopo

- Recomendação automática de estilo de vida.
- Score financeiro.
- Forecast probabilístico de renda/despesa.
- Consultoria de investimento.

## Dependências

- S07.
- Integração final com S09 para descontar/proteger caixinhas conforme regra do produto.

## Contrato normativo

O contrato de entrada/saída, a fórmula versionada, o gate de S07, a semântica
de `GENERAL`/`RESTRICTED`/`EXCLUDED`, o buffer operacional e a porta neutra de
reservas estão em [`ADR-011 — Contrato de disponibilidade para gastar do
S08`](adr/011-s08-spendable-contract.md). Ele prevalece sobre esta descrição
genérica quando definir campos, datas, cenários, deduplicação e reconciliação.

## Dados / domínio

Preferir um serviço de cálculo derivado dos dados existentes em vez de persistir um saldo "disponível" suscetível a ficar inconsistente, salvo necessidade técnica comprovada.

## Backend

- Serviço central `available_to_spend` ou equivalente.
- Breakdown estruturado da fórmula.
- Versionamento/regra centralizada para evitar fórmulas divergentes entre telas.

## Frontend

- Card/visão de destaque do valor disponível.
- Breakdown acessível.
- Estado negativo e zero claramente compreensíveis.
- Indicação de período/data de referência.

## Critérios de aceite

- [ ] Mesmo conjunto de dados produz sempre o mesmo resultado.
- [ ] Valor exibido pode ser reconciliado pelo breakdown.
- [ ] Compromissos conhecidos não são ignorados.
- [ ] Não há dupla contagem de transações/faturas.
- [ ] Valor negativo é representado corretamente, sem ser mascarado como zero.
- [ ] Cálculo respeita isolamento do espaço financeiro.

## Testes

- Disponível positivo, zero e negativo.
- Sem transações.
- Com parcelas futuras.
- Com entradas futuras consideradas pela regra.
- Após integração S09: com valores reservados em caixinhas.

## Observabilidade

- Capturar inconsistências/falhas de cálculo.
- Se útil, registrar apenas componentes agregados técnicos, evitando dados financeiros crus no Sentry.

## Tarefas internas sugeridas

1. Formalizar fórmula do PRD em casos de teste.
2. Implementar serviço de cálculo.
3. Implementar breakdown.
4. Criar UI principal.
5. Validar com cenários financeiros de exemplo.
6. Integrar caixinhas quando S09 estiver pronto.

## Definition of Done

O usuário consegue abrir o sistema e obter um valor de "quanto posso gastar" cuja composição é compreensível e reconciliável com seus dados.
