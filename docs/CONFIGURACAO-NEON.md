# Neon — MVP Soluções

## Arquitetura

O frontend continua sendo hospedado no Netlify. O Neon hospeda o banco Lakebase Postgres, o login gerenciado e a API. `neon.ts` declara os serviços e o gatilho de retenção. A função manteve o identificador `hello`, criado pelo CLI; o rótulo no arquivo é **MVP Soluções API**, com código em `functions/mvpapi.mjs`.

- Organização: `org-polished-pine-59901844`.
- Projeto: `holy-snow-61907956`.
- Região confirmada: `aws-us-east-2`.
- Branch de operação: `production`.
- Branch isolada de validação: `mvp-neon-validation`, com expiração automática de sete dias.

`DATABASE_URL` pooled é utilizada pela API com um `pg.Pool` duradouro, conectado a `attachDatabasePool`. Migrações usam a conexão direta `DATABASE_URL_UNPOOLED`. O esquema em `database/schema.mjs` é importado no bundle da função; a API não depende de um arquivo SQL externo no runtime. O domínio continua em JSONB e suas alterações são protegidas por transação e bloqueio da linha de estado; identidades possuem tabela própria.

O navegador usa o SDK oficial `@neondatabase/auth`, com email/senha, sessão e tokens do Neon Auth. A API valida assinatura EdDSA, emissor e expiração contra `NEON_AUTH_JWKS_URL` e aplica as permissões existentes dos chamados. Um token válido nunca concede automaticamente papel de especialista ou administrador. Há uma rota pública de catálogo em `/api/state`; chats e anexos exigem autenticação e vínculo com o atendimento.

## Executar localmente

```powershell
npm ci
npm run build
npm start
```

Com as variáveis do Neon em `.env.local`, a prévia fica em http://127.0.0.1:4189/. O build inclui somente as URLs públicas de Auth e Functions. Credenciais de banco ficam no servidor e nos arquivos `.env*`, ignorados pelo Git. Na ausência de configuração Neon, o servidor SQLite e a demonstração estática continuam disponíveis para os testes anteriores.

```powershell
npm run build:static
```

Esse comando gera explicitamente a demonstração sem backend. Após utilizá-lo, execute `npm run build` para voltar à prévia Neon.

## Atualizações do chat

A API oferece `GET /api/events`, uma conexão SSE autenticada pelo mesmo token usado nas outras rotas. Uma alteração confirmada em `mvp_state.content` dispara `NOTIFY mvp_state_updates`; cada processo da Function mantém uma conexão PostgreSQL direta em `LISTEN` compartilhada pelos seus navegadores conectados. A notificação contém apenas um aviso vazio. O navegador busca os dados pela rota `/api/state`, que continua filtrando o conteúdo pelo participante autorizado.

`neon.ts` encaminha a variável privada `DATABASE_URL_UNPOOLED` para `LIVE_DATABASE_URL` no ambiente da Function. Não use uma conexão pooled para `LISTEN`. Essa credencial nunca entra no bundle do navegador. A migração `npm run db:init` cria o trigger; execute-a antes de publicar a API, sempre após validar em uma branch isolada. Sem a variável do listener, o backend anuncia que SSE está indisponível e o frontend mantém sincronização periódica.

O cliente reconecta automaticamente após falhas, ressincroniza ao recuperar a conexão e mantém uma verificação a cada 30 segundos enquanto o canal está conectado. Durante desconexões ou com backends antigos, verifica em aproximadamente três segundos. Digitar, abrir o menu ou manter um anexo selecionado não bloqueia a atualização. O modo estático continua limitado ao armazenamento do próprio navegador.

Cada stream tem duração máxima de cinco minutos para renovar a autenticação; a sessão é verificada também a cada heartbeat de 15 segundos. Há limite de conexões por usuário e de tentativas de abertura. Logout interrompe o stream do navegador. A conexão direta é encerrada quando o processo fica sem assinantes.

O relatório [CHAT-TEMPO-REAL-2026-10-20.md](CHAT-TEMPO-REAL-2026-10-20.md) registra os testes e o procedimento de reprodução.

## Cadastros e especialistas

