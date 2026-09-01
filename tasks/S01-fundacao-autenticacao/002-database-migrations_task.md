# T02 — PostgreSQL, Drizzle e migrations

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 2
- Dependências: T01
- Paralelização: Pode executar em paralelo com T03 e com a configuração inicial de T13

## Objetivo

Disponibilizar PostgreSQL real no desenvolvimento e um fluxo versionado de schema que funcione localmente, em Preview e em produção.

## Escopo

- Configurar PostgreSQL local via Docker Compose.
- Configurar Drizzle ORM e a conexão com PostgreSQL.
- Configurar a conexão com Neon para produção.
- Criar comandos documentados para:
  - gerar migrations;
  - aplicar migrations localmente;
  - verificar migrations pendentes;
  - aplicar migrations de forma controlada.
- Criar o arquivo de configuração do banco e o arquivo de ambiente de exemplo.
- Manter migrations no Git e orientadas para frente.
- Garantir que a aplicação não execute migration no boot.
- Preparar o banco de integração para testes com PostgreSQL real.
- Validar que a configuração continua portável para docker build e docker compose up.

## Critérios de aceite

- [ ] Um PostgreSQL local sobe por Docker sem SQLite.
- [ ] A aplicação consegue conectar ao banco local usando a configuração documentada.
- [ ] Uma migration vazia ou inicial pode ser gerada e aplicada repetidamente sem comportamento ambíguo.
- [ ] O estado de migrations pode ser verificado sem iniciar a aplicação web.
- [ ] O caminho de produção está separado do boot da aplicação.
- [ ] O ambiente Preview pode usar suas próprias variáveis sem criar um ambiente de staging permanente.
- [ ] O comando de build da imagem Docker funciona.

## Notas de implementação

O deploy deve seguir migration controlada e depois deploy da aplicação. O processo normal não deve depender de alteração manual do schema no dashboard do provedor.
