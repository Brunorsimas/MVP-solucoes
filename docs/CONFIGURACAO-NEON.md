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

## Cadastros e especialistas

Clientes usam **Criar conta** e entram com seu email e senha, de 10 a 128 caracteres. O login compartilhado do Neon não usa as senhas públicas `123` dos exemplos locais.

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

O código do frontend ainda precisa ser enviado ao GitHub para o Netlify publicar sua versão atualizada. O deploy no Neon não publica o frontend no Netlify, e as instruções locais exigem autorização específica antes do push.

## Retenção e limites

O gatilho `mvp-retention` invoca `/internal/retention` de hora em hora. A função valida a procedência pelo parser oficial de triggers; requisições fabricadas ao endpoint são rejeitadas. A API também expurga conteúdo vencido durante as requisições. A rotina antiga do Netlify fica inativa quando o Neon assume essa responsabilidade.

Conversas e anexos vencem 30 dias após o encerramento. A retenção de propostas e metadados segue as limitações já documentadas do MVP. Backups e histórico de restauração do provedor não são apagados por essa rotina. Grandes volumes exigem normalização das tabelas, armazenamento privado de anexos e dimensionamento.

No Auth, sair encerra a sessão do provedor. Um JWT já emitido pode continuar válido até expirar, normalmente em 15 minutos. Não há promessa de revogação instantânea de todo token já copiado. Suspensão do usuário continua sendo verificada no banco pela API.

## CLI, skills e MCP

O comando `neon init` instalou o plugin Neon para Codex, com skills e configuração MCP OAuth apontando para `https://mcp.neon.tech/mcp`. A configuração não grava API key no repositório. O CLI foi autenticado pelo navegador; o MCP pode solicitar sua própria autorização OAuth ao ser carregado pelo agente. Não transfira manualmente tokens do CLI para o MCP.

As ferramentas MCP do plugin podem exigir recarregar a sessão do Codex para aparecer. Nesta execução, a administração remota utilizou o CLI autenticado, conforme a preferência da skill oficial. O registro das validações está no relatório desta entrega.

Referências usadas: [skill Neon](https://neon.com/.well-known/agent-skills/neon/SKILL.md), [Neon Auth](https://neon.com/docs/ai/skills/neon-auth/SKILL.md), [Functions](https://neon.com/docs/compute/functions/get-started.md), [autenticação da API](https://neon.com/docs/compute/functions/authentication.md).
