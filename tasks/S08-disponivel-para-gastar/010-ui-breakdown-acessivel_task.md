# T10 — UI de breakdown acessível

- Status: Planejada
- Onda: 3
- Dependências: T04 e T07
- Paralelização: Com T09

## Objetivo

Permitir que o usuário abra uma composição clara do cálculo e navegue para as
origens que levaram ao ponto mais restritivo.

## Escopo

- Mostrar saldo de referência, menor saldo projetado, buffer, resultado bruto,
  disponível exibido, déficit quando houver e a regra/período aplicados.
- Listar/permitir drill-down dos itens causais pelo identificador autorizado;
  tratar lista vazia, truncada e origem removida/cancelada de forma explícita.
- Implementar semântica de diálogo/página, foco, teclado, leitor de tela e
  valores não dependentes exclusivamente de cor.

## Critérios de aceite

- [ ] Soma/relação exibida reconcilia exatamente o valor do card.
- [ ] Navegação a uma origem não amplia escopo de household nem quebra quando
  a origem deixou de estar disponível.

