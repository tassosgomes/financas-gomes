# T10 — UI: Settings → dados e portabilidade, ação de exportar

- Status: Concluída
- Onda: 3
- Dependências: T05, T07
- Paralelização: Com T09 e T12

## Objetivo

Dar ao usuário um caminho óbvio e autoexplicativo para levar seus dados embora,
dentro da área de configurações já existente, sem inflar a navegação principal.

## Escopo

- Criar a página de portabilidade dentro de `src/app/settings`, seguindo o
  layout e o padrão de navegação já usados por `settings/categories`.
- Apresentar o que a exportação contém, em linguagem direta: quais conjuntos de
  dados, em que formato e o que deliberadamente não é incluído.
- Disparar a exportação por uma ação única, consumindo a superfície de T07 sem
  reimplementar leitura, filtro ou formato.
- Renderizar datasets indisponíveis por gate externo como indisponíveis e
  explicados, nunca omitidos silenciosamente e nunca exportados vazios como se
  fossem completos.
- Não enviar `householdId`, `userId` nem qualquer autoridade de tenancy a
  partir do browser.
- Manter a página utilizável em 360px (PRD §24, TechSpec §97) e acessível por
  teclado.

## Subtarefas

- [x] Criar rota, layout e entrada de navegação em Settings.
- [x] Implementar o componente de exportação consumindo os contratos de T05.
- [x] Escrever o texto explicativo do conteúdo e dos limites da exportação.
- [x] Cobrir a página com teste de componente para os estados principais.

## Critérios de aceite

- [x] A portabilidade é alcançável a partir de Settings sem instrução externa.
- [x] A ação de exportar funciona em um clique para o espaço financeiro atual.
- [x] Dataset indisponível aparece como indisponível e explicado.
- [x] Nenhum parâmetro de tenancy sai do browser.
- [x] A página permanece legível e operável em 360px e por teclado.

## Entregáveis e evidência esperada

- [x] Rota, componentes e testes de componente versionados.
- [x] Registro visual (captura) do estado inicial da tela.
- [x] `vitest`, `eslint` e `tsc` aprovados no write set.

## Sequenciamento

- Bloqueado por: T05, T07.
- Desbloqueia: T11, T15.
- Paralelizável: sim.

## Fora de escopo

Estados de progresso, conclusão e erro (T11) e configuração de backup na UI —
backup é operação, não funcionalidade de usuário na V1.
