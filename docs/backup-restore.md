# Runbook de backup e restauração (S11 T13)

Procedimento operacional para recuperar o PostgreSQL da aplicação. **Não** há
tela na UI; este documento é a autoridade. Nenhum passo usa dados reais de
produção em máquina de desenvolvedor (TechSpec §112).

**Caminho de produção (V1):** Neon PITR / instant restore (decisão T02/T09
caminho B). **Não** há artefatos `pg_dump → R2/S3` na V1.

Referências: [ADR-014](adr/014-s11-portabilidade-backup.md),
[auditoria S11](S11-backup-audit.md), [health/readiness](health.md),
[deploy de produção](production-deploy.md).

## Quando restaurar

| Situação | Ação |
| --- | --- |
| Migration destrutiva ou incorreta já aplicada em produção | Restaurar PITR para timestamp anterior à migration |
| Corrupção ou perda lógica confirmada no banco | Restaurar PITR para ponto conhecido bom |
| Incidente de segurança no banco | Restaurar PITR + rotação de credenciais (fora deste runbook) |
| Exercício / validação periódica | Restaurar em **branch ou banco separado**, nunca sobrescrever produção às cegas |
| Portabilidade do usuário | Exportação CSV `s11.v1` em Settings — **não** substitui DR |

## Quem autoriza

1. **Incidente em produção:** o responsável pelo serviço (dono do produto ou
   operador de plantão) autoriza por escrito (ticket/incidente) **antes** de
   qualquer restore que afete tráfego ou dados live.
2. **Restore exploratório:** qualquer engenheiro com acesso ao console Neon pode
   criar um **branch novo** para investigação, sem promover para produção.
3. **Promoção para produção:** exige autorização explícita do responsável Neon
   **e** confirmação de que validação em branch separada passou (seções abaixo).

Nunca baixe um dump de produção para laptop ou ambiente local não controlado.

## Retenção efetiva na V1

| O quê | Onde | Quanto | Expurgo |
| --- | --- | --- | --- |
| Histórico PITR (WAL) | Neon — **Instant restore** no branch root de produção | **≥ 7 dias** (`history_retention_seconds` ≥ 604800) | Automático após a janela configurada |
| Cópia lógica off-site (`pg_dump → R2/S3`) | **Não implementado** (T09 caminho B) | — | — |
| Portabilidade CSV `s11.v1` | Sob demanda do usuário autenticado | Sem retenção operacional | Arquivo no dispositivo do usuário |

**Checklist do operador (confirmar no `<NEON_CONSOLE>` antes de confiar no DR):**

1. Plano pago (Launch ou Scale) — Free limita histórico a 6 h.
2. PITR habilitado (janela &gt; 0).
3. Janela **≥ 7 dias** explicitamente configurada (padrão pago é 1 dia).
4. Branch de produção é **root branch**.
5. A Vercel **não** faz backup do PostgreSQL.

## RPO e RTO — alvos vs medidos

Alvos da V1 (ADR-014 T01):

| Métrica | Alvo |
| --- | --- |
| RPO | ≤ 24 h |
| RTO | ≤ 4 h (horário comercial) |

### Caminho 1 — Neon PITR (produção)

