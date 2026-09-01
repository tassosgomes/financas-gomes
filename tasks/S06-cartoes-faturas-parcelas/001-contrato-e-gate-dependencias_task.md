# T01 — Contrato do slice e gate de dependências

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída
- Onda: 0
- Dependências: S01, S02 e S03; S04/S05 não são gates de domínio adicionais
- Paralelização: Não; task serial que desbloqueia T02–T17

## Objetivo

Eliminar ambiguidades entre o PRD, a TechSpec, o documento do S06 e o ledger
já existente antes de alterar enums, tabelas, actions ou rotas.

## Escopo

- Registrar a precedência do documento específico do S06 e das seções 18–27 e
  117 da TechSpec sobre a formulação antiga do PRD que tratava cartão apenas
  como tag.
- Confirmar os gates de S01–S03: `requireFinancialContext`, isolamento por
  `household_id`, `accounts`/categorias, `FinancialEvent` + `AccountEntry`,
  `Money`, `PlainDate`, UUIDv7 e `application_commands`.
- Fechar o vocabulário persistido e de domínio: `CREDIT_CARD`, `PURCHASE`,
  `TRANSFER`, `InstallmentPlan`, `Installment`, billing cycle, fatura,
  obrigação, limite e saldo credor. Não criar uma tabela `transactions` nova.
- Definir se `origin=MANUAL` é suficiente para compra criada pelo usuário ou
  se a extensão de origem precisa de uma decisão explícita; manter o produtor
  distinguível pelo `kind` e pela operação do command.
- Definir o contrato da compra à vista e parcelada: evento econômico único,
  entries do cartão, snapshot das datas calculadas, vínculo de cada parcela e
  regra para N=1. Registrar que o efeito econômico futuro para Caixinhas é o
  valor total da compra, enquanto as parcelas representam somente o fluxo de
  cobrança.
- Fechar o algoritmo de competência: inclusão/exclusão do próprio dia de
  fechamento, normalização de dias 29–31 em meses curtos, cálculo do
  vencimento, vigência das regras e `billing_due_on_override` se incluído.
- Fechar estados e transições. Em particular, não usar `PAID` em parcela,
  não confundir parcela lançada com fatura paga e não permitir mutação
  independente de uma parcela.
- Definir a fonte de verdade para faturas, obrigação total, comprometimento de
  limite, crédito e estado pago/parcialmente pago. Fatura permanece projection;
  pagamentos não recebem `statementId` nem `installmentId`.
- Definir commands serializáveis, códigos de erro, payloads de read model,
  política de `commandId` repetido e fronteiras de transaction para criar,
  pagar, editar e cancelar.
- Definir campos realmente editáveis (metadados) e a política de cancelamento
  de uma compra como unidade, inclusive o que ocorre com entries publicados,
  parcelas futuras e pagamentos já registrados.

## Entregáveis

- Decision record/ADR do S06 com exemplos concretos de datas, arredondamento,
  estados, cálculo de fatura, pagamento e cancelamento.
- Handoff explícito para T02–T17, incluindo nomes de operações, invariantes,
  erros e shapes serializáveis.
- Matriz de casos-limite que as tasks de domínio e integração devem consumir.

## Critérios de aceite

- [x] Não há duas fontes de verdade para cartão, fatura ou compra; a relação
  `Account → Purchase → InstallmentPlan → Installments` está documentada.
- [x] Está explícito como uma compra à vista, uma compra 1x e uma compra N>1
  aparecem no ledger e na projection, sem duplicidade.
- [x] Está explícito como a compra no próprio dia do fechamento é classificada
  e como o vencimento é obtido em qualquer mês do calendário.
- [x] Está explícito que mudanças de billing futuras não reinterpretam
  parcelas já geradas e que override não altera a regra global.
- [x] Pagamento maior que a dívida, pagamento parcial e pagamentos em ordem
  arbitrária têm resultado definido sem alocação artificial por parcela.
- [x] Edição/cancelamento não sobrescreve fato `POSTED`, não permite pagamento
  individual e define o comportamento de parcela futura já cancelada.
- [x] O contrato não aceita tenant, autorização ou conta confiados ao cliente;
  todo acesso usa o contexto financeiro resolvido no servidor.
- [x] O documento lista explicitamente o que fica fora: rotativo, juros,
  parcelamento de fatura, integração com operadora, reconciliação e refund
  parcial/complexo; a UI não deve prometer `Expected Refund` antes do slice
  de estornos.

## Verificações

- Revisar referências para [`docs/prd.md`](../../docs/prd.md), [`docs/techspec.md`](../../docs/techspec.md) e [`docs/S06-cartoes-faturas-parcelas.md`](../../docs/S06-cartoes-faturas-parcelas.md).
- Validar os exemplos do ADR manualmente contra `Money`, `PlainDate` e as
  invariantes 1, 3, 7, 10, 13–18 e 21 da TechSpec.
- Executar `rtk git diff --check` e verificar que todos os links de handoff
  apontam para tasks existentes.

## Auditoria de fechamento T01 (2026-08-31)

- [x] ADR-007 foi conferida contra S01–S03: o cartão usa
  `accounts.type=CREDIT_CARD`, o tenant é resolvido por `household_id`, o
  ledger continua separado entre `FinancialEvent` e `AccountEntry`, e não há
  saldo armazenado em `accounts`.
- [x] A decisão de origem foi explicitada: compras e pagamentos iniciados por
  command usam `origin=MANUAL`; `kind` e a operação distinguem o produtor, e
  `SYSTEM` fica reservado a reversals/efeitos compensatórios.
- [x] O vocabulário de commands foi fechado para T02–T09, incluindo criação e
  manutenção de cartão (`credit_card.create`, `.update`, `.archive`), criação
  e atualização de billing (`.billing_rule.create`, `.billing_rule.update`),
  compra, cancelamento, metadata e pagamento.
- [x] O handoff de T02 exige FKs compostas em todos os vínculos e a relação
  obrigatória tenant-safe em ambos os lados de `Purchase ↔ InstallmentPlan`;
  fatura continua projection.
- [x] As referências de T02–T17 na ADR-007 e neste plano apontam para os
  arquivos de task existentes; a implementação de código/migration permanece
  exclusivamente no T02, conforme o limite desta task.

## Fora de escopo

Implementar código, criar a migration ou decidir silenciosamente qualquer
regra que altere a semântica do ledger. Refund, reversal genérico, correction
genérica e cancelamento parcial pertencem a slice posterior; T01 só define a
interface de cancelamento integral necessária ao S06.
