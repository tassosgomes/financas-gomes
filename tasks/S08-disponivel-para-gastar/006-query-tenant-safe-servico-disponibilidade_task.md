# T06 — Query tenant-safe e serviço de disponibilidade

- Status: Planejada
- Onda: 2
- Dependências: T02, T03, S07 e contexto financeiro S01
- Paralelização: Com T08; T05 integrada continuamente

## Objetivo

Compor saldo inicial, configuração do household, forecast de S07 e reserva
neutra em um único serviço server-side de disponibilidade.

## Escopo

- Obter `householdId` somente de `requireFinancialContext`; validar `asOf`,
  cenário e horizonte dentro dos limites fechados em T01.
- Consultar saldo consolidado apenas de entries `POSTED` de contas GENERAL,
  com predicates tenant-scoped em todos os joins; recursos RESTRICTED e
  EXCLUDED ficam fora do global.
- Consumir o contrato S07, a configuração de buffer e a porta de reservas;
  chamar T03 e mapear somente o DTO público versionado.
- Retornar ausência/erro opaco para household inexistente ou não configurado,
  conforme T01; não persistir snapshot de spendable.
- Garantir que cartões/faturas/parcelas são consumidos exclusivamente pela
  fonte consolidada de S07, não por uma segunda query local.

## Critérios de aceite

- [ ] Toda leitura é tenant-scoped e cross-tenant não revela existência nem valores.
- [ ] Mesmos dados/configuração/entrada retornam o mesmo DTO.
- [ ] Saldos de benefício ou investimentos não aumentam o global.

