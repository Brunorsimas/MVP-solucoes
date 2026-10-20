# Cadastros e testes compartilhados

O piloto tem uma API privada para PostgreSQL e funções do Netlify. Cadastros, senhas protegidas por hash, sessões, chamados, conversas, propostas, agendamentos, avaliações e anexos ficam no banco do servidor. Cada participante recebe apenas os dados autorizados pela API. O navegador não recebe a conexão do banco nem a lista de credenciais.

## Situação desta entrega

**Atualização de 20/10/2026:** o projeto foi vinculado ao Neon, com Postgres, Auth e Functions. Consulte [a configuração atual](CONFIGURACAO-NEON.md). As instruções abaixo documentam a integração PostgreSQL genérica anterior. A versão antiga do frontend Netlify permanece estática até a publicação autorizada do código atualizado.

## 1. Criar o banco

Crie um projeto PostgreSQL no [Neon](https://console.neon.tech/) ou utilize outro provedor PostgreSQL compatível. Escolha uma região próxima da hospedagem e confira os limites/custos exibidos pelo provedor antes de confirmar qualquer plano. Prefira a conexão com pool indicada pelo provedor para funções serverless.

No painel de conexão, copie a string `postgresql://...` para uma variável secreta chamada `DATABASE_URL`. A implementação exige TLS com validação de certificado nos bancos remotos. Use o certificado do provedor reconhecido pelo sistema; não desative a validação.

**Não envie a string por chat, não coloque no GitHub, em arquivos públicos nem no JavaScript do navegador.** Para configurar localmente, copie `.env.example` para `.env` e substitua apenas os valores no seu computador. `.env` e os bancos locais estão ignorados pelo Git.

## 2. Preparar contas da equipe

Com Node.js 24 ou superior, na raiz do projeto:

```powershell
npm ci
npm run db:init
npm run db:specialist -- bruno
```

O último comando pede o e-mail de Bruno no terminal, cria uma senha aleatória individual e a mostra uma única vez nessa execução. Entregue-a ao titular por um canal privado. O login pode ser `bruno` ou o e-mail informado. Repita para `tayane`, `miguel`, `feuzer`, `marcos`, `maria`, `stefanny` e `kleber`. Executar novamente para a mesma pessoa troca sua senha e invalida as sessões anteriores. O perfil Bruno mantém o acesso administrativo.

Clientes criam sua própria conta pela opção **Criar conta**, com senha de 10 a 128 caracteres. O cadastro público sempre cria um cliente, mesmo se uma requisição tentar enviar privilégios adicionais. Os atalhos `user/123` e `bruno/123` não funcionam na API compartilhada. O administrador precisa provisionar o acesso de cada especialista; o perfil de exibição, sozinho, não habilita login.

Não há envio automático de recuperação de senha ou verificação de e-mail. A recuperação compartilhada não entrega códigos no navegador. A equipe deve orientar o cliente a procurar o administrador até a integração de e-mail ser implementada. O comando acima redefine apenas contas de especialistas.

## 3. Configurar o Netlify

Depois de revisar a prévia e autorizar a publicação:

1. No projeto Netlify, adicione `DATABASE_URL` em **Environment variables**, com escopo **Functions**. Use o contexto de produção para o banco do piloto. Não use a conexão de produção em previews de alterações não revisadas.
2. O arquivo `netlify.toml` passa a usar `npm run build:shared`, publicar `dist/` e incluir `netlify/functions/`. Se houver comando personalizado salvo no painel, ajuste-o para `npm run build:shared`.
3. Execute um novo deploy. A API e o frontend devem ser publicados juntos; arrastar apenas `dist/` não publica as funções.
4. Confira `/api/state` no endereço do site. Ele deve retornar `config.mode: "shared"`, nunca a conexão secreta.
5. Entre com um especialista provisionado. Em outro navegador/dispositivo, crie uma conta de cliente, abra um chamado compatível e confira se ele aparece na fila. Ao aceitar, a conversa deve aparecer para as duas contas.

Por padrão, chamados são abertos de 08:00 até antes das 19:00 no fuso `America/Recife`. Para testes em qualquer horário, configure `PILOT_TIME=10` no escopo Functions e republique; a interface informa o expediente simulado. Apague a variável quando quiser usar o horário real. Sessões duram 12 horas, usam cookie HttpOnly/Secure/SameSite=Strict e não dependem da memória de uma função.

Se a conexão estiver ausente ou indisponível, o site mostra o erro da API. Ele **não volta silenciosamente para localStorage**, evitando dar a impressão de que o cadastro foi salvo no banco compartilhado.

## 4. Prévia local

```powershell
npm ci
npm run preview:shared
```

Abra http://127.0.0.1:4188/. Sem `DATABASE_URL`, a prévia usa PostgreSQL embarcado em `data/shared-preview/`, persistente entre reinícios, e cria acessos de Bruno, Tayane e Kleber com senhas aleatórias em `data/shared-preview-access.json`. Tudo isso fica fora do Git. Crie um cliente na interface e use outro navegador para testar o especialista. A prévia é restrita ao computador local.

Se `DATABASE_URL` estiver definida no ambiente do processo, o mesmo comando usa esse banco em vez do banco embarcado. **Não aponte testes locais destrutivos para o banco do piloto.** O comando de prévia não carrega `.env` automaticamente; `db:init` e `db:specialist` carregam.

## Persistência, limites e retenção

- A migração PostgreSQL é idempotente; `database/schema.mjs` contém o SQL que também é empacotado nas funções. Inicializações concorrentes usam um bloqueio transacional. Na API Neon, a migração é executada separadamente com a conexão direta antes do deploy.
- Alterações do domínio bloqueiam a linha de estado com `SELECT ... FOR UPDATE`. Aceites, capacidade, proposta e anexo são confirmados juntos ou revertidos. Contas e sessões têm tabelas próprias; o domínio continua como JSONB para o piloto pequeno. Isso não foi dimensionado para grandes volumes.
- Há limites persistentes por origem de rede para cadastro/login/mutações, compartilhados entre instâncias. As chaves armazenam hash do endereço, não o endereço em texto.
- O cron `retention` roda de hora em hora e a API também verifica a retenção nas requisições. Conversas e anexos vencidos são removidos após 30 dias do encerramento. Disponibilidade do cron depende da publicação das funções. Backups do provedor exigem política própria.
- Documentos comuns: 15 por conversa; comprovantes continuam separados dessa quota. Cada arquivo permanece limitado a 2 MB. Anexos são persistidos no banco para este piloto; volumes maiores exigem armazenamento privado de objetos.
- Os dados anteriores da demonstração estática/SQLite não são importados automaticamente. Nenhum armazenamento local de outros usuários é enviado para o banco. Comece os testes compartilhados com novos cadastros.
- Banco hospedado, disponibilidade, custos, backups, região e direitos de acesso da infraestrutura precisam ser configurados na conta do responsável. Um arquivo de banco no GitHub não fornece um serviço de banco online.

## Validação

`npm run check`, `npm test`, `npm run build` e `npm run build:shared`. Os testes novos usam o motor PostgreSQL embarcado PGlite: recriam o processo sobre o mesmo diretório e verificam persistência de login/sessão/chamados, sessões independentes, concorrência serializada, rollback, proteção de senhas, CSRF e isolamento. A conexão TLS e a execução distribuída no Netlify precisam ser verificadas depois de criar o banco remoto; o teste embarcado não substitui essa validação.

Referências: [Netlify Functions](https://docs.netlify.com/build/functions/api/), [configuração de funções](https://docs.netlify.com/build/functions/configuration/), [conexões PostgreSQL](https://node-postgres.com/features/connecting), [transações](https://node-postgres.com/features/transactions), [conexão com pool no Neon](https://neon.com/docs/connect/connection-pooling).
