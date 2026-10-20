# Correção do chat — 20/10/2026

## Causa

O frontend consultava atualizações a cada cinco segundos, mas ignorava a consulta quando qualquer campo estava com foco, o menu estava aberto ou havia um modal na tela. O campo de mensagem normalmente permanecia com foco, impedindo o recebimento até outra ação provocar uma busca dos dados. Além disso, uma renderização completa apagaria a digitação e o arquivo selecionado.

## Correção

- Canal SSE autenticado em `/api/events`, com notificações do PostgreSQL após o commit. Funciona entre instâncias da API porque o aviso vem do banco, não apenas da memória do processo que recebeu a mensagem.
- Avisos sem mensagens, nomes, IDs de chamados ou dados pessoais. O conteúdo continua disponível exclusivamente pela projeção autorizada de `/api/state`.
- Atualização da interface sem substituir o campo usado para digitar, a seleção de texto, formulários editados ou arquivos selecionados. A leitura de mensagens antigas mantém a posição da rolagem.
- Reconexão automática com nova busca do estado, sem duplicar mensagens; recuperação ao voltar à aba ou recuperar a rede. Consultas periódicas servem de recuperação para notificações perdidas e backends sem SSE.
- Respostas antigas de outra sessão são descartadas. Logout interrompe a conexão. O servidor revalida a autenticação nos heartbeats e impõe limites de conexões e abertura.
- Adaptadores locais encaminham o stream sem aguardar o corpo inteiro. A versão SQLite usa notificações locais; a API Neon usa uma conexão direta PostgreSQL compartilhada por processo.

## Validação

`npm test`: **78 testes aprovados, zero falhas**, incluindo três testes novos de eventos. Cobrem duas instâncias de handler, autorização, CORS, token fabricado, limite de conexões, revogação da sessão, frames fragmentados e reconexão. O teste PostgreSQL confirma que rollback e gravação idêntica não geram notificação e que o aviso só sai após commit.

`npm run check` e `npm run build`: concluídos com sucesso.

No Edge, três contextos isolados usaram `user`, `bruno` e `tayane`, senha `123`, exclusivamente com dados fictícios. Os **11 cenários** abaixo passaram na prévia com PostgreSQL embarcado e na prévia ligada ao Neon:

1. Novo chamado aparece na fila do especialista sem recarregar.
2. O aceite abre o chat automaticamente para o cliente.
3. Mensagem chega durante a digitação, preservando o mesmo campo, foco, texto e seleção.
4. Mensagem chega também no sentido cliente → especialista.
5. Modal aberto e arquivo selecionado permanecem intactos durante o recebimento.
6. Formulário de perfil editado permanece preenchido sem salvar.
7. Leitura do histórico mantém a posição de rolagem.
8. Queda e recuperação da rede recuperam a mensagem sem duplicação.
9. Especialista alheio ao atendimento não acessa a conversa.
10. Cancelamento remove a caixa de envio na outra sessão automaticamente.
11. Logout interrompe a conexão de eventos.

Tempos medidos entre envio e exibição no outro navegador, em quatro mensagens de cada execução:

| Ambiente | Tempos |
| --- | --- |
| PostgreSQL local isolado | 71, 83, 88 e 145 ms |
| API e PostgreSQL Neon na branch de validação | 375, 720, 349 e 481 ms |

Esses tempos são observações dos testes, não uma garantia de latência. Não houve recarga da página para receber mensagens. Nenhuma exceção JavaScript foi detectada nos dois fluxos completos.

O teste remoto usou somente a branch `mvp-neon-validation`, deployment **6** da Function `hello`, confirmado como `completed`, ativo, runtime Node.js 24. O chamado criado foi cancelado ao final. Não houve migração nem deploy desta correção em `production` e nenhum push ao GitHub.

## Reprodução

Inicie um Edge/Chromium isolado com CDP na porta 9334 e a prévia:

```powershell
npm run preview:test-login
# Em outro terminal, na raiz do projeto:
npm run test:chat
```

O teste cria contextos isolados para as três contas e grava relatório e captura em `artifacts/chat-live-browser-results.json` e `artifacts/chat-live-browser.png`, ignorados pelo Git. `CDP_PORT` altera a porta do navegador. Para repetir contra uma prévia da branch de validação já configurada, defina `CHAT_TEST_ORIGIN=http://127.0.0.1:4189`; não aponte esse teste para produção, pois cria e cancela um chamado.

Prévia local da correção: http://127.0.0.1:4190/#/entrar. O site público permanece com a versão publicada anteriormente até autorização específica para envio e implantação.

## Publicação posterior

Após autorização, aplicar primeiro a migração do banco de produção para criar o trigger, depois implantar a API com a conexão direta configurada e publicar o frontend. Enviar apenas o frontend não ativa o canal SSE na API antiga; a sincronização periódica permanece como recuperação durante essa transição. O procedimento de Neon está em [CONFIGURACAO-NEON.md](CONFIGURACAO-NEON.md).

Referências técnicas: [PostgreSQL NOTIFY](https://www.postgresql.org/docs/15/sql-notify.html), [node-postgres Client e notification](https://node-postgres.com/apis/client).
