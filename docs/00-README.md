# Gerenciador Financeiro — Implementation Slices V1

Este diretório quebra a V1 em vertical slices implementáveis e validáveis de ponta a ponta.

## Princípios

- Cada slice deve terminar em comportamento utilizável e verificável pelo usuário.
- Banco, backend, frontend, testes e observabilidade são tarefas internas do slice; não slices separados.
- A ordem privilegia redução de risco arquitetural e entrega incremental de valor.
- A V1 é web-first; não há app nativo nem foco em experiência mobile.
- Os dados do produto ficam no banco da aplicação.
- IDs de domínio usam UUIDv7.
- Observabilidade usa Sentry.
- Processamento assíncrono/recorrente usa Temporal quando necessário.
- Importação bancária assume CSV já normalizado antes de entrar no produto.
- Usuários pertencentes ao mesmo contexto financeiro têm relação de confiança; não há RBAC/auditoria granular na V1.
- Reservas para objetivos são chamadas de **caixinhas**.

## Ordem sugerida

1. [S01 — Fundação, autenticação e espaço financeiro compartilhado](./S01-fundacao-autenticacao.md)
2. [S02 — Contas e categorias](./S02-contas-categorias.md)
3. [S03 — Transação manual end-to-end](./S03-transacao-manual.md)
4. [S04 — Importação de extrato CSV](./S04-importacao-csv.md)
5. [S05 — Revisão e organização das transações](./S05-revisao-transacoes.md)
6. [S06 — Cartões, faturas e compras parceladas](./S06-cartoes-faturas-parcelas.md)
7. [S07 — Compromissos e visão do fluxo futuro](./S07-fluxo-futuro.md)
8. [S08 — Quanto posso gastar](./S08-disponivel-para-gastar.md)
9. [S09 — Caixinhas](./S09-caixinhas.md)
10. [S10 — Visão financeira consolidada](./S10-visao-consolidada.md)
11. [S11 — Portabilidade, backup e operação confiável](./S11-operacao-confiavel.md)
    ([ADR-014](./adr/014-s11-portabilidade-backup.md),
    [matriz](./S11-operacao-confiavel-contract-matrix.md))

## Regra de execução

Antes de iniciar um slice, todas as dependências marcadas como obrigatórias devem estar concluídas. Um slice só é considerado pronto quando seus critérios de aceite, testes relevantes e instrumentação mínima estiverem concluídos.
