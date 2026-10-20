# Acessos temporários e e-mails demonstrativos

Cada perfil demonstrativo possui um identificador `nome@teste.com` e pode entrar pelo nome ou por esse e-mail com a senha `123`. Esses endereços não representam caixas de entrada criadas ou verificadas.

| Nome de acesso | E-mail de teste | Perfil |
| --- | --- | --- |
| user | user@teste.com | Cliente |
| tayane | tayane@teste.com | Advocacia |
| miguel | miguel@teste.com | Advocacia |
| feuzer | feuzer@teste.com | Advocacia |
| marcos | marcos@teste.com | Engenharia civil |
| maria | maria@teste.com | Engenharia civil |
| bruno | bruno@teste.com | TI |
| stefanny | stefanny@teste.com | TI |
| kleber | kleber@teste.com | TI |

O acesso temporário de Bruno não concede administração. Perfis suspensos ou vinculados a uma identidade real do Neon não aceitam a senha pública. E-mails personalizados e contas fora da lista são preservados. Conversas continuam limitadas aos participantes; a senha compartilhada permite que qualquer testador entre no respectivo perfil demonstrativo, portanto os dados utilizados devem ser fictícios.

## Validação concluída

- `npm test`: 73 testes aprovados, zero falhas.
- `npm run check` e `npm run build`: concluídos com sucesso.
- `node scripts/test-login-browser.mjs`: nove logins por nome e nove por e-mail, e-mail exibido em Minha conta, persistência após recarregar, rejeição de senha incorreta, ausência de administração, chamado, aceite, chat, cancelamento, isolamento, troca de conta e logout. Nenhuma exceção JavaScript.
- Layout da lista de e-mails verificado na largura de 375 pixels, sem transbordamento horizontal.
- Na branch `mvp-neon-validation`, migração do esquema e atualização dos perfis aplicadas. Deployment 4 da função `hello`: ativo e concluído.
- `node --env-file=.env.neon-test scripts/test-login-remote.mjs --exercise`: nove nomes e nove e-mails autenticados, valores conferidos diretamente no PostgreSQL, tentativas anônimas e tokens fabricados bloqueados, origem externa rejeitada e ações administrativas negadas. Chamado fictício aberto, aceito, conversado e cancelado. Todas as sessões criadas pelo teste foram revogadas e sua reutilização retornou 401.

Prévia local: http://127.0.0.1:4190/#/entrar, com banco PostgreSQL embarcado separado do serviço remoto.

## Publicação e pendência

O usuário autorizou expressamente o envio deste código ao GitHub. A atualização da API em `production` foi bloqueada pela revisão automática de aprovação antes da execução: habilitar acesso público com senha `123` exige confirmação específica para produção. A migração e o deploy de produção desse recurso não foram executados. Enviar o código ao GitHub/Netlify não implanta a função do Neon; o recurso online permanece dependente dessa autorização e da aplicação do esquema antes do deployment.

Após autorização específica, aplicar `npm run db:init`, depois `neon deploy --branch production --env .env.local --no-env-pull` e validar com `node --env-file=.env.local scripts/test-login-remote.mjs`. Para desativar o modo temporário, configurar `TEST_LOGIN_ENABLED: "0"` em `neon.ts` e publicar a API. O login com credenciais individuais do Neon continua separado desse modo.