| Métrica | Medido / documentado | vs alvo |
| --- | --- | --- |
| **RPO** | Contínuo via WAL dentro da janela PITR (perda teórica ≈ segundos desde último WAL retido, não 24 h) | **Atende** com PITR habilitado |
| **RTO — restore do banco** | Documentação Neon: operação típica em **segundos** ([Instant restore](https://neon.com/docs/introduction/branch-restore)) | **Atende** o componente de banco |
| **RTO — verificação da app** | Medido localmente em 2026-09-03 contra banco restaurado (ver Caminho 2): `db:check` ~0,9 s + `GET /api/readiness` ~0,02 s + checagem sintética &lt; 1 s ≈ **~1 min** de trabalho operador (inclui migrations/status se necessário) | **Atende** com folga; gargalo é decisão humana e cutover, não o probe |

O RTO de produção real inclui: escolha do timestamp, restore Neon, apontar
`DATABASE_URL` de validação, migrations se o código deployado exigir, probes e
checagem sintética. Planeje **&lt; 1 h** para o caminho feliz; o alvo de 4 h
cobre coordenação e rollback de deploy.

### Caminho 2 — restore lógico local / não prod (drill)

Exercício em **2026-09-03** no banco `financas_gomes_restore_drill` → clone
`financas_gomes_restore_verify` (dados **sintéticos**, sem household real):

| Etapa | Duração medida |
| --- | --- |
| `pg_dump -Fc` (schema + 1 linha marcador) | **0,08 s** (~159 KiB) |
| Recriar banco destino + `pg_restore` | **0,25 s** |
| `npm run db:check` | **0,89 s** |
| `GET /api/readiness` (app local apontando ao restaurado) | **0,02 s** |
| Checagem sintética do marcador (SQL abaixo) | **&lt; 0,1 s** |
| **Total medido (dump + restore + verificação)** | **~1,2 s** |

| Métrica | Interpretação |
| --- | --- |
| **RPO (caminho lógico)** | Igual ao tempo desde o último `pg_dump` — no drill, zero (dump imediato). Em produção este caminho **não** é o DR primário. |
| **RTO (caminho lógico)** | **~1,2 s** no volume mínimo do drill — **limite inferior**; produção com mais dados será maior, mas o drill prova o procedimento. |

**Distância do alvo:** ambos os caminhos medidos ficam **abaixo** de RPO ≤ 24 h e
RTO ≤ 4 h. O risco residual é **processo** (operador não seguir o runbook), não
capacidade técnica do Neon no caminho 1.

---

## Caminho 1 — Restauração Neon PITR (produção)

Restaurar sempre em **branch novo** ou validar em branch separado **antes** de
qualquer sobrescrita do branch de produção.

### Pré-requisitos

- Acesso ao `<NEON_CONSOLE>` do projeto de produção.
- Commit/deploy alvo conhecido (para comparar migrations).
- `MIGRATION_DATABASE_URL` / `DATABASE_URL` de um ambiente de **validação**
  (branch restaurado), nunca logar URLs reais.
- Autorização registrada (ver acima).

### Passos

1. **Parar tráfego novo** (se o incidente estiver ativo): manter deployment
   anterior ou bloquear rota até validação — ver
   [production-deploy.md](production-deploy.md) (rollback).
2. No `<NEON_CONSOLE>`, identifique o **root branch** de produção e o timestamp
   alvo (RFC 3339) **antes** do evento danoso.
3. **Criar branch de restauração** a partir do PITR/instant restore para esse
   timestamp — **não** sobrescreva o root de produção neste passo.
4. Obtenha a connection string do branch restaurado; configure temporariamente
   `<DATABASE_URL>` de validação (runner CI protegido ou host operacional).
5. **Migrations:** no alvo restaurado, execute:
   ```bash
   MIGRATION_DATABASE_URL="<DATABASE_URL>" \
   DATABASE_URL="<DATABASE_URL>" \
   npm run db:migrate:status

   MIGRATION_DATABASE_URL="<DATABASE_URL>" \
   DATABASE_URL="<DATABASE_URL>" \
   npm run db:migrate:deploy
   ```
   Se houver pendências inesperadas, **pare** e investigue — não force DDL em
   produção sem entender o drift.
6. **`db:check`:**
   ```bash
   MIGRATION_DATABASE_URL="<DATABASE_URL>" \
   DATABASE_URL="<DATABASE_URL>" \
   npm run db:check
   ```
   Deve terminar com 0 pendências e 0 divergentes.
7. **Readiness:** com a app apontando ao branch restaurado (deploy de
   validação ou variável temporária):
   ```bash
   curl --fail --show-error --silent "https://<dominio-validacao>/api/readiness"
   ```
   Esperado: HTTP 200, `status=ok`, `database=ok`, `schema=ok`. Detalhes em
   [health.md](health.md).
8. **Checagem de consistência sintética** — use fixture conhecida ou marcador de
   drill, **nunca** inspecione household real de cliente:
   ```sql
   -- Exemplo: marcador de exercício (ajuste o correlation_id ao seu caso)
   SELECT status, execution_id
   FROM job_executions
   WHERE correlation_id = 'T13-DRILL-2026-09-03';
   ```
   Para fixtures com lançamentos sintéticos, reconcilie totais esperados (ex.:
   soma de `amount_cents` de eventos de teste) contra valores documentados no
   cenário de fixture.
9. **Promoção (somente com autorização):** se a validação passou, planeje o
   cutover: atualizar `DATABASE_URL` de produção no Vercel para o branch
   validado **ou** executar instant restore no root com o timestamp aprovado,
   seguido de novo ciclo dos passos 5–8. Registre horário de início/fim para RTO.
10. Reabra tráfego; monitore Sentry e readiness por pelo menos 15 minutos.

### Se um passo falhar (Caminho 1)

| Falha | Ação |
| --- | --- |
| Timestamp fora da janela PITR | Escalar; avaliar export CSV `s11.v1` por usuário (portabilidade, não DR completo); reabrir decisão T02 |
| `db:migrate:status` com drift | Não promover; comparar commit vs migrations; restaurar outro timestamp ou corrigir com migration forward-only em branch de teste |
| `db:check` com pendências | Aplicar `db:migrate:deploy` em validação; se persistir, abortar promoção |
| Readiness 503 | Verificar `<DATABASE_URL>`, conectividade e se migrations completaram |
| Checagem sintética falhou | Tratar restore como inválido; tentar outro timestamp ou branch |
| Promoção indevida | Parar tráfego; restaurar novamente; post-mortem |

---

## Caminho 2 — Restore lógico local / não prod (drill)

Prova o procedimento `pg_dump` / `pg_restore` com **dados sintéticos** em banco
descartável. Serve para treino e validação de ferramentas; **não** substitui o
PITR Neon em produção.

### Pré-requisitos

- PostgreSQL 16 local ou em runner controlado.
- Banco fonte **não produtivo** já migrado (ex.: `financas_gomes_restore_drill`).
- `pg_dump`, `pg_restore` e `psql` instalados.
- **Proibido:** URL de produção, dados de household real.

### Passos (executados no drill 2026-09-03)

1. **Inserir marcador sintético** (sem FK de tenancy):
   ```sql
   INSERT INTO job_executions (
     id, job_name, logical_window, execution_id,
     attempt, status, started_at, finished_at, correlation_id
   ) VALUES (
     gen_random_uuid(),
     's11.job.heartbeat',
     '2099-09-03',
     't13-drill-marker-2026-09-03',
     1,
     'SUCCEEDED',
     now(),
     now(),
     'T13-DRILL-2026-09-03'
   )
   ON CONFLICT (job_name, logical_window) DO UPDATE
     SET execution_id = EXCLUDED.execution_id,
         correlation_id = EXCLUDED.correlation_id,
         status = EXCLUDED.status,
         finished_at = EXCLUDED.finished_at;
   ```
2. **Dump lógico:**
   ```bash
   pg_dump -Fc --no-owner --no-acl \
     -f /tmp/financas-drill.dump \
     "<DATABASE_URL>"
   ```
   Use `<DATABASE_URL>` do banco **drill**, não de produção.
3. **Recriar banco destino** — `DROP DATABASE` **não** pode rodar dentro de
   transação; use comandos separados:
   ```bash
   psql "postgresql://<host>:<port>/postgres" -c \
     "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'financas_gomes_restore_verify' AND pid <> pg_backend_pid();"
   psql "postgresql://<host>:<port>/postgres" -c \
     "DROP DATABASE IF EXISTS financas_gomes_restore_verify;"
   psql "postgresql://<host>:<port>/postgres" -c \
     "CREATE DATABASE financas_gomes_restore_verify;"
   ```
4. **Restore:**
   ```bash
   pg_restore --no-owner --no-acl \
     -d "<DATABASE_URL_RESTORE_VERIFY>" \
     /tmp/financas-drill.dump
   ```
5. **Verificar migrations:**
   ```bash
   DATABASE_URL="<DATABASE_URL_RESTORE_VERIFY>" \
   MIGRATION_DATABASE_URL="<DATABASE_URL_RESTORE_VERIFY>" \
   npm run db:check
   ```
6. **Readiness** (app local apontando ao banco restaurado):
   ```bash
   curl --fail --show-error --silent http://127.0.0.1:<porta>/api/readiness
   ```
7. **Confirmar marcador:**
   ```sql
   SELECT job_name, logical_window, execution_id, correlation_id, status
   FROM job_executions
   WHERE correlation_id = 'T13-DRILL-2026-09-03';
   ```
   Esperado: 1 linha, `status = SUCCEEDED`.

### Se um passo falhar (Caminho 2)

| Falha | Ação |
| --- | --- |
| `pg_dump` erro de conexão | Verificar `<DATABASE_URL>` e se o banco está up |
| `DROP DATABASE` em transação | Executar cada DDL em `psql -c` separado |
| `pg_restore` erro de owner/ACL | Usar `--no-owner --no-acl` |
| `db:check` pendências | Rodar `npm run db:migrate:deploy` no banco restaurado |
| Marcador ausente | Repetir dump **após** inserir marcador; não use dump antigo |

---

## Registro do drill (evidência)

| Campo | Valor |
| --- | --- |
| Data | 2026-09-03 |
| Ambiente | PostgreSQL 16 local, `financas_gomes_restore_drill` → `financas_gomes_restore_verify` |
| Marcador | `job_executions.correlation_id = T13-DRILL-2026-09-03` |
| Marcador verificado pós-restore | **Sim** |
| Falhas | `DROP DATABASE` falhou quando agrupado em um único script transacional — corrigido no runbook (comandos separados) |
| Durações | dump 0,08 s · restore 0,25 s · db:check 0,89 s · readiness 0,02 s |

## Evolução (fora da V1)

- DR multi-região
- Automação de restore
- Ensaio agendado
- Backup lógico externo `pg_dump → R2/S3` (gatilhos em [S11-backup-audit.md](S11-backup-audit.md))
