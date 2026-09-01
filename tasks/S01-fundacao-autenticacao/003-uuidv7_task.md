# T03 — Geração centralizada de UUIDv7

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 2
- Dependências: T01
- Paralelização: Pode executar em paralelo com T02 e T13

## Objetivo

Garantir que os IDs de domínio criados nesta e nas próximas slices usem UUIDv7 de forma uniforme e verificável.

## Escopo

- Escolher a biblioteca ou implementação aprovada para UUIDv7.
- Criar um gerador centralizado para o domínio.
- Permitir geração do ID antes do INSERT.
- Integrar o gerador ao schema das entidades de domínio do S01.
- Verificar como os IDs gerenciados pelo Better Auth serão gerados; não aceitar silenciosamente um gerador incompatível para entidades tratadas como domínio.
- Criar testes para formato, unicidade e ordenação temporal esperada.
- Documentar o ponto único de geração para uso pelas próximas slices.

## Critérios de aceite

- [ ] Novos IDs de Household e demais entidades de domínio do S01 são UUIDv7.
- [ ] Nenhum caminho de criação do S01 usa UUIDv4, CUID ou ID incremental por padrão.
- [ ] A geração pode ocorrer antes da persistência.
- [ ] Existem testes automatizados do gerador.
- [ ] A decisão para IDs do usuário autenticado está documentada.
