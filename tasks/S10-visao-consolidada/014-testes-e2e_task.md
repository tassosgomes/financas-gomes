# T14 — Testes E2E da home para os detalhes

- Status: Não iniciada
- Onda: 4
- Dependências: T10, T11, T12, T13
- Paralelização: Não

## Objetivo

Provar em navegador que o usuário entende a Visão Geral e consegue ir de um
agregado até os lançamentos que o compõem, com dados determinísticos.

## Escopo

- Criar `tests/e2e/overview.spec.ts` seguindo o padrão de autenticação e seed
  já usado em `spendable.spec.ts` e `forecast.spec.ts`.
- Cenário de espaço financeiro novo: home carrega, mostra estados vazios
  coerentes e não exibe número inventado.
- Cenário representativo: verificar o valor de "pode gastar", o resumo do
  período, a lista de categorias, os próximos compromissos e o resumo de
  caixinhas.
- Navegação: clicar no drill-down de uma categoria e conferir que a tela de
  transações abre com o filtro e o total equivalentes; repetir para forecast,
  breakdown do spendable e caixinhas quando o destino existir.
- Cenário de erro parcial: simular indisponibilidade de uma origem e verificar
  que o bloco mostra erro enquanto o restante continua utilizável.
- Verificação de consulta mobile em viewport reduzido.
- Usar apenas `data-testid` estáveis definidos em T05.

## Subtarefas

- [ ] Preparar o seed E2E determinístico reutilizando as fixtures de T09/T13.
- [ ] Escrever os cenários vazio, representativo, drill-down e erro parcial.
- [ ] Adicionar a verificação de viewport mobile.
- [ ] Estabilizar seletores e esperas, sem `sleep` arbitrário.
- [ ] Integrar a spec ao pipeline de E2E.

## Critérios de aceite

- [ ] O total exibido na home e o total da tela de destino coincidem no teste,
  não apenas visualmente.
- [ ] O cenário vazio passa sem depender de dado residual.
- [ ] O cenário de erro parcial prova degradação por bloco.
- [ ] A suíte é determinística em execuções repetidas.
- [ ] Falhas preexistentes de outras specs são reportadas, não mascaradas.

## Entregáveis e evidência esperada

- [ ] `tests/e2e/overview.spec.ts`.
- [ ] Execução de `npm run test:e2e` com resultado registrado na task.
- [ ] Registro explícito de qualquer falha externa não causada pelo S10.

## Sequenciamento

- Bloqueado por: T10, T11, T12, T13.
- Desbloqueia: T15.
- Paralelizável: não.

## Fora de escopo

Teste de carga, teste visual pixel a pixel.