Os usuários existentes entram sem informar e-mail pelo login `user`, `tayane`, `miguel`, `feuzer`, `marcos`, `maria`, `bruno`, `stefanny` ou `kleber` e senha `123`, quando o modo temporário está habilitado na API. Tayane atua em **Direito criminal** e Miguel como **Advogado geral**, com encaminhamento por serviço correspondente. A migração atualiza os perfis demonstrativos antigos sem transferir ou apagar atendimentos já assumidos.

Clientes usam **Criar conta** e entram com seu email e senha, de 10 a 128 caracteres. As credenciais do Neon Auth continuam individuais. O acesso temporário descrito abaixo é separado do provedor e não altera essas senhas.

### Acesso temporário solicitado para os testes

`neon.ts` configura `TEST_LOGIN_ENABLED: "1"` para habilitar o login por nome ou e-mail de teste e senha **123**: `user`, `tayane`, `miguel`, `feuzer`, `marcos`, `maria`, `bruno`, `stefanny` e `kleber`. Cada perfil demonstrativo recebe `nome@teste.com`, por exemplo `user@teste.com` e `bruno@teste.com`. O formulário aceita texto e apresenta uma lista recolhível dos acessos quando o servidor confirma que esse modo está ativo. Maiúsculas e espaços externos são normalizados; nome e e-mail compartilham o mesmo limite de tentativas.

Os endereços são identificadores fictícios, sem caixas de entrada criadas ou verificadas. Não há envio de mensagens para validar esse acesso temporário. E-mails demonstrativos antigos em `example.test` são migrados; endereços personalizados e cadastros fora da lista são preservados. A senha `123` com um desses aliases usa a sessão de teste; outros e-mails e senhas reais continuam no Neon Auth.

Somente os perfis demonstrativos predefinidos aceitam esse acesso. Cadastros comuns não recebem essa senha. Vincular um perfil a uma identidade real do Neon bloqueia seu acesso pela senha pública, inclusive em sessões temporárias já abertas. Especialistas suspensos também são bloqueados. Bruno entra como especialista, sem o painel administrativo; sua identidade Neon verificada mantém as permissões originais.

O servidor gera sessões aleatórias de oito horas e grava somente seus hashes em `mvp_test_sessions`. O navegador mantém o token na aba (`sessionStorage`), permitindo recarregar a página. Sair revoga a sessão no banco e não restaura silenciosamente uma conta Neon que estivesse aberta antes. Mensagens e arquivos continuam sujeitos às permissões do atendimento. As contas são compartilhadas: qualquer pessoa que conheça um desses logins e a senha poderá ver os dados daquele perfil. Utilize somente dados fictícios.

Para desativar o acesso por nome, altere `TEST_LOGIN_ENABLED` para `"0"` em `neon.ts` e publique a API. As sessões temporárias deixam de ser aceitas imediatamente no novo deployment; email/senha pelo Neon Auth continua funcionando. Antes de publicar essa alteração pela primeira vez, execute a migração `npm run db:init` para criar `mvp_test_sessions`, após validá-la em uma branch de teste.

Prévia local isolada, com o mesmo handler e PostgreSQL embarcado persistente em `data/test-login-preview`, sem conexão ao banco remoto:

```powershell
npm run preview:test-login
```

Abra http://127.0.0.1:4190/#/entrar. Nessa prévia somente o acesso demonstrativo está disponível e o horário de abertura é simulado como 10h. O build normal continua apontando para os endpoints do Neon; o comando de prévia gera seu bundle apenas em `artifacts/test-login-preview`, fora do Git. Não execute `neon deploy` nem `git push` até a autorização específica para publicação.

Para ativar cada especialista:

1. O titular cria a própria conta pela interface e confirma seu email em **Confirmar meu e-mail**, usando o código enviado pelo Neon Auth.
2. O administrador confere a identidade e obtém o ID da conta no painel Auth do projeto. Não escolha o ID de outro titular.
3. No computador do responsável, com `.env.local` da branch `production`:

```powershell
npm run db:neon-specialist -- bruno ID-DA-CONTA-NEON
```

