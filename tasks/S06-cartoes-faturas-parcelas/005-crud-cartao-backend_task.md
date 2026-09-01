# T05 — CRUD de cartão e configuração de billing

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída tecnicamente — T05 backend, integração PostgreSQL do CRUD,
  typecheck, lint e migration check verificados em 2026-08-31; smoke/release
  permanecem downstream de T16/T17.
- Onda: 2
- Dependências: T01, T02 e T03; S01 e S02
- Paralelização: Com T10 e T11; desbloqueia as escritas de T06/T08 e a UI T12

## Objetivo

Permitir cadastrar e manter um cartão completo, sem deixar uma conta
`CREDIT_CARD` em estado incoerente e sem permitir que configurações novas
reinterpretam compras antigas.

## Escopo

- Criar o command/use case `CreateCreditCard` ou equivalente, recebendo apenas
  campos serializáveis: nome, limite em centavos, dias de fechamento/
  vencimento, conta padrão de pagamento opcional e configurações permitidas.
- Criar conta `accounts.type = CREDIT_CARD` e configuração `credit_cards` de
  forma atômica, reutilizando normalização, UUIDv7, contexto financeiro e
  unicidade de nomes de S02.
- Impedir que o CRUD genérico de contas crie/edite cartão sem a configuração
  mínima; adaptar o caminho existente ou retornar erro estável e acionável.
- Validar limite positivo dentro do range suportado, dias civis válidos,
  conta padrão ativa do mesmo household e não-cartão quando essa for a regra
  de T01. Conta arquivada não pode receber nova compra/pagamento.
- Listar e detalhar cartões com dados da conta, regra vigente, limite e
  referências necessárias para a tela, sempre com predicado de household.
- Atualizar nome e configurações sem sobrescrever a vigência usada por
  compras existentes. Alteração de fechamento/vencimento deve criar nova
  regra com `effective_from`, fechar a anterior e rejeitar sobreposição.
- Arquivar cartão sem apagar compras, parcelas, entries ou pagamentos
  históricos; impedir novos writes contra cartão arquivado.
- Expor Server Actions finas, Zod na boundary, `Result<T,E>` nos use cases e
  idempotência por `application_commands`.

## Critérios de aceite

- [x] Criar cartão produz exatamente uma conta `CREDIT_CARD`, uma configuração
  e uma regra inicial, ou nenhum registro em caso de falha.
- [x] Não é possível consultar/alterar cartão de outro household, mesmo com
  `accountId` conhecido.
- [x] Limite, dias, conta de pagamento e nome inválidos retornam erro de
  domínio sem detalhes do banco.
- [x] Repetir o mesmo command devolve o resultado original; reusar o ID com
  payload diferente retorna `COMMAND_ID_REUSED`.
- [x] Nova regra não muda o ciclo de compra antiga; regra arquivada continua
  consultável para explicar o schedule.
- [x] Arquivamento preserva histórico e remove o cartão apenas dos seletores
  de novos writes.
- [x] O caminho genérico de conta não deixa cartão sem billing config.

## Subtarefas e evidências

- [x] **T05-A1 — Contratos públicos do CRUD**: `contracts.ts` define os
  commands serializáveis de criar/editar/arquivar cartão e versionar billing,
  queries, read models, operações, limites e referências mínimas; household,
  tipo/status e autorização permanecem fora dos commands.
- [x] **T05-A2 — Schemas e parsers puros**: `validation.ts` publica schemas Zod
  estritos, normalização NFKC de nome, centavos canônicos limitados a BIGINT,
  UUIDv7, datas civis e dias 1–31, com aliases compatíveis com os contratos da
  UI de T11 e parsers `parse`/`safeParse`/`validate`.
- [x] **T05-A3 — Erros e guards de domínio**: `CreditCardDomainError`,
  `Result<T,E>`, mapeamento sem mensagens de banco, isolamento opaco por
  household, conta `CREDIT_CARD` ativa, conta de pagamento ativa do mesmo
  household e rejeição de vigência de billing sobreposta.
- [x] **T05-A4 — Testes focados**: `validation.test.ts` cobre 11 cenários de
  commands, campos imutáveis, envelopes de erro, queries, isolamento,
  arquivamento, conta padrão e versionamento de regra.
- [x] **T05-A5 — Verificação local**: testes focados (11/11), lint sem warnings
  nos arquivos T05-A e `git diff --check` passaram em 2026-08-30.
- [x] **T05-A6 — Gate global**: `rtk npm run typecheck` passou em 2026-08-31;
  `rtk npm run db:check:files` e a suíte de validação também passaram.
- [x] **T05-B1 — Use cases transacionais**: `use-cases.ts` implementa criação
  atômica conta/configuração/regra, leituras tenant-scoped, update de metadata,
  versionamento de billing, arquivamento e `Result<T,E>`.
- [x] **T05-B2 — Idempotência e observabilidade**: cada write reserva
  `application_commands` por household/command/payload, persiste o resultado
  serializável e usa `withS06CreditCardObservability` com IDs técnicos.
- [x] **T05-B3 — Boundary Server Action**: `src/app/actions/credit-cards.ts`
  resolve o contexto autenticado e expõe actions finas para CRUD/rules.
- [x] **T05-B4 — Integração de escrita**: `use-cases.integration.test.ts`
  executou os dois cenários PostgreSQL de criação/retry, metadata,
  vigência/arquivamento, conta inválida sem parcial e isolamento entre
  households; o resultado foi registrado no gate T15-I.

## Handoff

- T06 valida cartão ativo e resolve a regra de billing na data da compra.
- T07 lê regra vigente e histórico para exibir fechamento/vencimento.
- T08 valida a conta padrão ou a conta informada no pagamento.
- T12 consome actions e read models sem acessar Drizzle diretamente.

## Verificações

- Testes unitários de commands/validation e adapters de Server Action.
- Integração PostgreSQL de criação atômica, conta padrão cross-tenant,
  unicidade, arquivamento, vigência de regras e idempotência.
- `rtk npm run typecheck`, lint e `rtk npm run db:check:files`.

## Fora de escopo

Gestão de operadora, sincronização automática, reconciliação, limite
dinâmico, juros, rotativo e cartões adicionais físicos/virtuais.
