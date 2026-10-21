# Análise do MVP para produção

**Data:** 21/10/2026
**Escopo:** repositório completo (85 arquivos versionados, 78 testes passando em ~56s)
**Contexto:** três implementações de API paralelas — SQLite local (`server.mjs`), Postgres/Netlify (`lib/shared-api.mjs`), Neon Functions (`lib/neon-api.mjs`).

---

## 1. Bloqueadores de segurança

Corrigir antes de qualquer tráfego real.

### 1.1 Contas de teste ativas em produção com senha `123`

`neon.ts:10` → `TEST_LOGIN_ENABLED: "1"` está no deploy. `public/domain.js:19` → `DEMO_PASSWORD = '123'`, e `DEMO_USERS` (`domain.js:8-18`) está **no bundle do browser**. `loginPage()` em `public/app.js:195` ainda renderiza uma tabela com todos os logins.

Consequência: qualquer pessoa entra como `bruno`, `tayane`, `kleber` etc. e lê tickets, mensagens e anexos de clientes reais. A mitigação existente (`postgres-store.mjs:128`, Proxy que zera `admin`) só cobre admin — não cobre leitura de dados de outros usuários.

**Ação:** `TEST_LOGIN_ENABLED: "0"`; remover `DEMO_USERS`/`DEMO_PASSWORD` do bundle público; remover o seeding de demo de `normalizeState` (`domain.js:28-40`) do caminho de produção.

### 1.2 Dependência beta em produção

`package.json:29` → `"@neondatabase/auth": "^0.6.0-beta"`. `neon-client.js:58-60` já contorna um bug conhecido do SDK (`X-Force-Fetch`). Beta + `^` = quebra silenciosa em deploy.

**Ação:** pinar versão exata (`0.6.0-beta.X`), sem `^`, em todas as dependências. Adicionar `npm audit` ao CI.

### 1.3 Rate limit do `server.mjs` é contornável e não distribuído

`server.mjs:33` → chave = `req.socket.remoteAddress`. Atrás de proxy/CDN, todos os usuários colapsam num IP só (DoS mútuo); sem proxy, rotação de IP burla. É um `Map` em memória, morre no restart.

`shared-api.mjs:42` usa `context.ip` do Netlify (melhor) e persiste em `mvp_rate_limits` (melhor ainda). O caminho local diverge.

### 1.4 `scryptSync` bloqueia o event loop

`server.mjs:79,92,104` e `shared-api.mjs:8,63`. Síncrono, ~60-150 ms por chamada com N padrão. Em Neon Function / Netlify (single-threaded), 10 logins simultâneos = 1,5 s de bloqueio total, inclusive para requisições não relacionadas. Vira vetor de DoS barato — o throttle de login é 10/min por IP, mas custa CPU antes de qualquer defesa.

**Ação:** `crypto.scrypt` assíncrono (promisify) ou delegar 100% ao Neon Auth e remover o caminho de senha local.

### 1.5 CSRF derivado, não aleatório

`neon-api.mjs:82` → `csrf: digest('neon:' + identity.sub)`. Valor estável e derivável do `sub`. Hoje é inofensivo (auth é Bearer, não cookie — CSRF não se aplica), mas o cliente trata como token. Gerar aleatório por sessão, ou remover o campo para não dar falsa sensação de proteção.

---

## 2. Bloqueador de arquitetura

### 2.1 Estado inteiro da aplicação em UMA linha JSONB

`database/schema.mjs:3` → `mvp_state (id INTEGER PRIMARY KEY CHECK(id=1), content JSONB)`.

É o ponto mais grave para "virar projeto real". Efeitos encadeados:

- **Escritas globalmente serializadas.** `postgres-store.mjs:25` → `SELECT content FROM mvp_state WHERE id=1 FOR UPDATE`. Duas pessoas em chamados totalmente diferentes bloqueiam uma à outra. Throughput de escrita ≈ 1 operação por vez, para sempre.
- **Anexos dentro do blob.** `domain.js:119` → `data: payload.data` (base64, até 2 MB). `act` → `appendFile` grava o arquivo dentro do JSON. Limite de 15 anexos comuns por thread (`domain.js:118`) + comprovantes ilimitados. 20 chamados com anexos = linha de ~600 MB reescrita *por mensagem enviada*.
- **Leitura total por requisição.** `postgres-store.mjs:36` `read()` desserializa tudo. `shared-api.mjs:47` e `neon-api.mjs:74` chamam em todo request. Em `neon-api.mjs:78-81` chama `read()` **duas vezes** no mesmo request (antes e depois do `cleanup`).
- **Custo quadrático no `projectState`.** `domain.js:187` mapeia todos os profissionais → `publicUser` → `activeCount` (`domain.js:135`), que varre `state.tickets` inteiro. 9 profissionais × N tickets, toda requisição. Idem `professionalCapacity`.
- **Egress.** Cada `/api/state` puxa o blob completo do Postgres para a Function.

