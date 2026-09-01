# T12 — Testes E2E da consulta de disponibilidade

- Status: Planejada
- Onda: 4
- Dependências: T09, T10 e T11
- Paralelização: Posterior ao contrato final de telas

## Objetivo

Validar o fluxo que o usuário vê: consultar o card, abrir a composição e
compreender um déficit ou uma disponibilidade positiva.

## Escopo

- Criar dados determinísticos para caso positivo, zero e déficit; conferir
  período/horizonte, card e reconciliação do breakdown.
- Cobrir compromisso futuro/parcelas e entrada futura conforme cenário, além
  de fallback de erro/configuração ausente.
- Verificar navegação por teclado e ação de origem quando disponível.
- Executar em dois households para comprovar que a interface não apresenta
  valores ou referências de outro espaço.

## Critérios de aceite

- [ ] Fluxo crítico passa em browser sem depender de cálculo no cliente.
- [ ] O caso negativo mostra R$ 0 gastável e déficit correto.

