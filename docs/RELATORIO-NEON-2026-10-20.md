# Entrega Neon — 20/10/2026

## Resultado

Postgres, Neon Auth e a API Neon Functions foram configurados no projeto `holy-snow-61907956`, organização `org-polished-pine-59901844`, branch `production`, região `aws-us-east-2`. A função `hello` está com implantação ativa `2`, status `completed`, runtime `nodejs24`.

API: `https://br-lingering-bonus-b4ixzdjv-hello.compute.c-6.us-east-2.aws.neon.tech/`. A raiz é protegida; o catálogo público é `/api/state`. Endpoints privados exigem um JWT válido e as permissões do atendimento.

A aplicação foi iniciada em http://127.0.0.1:4189/ com o frontend conectado à produção. O envio ao GitHub foi autorizado pelo responsável em 20/10/2026, após a revisão local. O deploy Neon publica os serviços de backend; a publicação do frontend Netlify é verificada separadamente.

## Alterações

- CLI `neon@8.8.0` instalado globalmente e autenticado pelo navegador.
- `neon init` vinculou o projeto indicado, instalou o plugin Neon para Codex, suas skills e configuração MCP OAuth. O arquivo MCP do plugin aponta para `https://mcp.neon.tech/mcp`, sem API key no repositório.
- `neon.ts` declara Auth, API e o trigger `mvp-retention`, horário UTC `0 * * * *`.
- Migração SQL empacotável em `database/schema.mjs`; aplicação validada numa branch isolada antes de produção, usando conexão direta. API usa `pg.Pool` persistente, `attachDatabasePool` e conexão pooled.
- Neon Auth integrado ao cadastro/login, sessão, logout e solicitação de recuperação. A interface oferece confirmação de email por código. Vinculação de especialista é administrativa, por ID de identidade com email verificado; o cadastro público gera somente clientes.
- API verifica JWT contra o JWKS do provedor e mantém as regras anteriores de capacidade, autorização, proposta, comprovantes e encerramento. Origem CORS fica restrita aos domínios configurados.
- Build inclui somente URLs públicas. Os valores de `DATABASE_URL` e `DATABASE_URL_UNPOOLED` não foram encontrados no build. `.env.local`, `.env.neon-test`, `.neon` e artefatos com credenciais fictícias estão ignorados pelo Git.
- CSP do Netlify preservada, permitindo apenas os hosts exatos dos serviços necessários. Não foi removida a política de segurança.

## Saídas que comprovam os testes

Comandos executados na raiz do projeto:

```text
npm run build
Build Neon gerado em dist/. Auth e API conectados por URLs públicas; segredos não são incluídos.

npm start
MVP Soluções + Neon: http://127.0.0.1:4189/

npm test
tests 69
pass 69
fail 0
```

O teste remoto `npm run test:neon` executou chamadas reais aos serviços implantados em `mvp-neon-validation`:

```text
PASS Neon Auth: signup and persistent provider sessions
PASS Function: rejects anonymous/forged credentials and foreign origins; CORS preflight works
PASS Postgres + Function: independent client/specialist sessions share the private ticket and chat; outsider blocked
PASS End-to-end: proposal, approval, receipt upload/download, completion and rating persisted in PostgreSQL
PASS Neon Auth: logout and fresh sign-in restore the persisted ticket
PASS Retention endpoint rejects fabricated trigger requests
```

O teste da interface `node scripts/neon-browser-test.mjs`, em contextos separados do Edge, retornou:

```text
PASS Browser: Neon SDK login, independent client/specialist sessions, ticket, chat, reload, cancellation and logout.
```

Depois do deploy em `production`, foi executado `node --env-file=.env.local scripts/neon-production-smoke.mjs`:

```text
PASS production: Postgres persistence, Neon Auth signup/login/logout, JWT-protected Function and Netlify forwarding code.
PASS production: requests outside business hours are rejected.
```

A verificação ocorreu fora do expediente e confirmou a recusa esperada de novos chamados. A abertura, negociação e conclusão foram testadas na branch isolada com expediente simulado de 10h. A produção foi verificada com `simulatedHour: null`; o relógio real foi preservado.

`npm run check`, `git diff --check` e `npm ci --dry-run --ignore-scripts` passaram. O último confere o lockfile sem reinstalar dependências.