**Ação (caminho mínimo, nesta ordem):**

1. Anexos para Neon Object Storage; guardar só `{id, name, type, size, key}` no banco. Resolve ~90% do problema sozinho e é a mudança mais barata.
2. Extrair `tickets`, `threads`, `messages`, `notifications`, `audit` para tabelas reais com FK e índices. `users` pode ficar por último.
3. Só então remover o `FOR UPDATE` global.

---

## 3. Bugs concretos

| # | Local | Problema |
|---|---|---|
| 1 | `server.mjs:78` vs `:80` | Checagem de e-mail duplicado roda no `state` carregado na linha 71, **fora** da transação; o `transact` recarrega. Cadastro concorrente passa pelas duas checagens, bate no `UNIQUE` de `accounts.email` e retorna **500** em vez de 409. `shared-api.mjs:100` trata `23505` → 409; `server.mjs` não trata. |
| 2 | `domain.js:136` | `contactEmail` testa `user.email?.endsWith('@example.test')`, mas `DEMO_USERS` (linha 18) agora geram `@teste.com`. Condição morta — sobra de migração anterior. |
| 3 | `domain.js:373` vs `:384` | `appointment` só pode ser criado pelo profissional (`:363` `requireThat(pro ...)`), logo o ternário `client ? ticket.professionalId : ticket.clientId` em `:373` nunca cai no segundo ramo. Em `:384` (`appointmentDecision`) notifica sempre `ticket.professionalId`, mesmo se quem decidiu foi ele. Inconsistente com o resto. |
| 4 | `domain.js:223` | `code: MVP-${state.tickets.length + 1}` com `state.tickets.unshift()`. Tickets hoje nunca são removidos, então funciona por acidente. Qualquer exclusão futura (LGPD, por exemplo) gera códigos duplicados. Usar contador persistido ou sequence. |
| 5 | `neon-api.mjs:78-81` | `store.read()` chamado em `:74` e de novo em `:81`, com `store.cleanup()` (que faz outro `read()` interno, `postgres-store.mjs:133`) entre os dois. Três leituras do blob completo por `GET /api/state`. |
| 6 | `postgres-store.mjs:132-137` | `cleanup()` roda em **toda** requisição (`shared-api.mjs:44`, `neon-api.mjs:78`): 1 read completo + 3 `DELETE`. Deveria ser só o trigger de retenção (`neon.ts:17`, cron horário — que já existe). |
| 7 | `live-events.mjs:64` | Limite de 5 SSE por usuário é contado **por processo**. Neon Functions escala horizontalmente → limite real = 5 × nº de instâncias. |
| 8 | `netlify/functions/api.mjs:20` | `catch {}` sem variável converte qualquer falha em 503 genérico e **descarta o erro** — sem log, sem stack. Debug de produção fica cego. |
| 9 | `server.mjs:147-149` | `console.error(error)` com objeto Error completo, mas só quando `!error.status`. Sem request id, sem correlação. |
| 10 | `README.md` | Diz porta **4173**; `neon.ts:8` e os scripts usam **4189**. Documentação desatualizada. |

---

## 4. Saúde do código

### 4.1 Três implementações da mesma API

`server.mjs` (SQLite, 163 linhas) + `lib/shared-api.mjs` (Postgres/Netlify, 105) + `lib/neon-api.mjs` (Neon Auth, 104). Lógica de `body()`, sessão, throttle, CSRF e `/files/` duplicada nas três — com divergências reais (recuperação de senha funciona em uma, 503 na outra, Neon Auth na terceira).

Custo: toda correção de segurança precisa de 3 edições. O item 1.3 já é exemplo disso.

**Ação:** eleger **Neon Functions** como alvo único. `server.mjs` vira só servidor estático de dev + proxy. Deletar `shared-api.mjs` e `netlify/functions/`.

### 4.2 Scripts de auditoria descartáveis

`scripts/` tem 24 arquivos: `browser-test`, `ti-browser-audit`, `ti-draft-browser-audit`, `legal-browser-audit`, `fixes-browser-test`, `negotiation-browser-test`, `profile-browser-test`, `account-browser-test`, `shared-browser-test`, `static-browser-test`, `neon-browser-test`, `test-login-browser`, `test-login-remote`, `privacy-audit`, `security-audit`, `ti-audit`, `ti-corrections-browser-test` etc. Nenhum roda no `npm test`. São registros de sessões passadas, não ferramentas.

Idem `docs/`: 10 relatórios datados (`AUDITORIA-*-2026-10-19.md`, `CORRECOES-*`, `RELATORIO-*`). Histórico, não documentação.

**Ação:** mover para `archive/` ou deletar (o git guarda). Manter só `CONFIGURACAO-NEON.md` e `BANCO-COMPARTILHADO.md`.