Repita com `tayane`, `miguel`, `feuzer`, `marcos`, `maria`, `stefanny` e `kleber`, cada qual com seu próprio ID verificado. A vinculação é feita por identificador do provedor, não por coincidência de email. Contas que já tenham atendimentos como cliente exigem uma conta profissional separada. O perfil Bruno conserva a administração do MVP. Qualificações profissionais continuam dependendo da validação operacional da equipe.

As senhas scrypt de contas locais e os cadastros fictícios do navegador não são importados automaticamente para o Neon Auth. A senha é cadastrada no provedor; o MVP não precisa conhecê-la para vincular um especialista.

## Atualizar os serviços

```powershell
neon checkout production
neon config plan
npm run db:init
neon deploy --env .env.local
npm run build
```

O CLI instalado é `neon@8.8.0`. Em PowerShell, passe listas com vírgulas entre aspas: `--services 'postgres,auth,functions'`. `neon deploy` atualiza os serviços e baixa as variáveis da branch corrente em `.env.local`; verifique a branch antes de executá-lo. Aguarde a implantação ficar ativa antes de testar alterações recém-publicadas.

Não execute migrações novas diretamente em `production` sem validá-las primeiro em uma branch. A implantação inicial foi testada em `mvp-neon-validation`. O teste remoto `npm run test:neon` só roda fora de `production`, para preservar esse isolamento.

## Hospedagem Netlify

`netlify.toml` contém as duas URLs públicas de produção em `[build.environment]`, permitindo gerar o frontend conectado sem publicar `.env.local`. A política CSP continua ativa e permite apenas os hosts exatos de Auth e Functions, além dos recursos locais. As origens permitidas no Auth e na API incluem o site `https://stellar-tiramisu-56e571.netlify.app` e as prévias locais definidas na configuração.

O endpoint `/api/*` do Netlify encaminha para a API com o token do usuário. As variáveis de build do `netlify.toml` não são herdadas em runtime: o adaptador reconhece o Netlify por `SITE_ID` e usa as URLs públicas deste projeto como configuração padrão. Não é uma segunda fonte de identidades ou senhas. Os documentos continuam privados no Postgres neste piloto; não foi contratado Object Storage.

O deploy no Neon não publica o frontend no Netlify. A integração inicial já foi enviada ao GitHub; cada nova alteração precisa de autorização específica antes do próximo push ou publicação remota.

## Retenção e limites

O gatilho `mvp-retention` invoca `/internal/retention` de hora em hora. A função valida a procedência pelo parser oficial de triggers; requisições fabricadas ao endpoint são rejeitadas. A API também expurga conteúdo vencido durante as requisições. A rotina antiga do Netlify fica inativa quando o Neon assume essa responsabilidade.

Conversas e anexos vencem 30 dias após o encerramento. A retenção de propostas e metadados segue as limitações já documentadas do MVP. Backups e histórico de restauração do provedor não são apagados por essa rotina. Grandes volumes exigem normalização das tabelas, armazenamento privado de anexos e dimensionamento.

No Auth, sair encerra a sessão do provedor. Um JWT já emitido pode continuar válido até expirar, normalmente em 15 minutos. Não há promessa de revogação instantânea de todo token já copiado. Suspensão do usuário continua sendo verificada no banco pela API.

## CLI, skills e MCP

O comando `neon init` instalou o plugin Neon para Codex, com skills e configuração MCP OAuth apontando para `https://mcp.neon.tech/mcp`. A configuração não grava API key no repositório. O CLI foi autenticado pelo navegador; o MCP pode solicitar sua própria autorização OAuth ao ser carregado pelo agente. Não transfira manualmente tokens do CLI para o MCP.

As ferramentas MCP do plugin podem exigir recarregar a sessão do Codex para aparecer. Nesta execução, a administração remota utilizou o CLI autenticado, conforme a preferência da skill oficial. O registro das validações está no relatório desta entrega.

Referências usadas: [skill Neon](https://neon.com/.well-known/agent-skills/neon/SKILL.md), [Neon Auth](https://neon.com/docs/ai/skills/neon-auth/SKILL.md), [Functions](https://neon.com/docs/compute/functions/get-started.md), [autenticação da API](https://neon.com/docs/compute/functions/authentication.md).
