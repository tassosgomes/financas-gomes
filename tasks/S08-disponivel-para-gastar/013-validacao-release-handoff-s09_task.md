# T13 — Validação de release e handoff para S09

- Status: Planejada
- Onda: 4
- Dependências: T05, T11 e T12
- Paralelização: Não; fechamento serial

## Objetivo

Auditar o slice contra os documentos normativos, executar os gates de release
e deixar a integração de reservas para S09 verificável.

## Escopo

- Revisar todos os critérios de S08 e a Definition of Done deste índice contra
  evidências de T01–T12; não promover item sem prova correspondente.
- Executar migrations/checks, lint, typecheck, testes unitários, integração,
  E2E e build conforme scripts do repositório; registrar falhas externas sem
  falsificar aprovação.
- Revisar redaction/Sentry e consultas lentas; executar smoke no ambiente
  autorizado, incluindo breakdown e cenário de déficit.
- Verificar que o contrato/porta de T08 está documentado em S09 e que os testes
  de reserva protegida permanecem pendentes e explicitamente pertencem à
  integração S09, não ao encerramento pré-S09.

## Critérios de aceite

- [ ] Todos os gates aplicáveis têm evidência atual e a release não persiste
  saldo de spendable.
- [ ] Handoff identifica API, versão, fixtures e cenários que S09 deve cumprir.
- [ ] Nenhum requisito de caixinhas é declarado concluído antes da integração S09.

