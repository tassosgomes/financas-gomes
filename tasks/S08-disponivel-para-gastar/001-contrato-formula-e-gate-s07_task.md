# T01 — Contrato da fórmula e gate de S07

- Status: Planejada
- Onda: 0
- Dependências: S01–S07 concluídos e seus contratos publicados
- Paralelização: Serial; desbloqueia o slice

## Objetivo

Formalizar em tipos, exemplos de tabela e casos de aceitação a semântica única
de `Spendable`, antes de consultas, engine ou telas.

## Escopo

- Confirmar que S07 publica timeline consolidada, cenário, data de referência,
  saldo inicial e itens explicáveis, incluindo parcelas futuras uma única vez.
- Fechar o contrato `GetSpendableInput` (`asOf`, cenário conservador/esperado,
  horizonte) e `SpendableBreakdown` (`raw`, `display`, déficit, buffer,
  mínimo, pontos/itens causais, versão de regra e metadados de período).
- Registrar as fórmulas e os casos `positivo`, `zero`, `raw negativo`, eventos
  no mesmo dia e horizonte sem eventos. Definir o significado de saldo inicial
  e se o ponto inicial participa do mínimo.
- Definir a semântica inicial de `operational_buffer_cents`, configuração
  ausente e mudanças de configuração; decidir se precisa de migration/versionamento.
- Determinar o tratamento de GENERAL, RESTRICTED e EXCLUDED, cartões e fontes
  previstas; deixar explícita a exclusão de recursos restritos do global.
- Especificar a porta de reservas de S09 com implementação neutra/zero e a
  regra de não dupla contagem quando S09 a preencher.

## Critérios de aceite

- [ ] Não há campo ou fórmula ambígua para UI, serviço ou testes.
- [ ] Os exemplos reconciliam em centavos e registram resultado bruto, exibido
  e déficit para o caso negativo.
- [ ] Contrato de S07 é suficiente; se não for, o gap é resolvido em S07 antes
  de iniciar T02–T07.
- [ ] Decisões que alterem a TechSpec são registradas por ADR, não implícitas
  na implementação.

## Fora de escopo

Implementar forecast, caixinhas ou uma tela.

