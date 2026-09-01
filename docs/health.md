# Health e readiness

A aplicação expõe dois endpoints públicos, sem sessão de usuário e sem
executar migrations:

| Endpoint | Papel | Banco necessário | HTTP saudável | HTTP indisponível |
| --- | --- | --- | --- | --- |
| `GET /api/health` | Liveness: processo capaz de responder | Não | `200` | Não se aplica |
| `GET /api/readiness` | Readiness: PostgreSQL e schema de migrations acessíveis | Sim | `200` | `503` |

As respostas são JSON, não são armazenadas em cache e contêm apenas o status
dos checks e o horário UTC da verificação. Erros do driver, URLs de conexão,
secrets e outros detalhes internos não são retornados.

Exemplo de liveness:

```json
{
  "status": "ok",
  "checks": [{ "name": "process", "status": "ok" }],
  "checkedAt": "2026-08-29T15:00:00.000Z"
}
```

Exemplo de readiness indisponível:

```json
{
  "status": "degraded",
  "checks": [{ "name": "database", "status": "degraded" }],
  "checkedAt": "2026-08-29T15:00:00.000Z"
}
```

## Vercel e monitoramento

Configure o monitor HTTP para `GET https://<dominio>/api/health` como
liveness e `GET https://<dominio>/api/readiness` como readiness. Considere
qualquer resposta diferente de `200` no readiness como indisponibilidade do
deployment. O health continua retornando `200` durante uma indisponibilidade
do PostgreSQL, permitindo distinguir processo vivo de dependência pronta.

Antes de direcionar tráfego para um deployment novo, aplique as migrations em
uma etapa controlada e então valide:

```bash
curl --fail --show-error --silent https://<dominio>/api/health
curl --fail --show-error --silent https://<dominio>/api/readiness
```

Não use `npm run db:migrate:*` como parte de uma chamada HTTP: migrations são
operadas separadamente do boot e dos probes.
