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

## Atualização posterior: usuários sem e-mail e perfis jurídicos

A nova solicitação mantém o acesso dos nove usuários pelo nome e senha `123`. Essa forma de login foi validada novamente na prévia local e na branch isolada. A suíte passou a 75 testes, incluindo migração dos perfis jurídicos, preservação de histórico e autorização de aceite por especialidade. Build e verificação de sintaxe aprovados. No navegador, os nove nomes foram autenticados, e os cards corretos foram conferidos. Deployment 5 da branch de validação: concluído; teste remoto com abertura, conversa e cancelamento aprovado.

Tayane passou para **Direito criminal** e Miguel para **Advogado geral**, incluindo as respectivas listas de serviços. Em produção foram atualizados exclusivamente esses campos dos dois perfis, dentro de uma transação com bloqueio da linha e comparação dos demais dados antes da gravação. Nenhum contato, histórico ou configuração de autenticação foi alterado. A API pública do site confirmou os dois cards corretos e `testLoginEnabled` desativado.

A revisão automática bloqueou novamente o deploy que habilitaria a senha pública em produção, pois exige confirmação explícita do ambiente online e do alcance desse acesso. Não houve nova tentativa de habilitar autenticação por outro caminho. A alteração isolada dos cards foi executada como alternativa que preserva a autenticação existente. A ativação online do login temporário continua pendente dessa autorização específica. As alterações de código desta atualização permanecem locais, sem novo push ao GitHub.

## Ativação online após autorização explícita

O usuário respondeu **“autorizado, subir para Github”** à pergunta específica sobre ativar os nove acessos em produção e o alcance público da senha `123`. Com essa autorização, a migração `npm run db:init` e o deploy `neon deploy --branch production --env .env.local --no-env-pull` foram executados. Deployment 3 de `hello` em `production`: ativo, concluído, runtime Node.js 24. O horário de operação continua real.

`node --env-file=.env.local scripts/test-login-remote.mjs` passou em produção: nove nomes e nove aliases de e-mail, perfil e papel corretos, sessões persistentes, nove e-mails gravados no PostgreSQL, especialidades e serviços de Tayane e Miguel atualizados, acesso anônimo e token fabricado rejeitados, CORS e restrição administrativa preservados. Todas as sessões criadas pelo teste foram revogadas, e a reutilização retornou 401. Nenhum chamado foi criado por esse teste de produção.

O navegador Edge também validou o site real do Netlify: login com cada um dos nove nomes, sem e-mail, senha `123`, perfil correto, sessão após recarregar, ausência de administração e logout. Nenhuma exceção JavaScript. Evidência local em `artifacts/test-login-netlify-browser-results.json`, fora do Git. A consulta pública confirmou `testLoginEnabled: true`, horário real e os cards de Tayane em Direito criminal e Miguel como Advogado geral.

As pendências de autorização descritas nas seções anteriores registram etapas já superadas por essa confirmação. O envio deste código ao GitHub foi expressamente autorizado, com 75 testes aprovados e build concluído. As contas são compartilhadas e destinadas exclusivamente a dados fictícios.