### 4.3 `npm run check` é uma lista manual

`package.json:23` — 22 `node --check` encadeados à mão. Esquece arquivo novo silenciosamente. Não valida tipos, não valida estilo, não pega variável não usada.

**Ação:** `node --check $(git ls-files '*.mjs' '*.js')` ou, melhor, adotar um linter. Zero dependências novas se usar só `node --check` dinâmico.

### 4.4 Suíte de testes lenta

56 s no total, concentrados em 3 testes: Postgres 39 s, Neon 22 s, test-login 15 s + 5 s + 4 s. Cada um sobe uma instância PGlite/Postgres embarcada própria. Já no limite do tolerável em CI; dobrar os testes dobra o tempo.

**Ação:** compartilhar uma instância PGlite entre arquivos de teste via setup único.

### 4.5 `node:sqlite` é experimental

`server.mjs:2` → `DatabaseSync` do Node 24. API ainda instável entre minors. Só importa se `server.mjs` sobreviver ao item 4.1.

---

## 5. Faltando para "projeto real"

| Área | Situação | Mínimo necessário |
|---|---|---|
| **E-mail** | Inexistente. `shared-api.mjs:69` e `server.mjs:99` admitem "nenhuma mensagem externa foi enviada". Recuperação de senha não funciona fora do demo. | Provider transacional (Resend/SES) + verificação de e-mail + reset real. |
| **Pagamento** | Fora de escopo por decisão de produto — cliente anexa comprovante, profissional confere (`domain.js:345-352`). | Documentar como decisão explícita nos Termos. Se mudar: PSP + conciliação. |
| **LGPD** | Retenção de 30 dias implementada (`domain.js:168-178`), mas **só para threads**. Não há exportação de dados, nem exclusão de conta, nem registro de consentimento versionado. `termsAcceptedAt` existe (`server.mjs:80`) mas não guarda qual versão dos termos. | Endpoints de export/delete + versionar termos + base legal documentada. |
| **Observabilidade** | `console.error` solto. Sem métricas, sem tracing, sem alerta. O item 3.8 descarta erros. | Logs estruturados em JSON + Grafana/Loki (já disponível no stack Neon). |
| **Backup / restore** | Nada documentado. Com estado monolítico (item 2.1), uma escrita corrompida derruba 100% dos dados. | Neon instant restore + teste de restore documentado. |
| **Multi-região / capacidade** | `domain.js:220` hardcoda `['PE','Belem']`; `:142` hardcoda `['PE','PA']` — **inconsistentes entre si**. Capacidade fixa em 2 ou 3 (`:149`). | Tabela de regiões/serviços em vez de literais no código. |
| **Verificação profissional** | `expertCard` admite "Qualificações e registros profissionais ainda não foram verificados". Advocacia exige OAB; engenharia exige CREA. | Validação de registro antes de qualquer atendimento pago. Risco regulatório, não só técnico. |
| **CI** | `test.yml` roda só em `pull_request`. `pages.yml` roda em push para main. Sem lint, sem audit, sem cobertura. | Unificar; adicionar `npm audit --audit-level=high`. |
| **Versionamento** | `package.json:3` → `0.1.0`, imutável em 9 commits. Sem CHANGELOG, sem tags. | SemVer + tag por release. |
| **Licença** | Ausente. | `LICENSE` (ou `"private": true` já cobre, se nunca publicar). |

---

## 6. Ordem sugerida

### Fase 0 — antes de qualquer usuário real (dias)

1. `TEST_LOGIN_ENABLED=0`; remover `DEMO_USERS`/`DEMO_PASSWORD` do bundle e do seed de produção. *(1.1)*
2. Pinar versões exatas; sair do `@neondatabase/auth` beta ou aceitar formalmente o risco. *(1.2)*
3. Logar o erro em `netlify/functions/api.mjs:20`. *(3.8)*

### Fase 1 — fundação (1-2 semanas)

4. Anexos → Neon Object Storage. Maior ganho por esforço. *(2.1.1)*
5. Escolher Neon Functions como runtime único; deletar `shared-api.mjs` + `netlify/functions/`. *(4.1)*
6. `scrypt` assíncrono, ou delegar senhas inteiramente ao Neon Auth. *(1.4)*
7. `cleanup()` só no cron, fora do caminho de request. *(3.6)*

### Fase 2 — modelo de dados (2-4 semanas)

8. `tickets` / `threads` / `messages` / `notifications` em tabelas próprias, com índices. *(2.1.2-3)*
9. Corrigir bugs 1-5 durante a migração — a maioria some junto com o blob.

### Fase 3 — operação

10. E-mail transacional + recuperação de senha real.
11. Logs estruturados + alertas.
12. Export/delete LGPD + termos versionados.
13. Verificação OAB/CREA.
14. Limpeza de `scripts/` e `docs/`. *(4.2)*
