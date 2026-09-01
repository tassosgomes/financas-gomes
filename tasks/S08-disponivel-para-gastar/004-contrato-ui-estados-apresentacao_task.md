# T04 — Contrato de UI e estados de apresentação

- Status: Planejada
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T03 e T05

## Objetivo

Definir read models, formatadores e componentes compartilhados para que todas
as telas comuniquem disponibilidade sem reinterpretar a regra financeira.

## Escopo

- Definir DTO serializável, labels de cenário/período, formatos monetários e
  estados `loading`, vazio, erro técnico, zero, disponível e déficit.
- Projetar a semântica acessível do card e do breakdown: valor principal,
  texto de déficit e composição devem ser legíveis por teclado/leitor de tela.
- Estabelecer links/ações para o detalhamento e para origem dos itens sem
  expor dados cross-tenant ou tornar descrições obrigatórias.

## Critérios de aceite

- [ ] Componentes recebem read model, nunca calculam saldo ou usam `number`.
- [ ] Estado negativo informa R$ 0 disponível e a quantia a recompor.
- [ ] Contrato atende desktop-first e consulta responsiva simples em mobile.