Evidências locais, ignoradas pelo Git: `artifacts/neon-e2e-results.json`, `artifacts/neon-browser-results.json`, `artifacts/neon-production-results.json` e `artifacts/neon-browser-preview.png`. Os arquivos de acesso fictício ficam também em `artifacts/`; suas senhas não fazem parte deste relatório.

## Falhas encontradas e tratamento

1. **PowerShell interpretou a lista de serviços sem aspas como argumentos diferentes.** A inicialização foi repetida com `--services 'postgres,auth,functions'` e concluída.
2. **Não havia sessão autenticada do CLI.** `neon login` abriu o navegador e a autenticação foi concluída. Nenhum projeto substituto foi criado.
3. **Origem local não autorizada pelo Auth.** Foram cadastradas explicitamente `http://127.0.0.1:4189` e a origem do Netlify, nas branches usadas. As proteções de origem foram mantidas.
4. **SDK `@neondatabase/auth@0.6.0-beta` retornava sessão em cache ao solicitar `/token`.** O código instalado agrupa os caminhos de sessão e token no mesmo cache. A chamada do SDK com `X-Force-Fetch` retorna o JWT correto. O aplicativo usa essa chamada, mantém o token somente em memória e o renova antes do vencimento. O servidor continua validando assinatura, emissor e expiração. O teste completo no navegador passou após a correção.
5. **Deploy concluído ainda podia servir a versão anterior por alguns instantes.** Foi confirmada a implantação ativa antes de aceitar a configuração do teste. O bloqueio de horário anterior foi mantido em produção.
6. **`neon skills update -y` falhou no Windows ao procurar skills locais inexistentes, com erro de fechamento de handle.** As skills usadas estavam instaladas pelo plugin global, com atualização administrada pelo plugin; isso não bloqueou a configuração nem os testes.
7. **O npm emitiu avisos de dependências peer transitivas do SDK.** A instalação e o teste de reprodutibilidade terminaram com sucesso. A instalação informou zero vulnerabilidades. O SDK e os fluxos efetivamente usados foram testados; o projeto mantém o lockfile.
8. **Uma tentativa de remover a CSP foi rejeitada pela revisão automática.** A alternativa aplicada preserva a política e permite somente os endereços exatos necessários. Não há pedido pendente para enfraquecer essa proteção.
9. **Variáveis de `netlify.toml` não ficam disponíveis nas funções em runtime.** O encaminhamento reconhece o ambiente Netlify por `SITE_ID` e utiliza as URLs públicas deste projeto, sem exigir credenciais de banco no Netlify. Um teste adicional reproduz a ausência das variáveis e confirma que a API encaminha corretamente e a retenção não é duplicada. A suíte final passou com 69 testes. Referência: [variáveis em Netlify Functions](https://docs.netlify.com/build/functions/environment-variables/).

## Limites de verificação e próximas ações

- O MCP foi instalado/configurado pelo plugin, mas suas ferramentas não ficaram disponíveis nesta sessão já aberta. A autenticação OAuth e uma chamada MCP de ponta a ponta não foram comprovadas; recarregue o agente e autorize o MCP quando solicitado. O CLI autenticado foi usado para todas as operações remotas desta entrega.
- Cadastro, login, sessão e logout do Auth foram comprovados. Entrega de email, recebimento de OTP, recuperação por caixa postal real e OAuth social não foram testados. Nenhuma verificação de email fictício foi fabricada em produção.
- O trigger de retenção está habilitado e seu endpoint rejeita chamadas fabricadas. Não foi aguardada uma nova execução horária para comprovar a entrega automática do cron. A limpeza e a retenção são cobertas pelos testes de persistência e domínio.
- Um JWT já emitido pode continuar válido até seu vencimento mesmo após sair; o frontend encerra a sessão no provedor e remove suas referências locais. Não foi implementada revogação instantânea de todo JWT já copiado.
- As contas de teste com papel profissional foram criadas apenas na branch de validação. Para a equipe real, cada titular precisa criar/verificar sua conta, e o responsável deve vincular seu ID ao perfil correto. O guia contém o comando administrativo.
- O responsável autorizou o envio do código ao GitHub. Os testes de código acima não substituem a confirmação posterior do deploy efetivamente publicado pelo Netlify.

Guia operacional: [CONFIGURACAO-NEON.md](CONFIGURACAO-NEON.md).
