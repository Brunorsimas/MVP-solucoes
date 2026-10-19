# Auditoria funcional e de segurança — MVP Soluções

Data: 19/10/2026. Código auditado: commit `901d6b0fd7301775fd9ab5c0dc9b9dc13e926c56`.

**Sete falhas reproduzidas. O atendimento jurídico principal funciona, mas há problemas de privacidade, registro de pagamento e encerramento que precisam de correção antes de receber casos reais.**

Os arquivos da aplicação não foram modificados. Foram acrescentados apenas os roteiros de auditoria e este relatório. Nenhum envio ao GitHub ou deploy foi realizado.

## Contas criadas e ambiente

| Perfil fictício | Login | Senha de teste |
| --- | --- | --- |
| Cliente Auditoria | `cliente.auditoria@example.test` | `TesteLocal!2026` |
| Juridico Auditoria — advocacia geral | `juridico.auditoria@example.test` | `TesteLocal!2026` |

Prévia: **http://127.0.0.1:4187/#/entrar**, neste computador, enquanto o servidor local estiver ativo. As contas não foram criadas no Netlify.

Banco preservado: `data/auditoria-navegador-1792412297610.sqlite`. Atendimento jurídico concluído: `MVP-0001`, ID `da92a067-bb5a-4c6d-b1e9-5e5ea5174167`.

As duas contas foram cadastradas pela API real. Como não existe provisionamento administrativo de especialistas, a conta jurídica recebeu esse papel por preparação controlada do banco exclusivo de teste. Isso não foi uma elevação de privilégio pela aplicação. Não foi inventado registro de OAB.

Contas demonstrativas auxiliares serviram aos testes de administração, transferência e acesso indevido. Os bancos habituais foram preservados. O relógio foi controlado nos cenários de validade, abertura, encerramento e retenção; suas datas são sintéticas.

## Falhas confirmadas

Prioridades indicam ordem prática de correção, não pontuação CVSS nem exploração comprovada na internet.

| ID | Prioridade | Falha reproduzida |
| --- | --- | --- |
| F01 | Alta — privacidade | Outra conta vê rascunho não enviado pelo cliente |
| F02 | Alta — integridade do registro | Orçamento aumentado reaproveita confirmação do pagamento anterior |
| F03 | Alta — operação | Suporte não efetiva encerramento de serviço contratado |
| F04 | Média | Agendamento pelo especialista não registra início da interação |
| F05 | Média | Reunião permanece confirmada após cancelamento do chamado |
| F06 | Média | Prazo de validade da proposta não é aplicado |
| F07 | Baixa | API aceita valor que é arredondado para zero |

### F01 — Rascunho exposto entre contas

**Reprodução:** o cliente escreve uma descrição, salva o rascunho e usa Sair. O especialista faz login no mesmo navegador e abre Nova solicitação. O texto não enviado pelo cliente aparece integralmente. Recarregar a página e avançar novamente também revela o texto.

**Causa:** `public/app.js:64` lê a chave global `mvp-draft`; `public/app.js:83` salva sem identificar o autor. O logout em `public/app.js:283` não limpa o armazenamento nem o objeto em memória.

**Impacto:** exposição de informações em computador compartilhado. Foi reproduzido no servidor com autenticação real, sem ferramentas de desenvolvedor para acessar o texto. Não foi demonstrada leitura remota entre computadores diferentes.

**Correção:** rascunhos no servidor com autorização por autor; ou limpeza do conteúdo persistido e em memória no logout/troca de conta para este MVP. Apenas colocar o ID do usuário no nome da chave não protege contra quem controla o navegador compartilhado.

**Aceite:** outra conta não recupera o rascunho, inclusive após recarregar ou abrir outra aba.

Evidências: `DRAFT-LEAK` no [JSON visual](../artifacts/auditoria/browser-results.json) e [captura da exposição](../artifacts/auditoria/rascunho-exposto-outra-conta.png).

### F02 — Confirmação de pagamento desvinculada da proposta

**Reprodução:** aprovar R$ 100, anexar comprovante fictício e confirmar recebimento. Enviar nova proposta de R$ 1.000 e aprová-la. Iniciar, entregar e concluir sem nova conferência ou documento.

**Observado:** `complete` retornou HTTP 200 e o chamado ficou `completed`.

**Causa:** `public/domain.js:209` confirma o arquivo sem guardar a versão/valor da proposta. A conclusão em `public/domain.js:213` exige apenas algum comprovante confirmado na conversa.

**Impacto:** encerramento pode se apoiar numa confirmação anterior à mudança das condições financeiras. Não houve movimentação bancária nem demonstração de desvio de dinheiro; a plataforma não processa pagamentos.

**Correção:** vincular a conferência ao acordo vigente e exigir nova confirmação após mudança financeira. Reutilizar o mesmo documento pode ser permitido, desde que exista nova conferência explícita do acordo atual.

**Aceite:** a sequência acima deve impedir conclusão até conferir o acordo vigente. Evidência: `PAYMENT-VERSION` no [JSON da API](../artifacts/auditoria/api-results.json).

### F03 — Encerramento contratado sem caminho operacional

**Reprodução:** contratar o serviço e desistir. Cancelar, liberar para outro especialista e encerrar sem cobrança são bloqueados. Abrir suporte pedindo encerramento. O administrador marca o suporte como tratado.

**Observado:** suporte `resolved`, chamado `contracted`, `closedAt=null`, uma vaga ainda ocupada.

**Causa:** `public/domain.js:140` só altera o estado do pedido de suporte. A administração em `public/app.js:207` não oferece ação para encerrar/transferir o atendimento contratado. Bloquear cancelamento direto após início é correto; falta o caminho alternativo anunciado ao usuário.

**Correção:** ação administrativa específica, com justificativa, autorização adequada, tratamento das condições acordadas, auditoria, data de encerramento, fechamento do chat, atualização da agenda e liberação da vaga. Não cancelar automaticamente qualquer atendimento só porque um suporte foi tratado.

**Aceite:** resolver uma desistência contratada sem simular entrega/pagamento nem editar diretamente o banco. Evidência: `SUPPORT-DEADEND`.

### F04 — Agendamento não conta como interação profissional

**Reprodução:** o especialista aceita e propõe uma reunião como primeira ação. O cliente confirma e cancela diretamente.

**Observado:** `startedAt` continua nulo e o cancelamento retorna HTTP 200.

**Causa:** agendamento em `public/domain.js:222` não registra início; cancelamento em `public/domain.js:158` depende desse campo. Mensagens, arquivos e propostas registram início.

**Correção:** aplicar uma definição única de primeira interação profissional, incluindo propor/responder a agendamento, coerente com a regra dos termos.

**Aceite:** depois dessa interação profissional, cancelamento direto é bloqueado e o usuário é orientado ao suporte. Evidência: `APPOINTMENT-CANCEL`.

### F05 — Agenda continua confirmada após cancelamento

**Reprodução:** no cenário anterior, consultar o compromisso após cancelar o chamado.

**Observado:** chamado `cancelled`, compromisso `confirmed`. A agenda apresenta o estado do compromisso sem reconciliá-lo com o encerramento.

**Causa:** `public/domain.js:158` não cancela agendamentos. A devolução à fila já o faz, mas cancelamento e encerramento sem cobrança não aplicam a mesma regra.

**Correção:** cancelar compromissos futuros ao cancelar o atendimento, preservar histórico e avisar as partes. Implementar também cancelamento/reagendamento explícito: criar outro horário hoje não substitui automaticamente o anterior.

**Aceite:** compromisso futuro de chamado cancelado aparece cancelado para ambos. Evidência: `APPOINTMENT-CANCEL` e inspeção de `agendaPage`.

### F06 — Aprovação de proposta vencida

**Reprodução:** enviar proposta válida por “1 dia”, avançar o relógio do servidor nove dias e aprovar pela API.

**Observado:** proposta `accepted`.

**Causa:** validade é texto livre em `public/domain.js:192`. A decisão em `public/domain.js:196` verifica versão/status, mas não vencimento.

**Correção:** armazenar vencimento como data/hora e validá-lo no servidor no instante da aprovação; apresentar expiração na interface.

**Aceite:** proposta vencida não pode ser aprovada, inclusive no teste do instante exato do limite. Evidência: `PROPOSAL-EXPIRY`.

### F07 — Valor positivo convertido em zero centavos

**Reprodução:** enviar `amount: 0.001` à operação `proposal`, com os outros campos válidos.

**Observado:** HTTP 200 e valor persistido de zero centavos.

**Causa:** `public/domain.js:188` aceita qualquer número positivo antes do arredondamento em `public/domain.js:192`. O `step=0.01` do HTML não protege a API.

**Correção:** validar no servidor mínimo de um centavo e no máximo duas casas decimais, usando centavos inteiros internamente.

**Aceite:** rejeitar zero, negativos e `0.001`; `0.01` resulta exatamente em um centavo. Evidência: `ZERO-CENTS`.

## Limitações demonstrativas e observação adicional

As condições abaixo já estão reconhecidas no projeto; não foram contadas como sete defeitos novos.

- **Netlify estático:** a configuração publica `dist`; dados e identidade ficam no navegador (`public/demo.js`). Não há backend compartilhado nem autorização confiável contra quem controla esse navegador. Foi testado o build local, sem ataques à hospedagem pública.
- **Recuperação simulada:** em `demo=true`, alguém sem login recebe `demoToken` apenas informando o e-mail e consegue trocar a senha. Reproduzido na conta fictícia (`DEMO-RESET`). É simulação intencional, incompatível com contas reais. Desativar o demo e implementar entrega por canal verificado; desativá-lo sozinho não cria esse serviço.
- **Senha pública `123`:** acessos demonstrativos incluem administração. São temporários; precisam ser substituídos para operação real. Os testes confirmaram rejeição desses acessos com demo desativado.
- **Sessões após suspensão:** operações foram bloqueadas enquanto o profissional estava suspenso. Depois da reativação, o cookie antigo voltou a funcionar sem novo login (`SESSION-REACTIVATION`). Não houve acesso durante suspensão. Recomenda-se invalidar sessões ao suspender por motivo de segurança, evitando reativar um cookie comprometido.
- **Serviços ausentes:** e-mail/WhatsApp reais, verificação de e-mail/qualificação, integração bancária e antivírus não estão ativos. O teste verificou avisos internos e assinatura inicial/tamanho dos arquivos; não certificou anexos como livres de malware.

## Cobertura e resultados

| Área | Verificações executadas | Resultado |
| --- | --- | --- |
| Navegação pública | Início, serviços dos três setores, equipe, como funciona, sobre, termos e privacidade | Renderização verificada |
| Diretório | Filtros, busca, ausência de seleção/contratação direta | Conforme |
| Autenticação | Cadastro pela API, login correto/incorreto, recuperação, sessão, logout e limite HTTP 429 | Conforme no escopo; ressalvas demo acima |
| Minha conta/menu | Dados privados, edição, persistência, teclado, Escape, clique fora, cliente/especialista/admin, celular | Suítes existentes aprovadas |
| Formulário | Login obrigatório, setor, etapas, voltar, rascunho, consentimento, campos removidos e datas automáticas | F01 |
| Expediente e cobertura | 08:00 inclusivo, 19:00 exclusivo, fuso, região e serviço incompatíveis | Testes existentes aprovados |
| Aceite/fila | Até dois atendimentos, terceiro bloqueado, aceites concorrentes e indisponibilidade | Conforme |
| Chat e anexos | Mensagens, encerramento, HTML malicioso de teste escapado, downloads, tipo inválido, mais de 2 MB, limite de 15 | Conforme nos casos executados |
| Permissões | Sem sessão, CSRF, origem externa, cliente tentando tornar-se admin, acesso alheio ao chat/arquivo e admin fora da conversa | Bloqueios observados; F01 é exceção em rascunhos |
| Propostas | Envio, recusa, substituição, versão antiga rejeitada, aprovação e execução | F06 e F07 |
| Agenda | Propor, confirmar, recusar, impedir autoaprovação | F04 e F05 |
| Pagamento/conclusão | Entrega, comprovante, conferência, bloqueios antes de entregar/pagar, encerramento | F02 |
| Avaliação | Cliente apenas, chamado concluído, nota 1–5, uma vez, profissional correto | Conforme |
| Transferência | Retorno à fila e isolamento de conversa/arquivos antigos do novo profissional | Conforme nos cenários testados |
| Suporte/admin | Pedidos, restrição, tratar suporte, suspender/reativar e metadados sem chats privados | F03 e observação sobre sessões |
| Notificações | Avisos internos, profissionais compatíveis e marcar como lidas | Conforme nos cenários testados |
| Histórico | Exportação TXT real, download do comprovante, exclusão de mensagens/anexos no limite de 30 dias | Conforme |
| Outros limites | Dez chamados abertos por cliente; proteção contra leitura HTTP de servidor, banco e configuração Git | Limites aplicados; arquivos internos não expostos nas requisições testadas |

Executados: **28 testes existentes**, **nove cenários adicionais de API**, as **três suítes existentes de navegador** e **um roteiro jurídico adicional em navegador**. Sintaxe e build também verificados. A execução final dos roteiros de navegador não registrou exceções JavaScript da aplicação.

Os roteiros de auditoria concluem com sucesso quando reproduzem as evidências, inclusive defeitos. Isso não significa que as falhas tenham sido corrigidas. A cobertura combina interface, API, domínio e leitura de código; não representa teste exaustivo de todas as combinações possíveis.

## Artefatos e reprodução

- [Evidências da API](../artifacts/auditoria/api-results.json).
- [Evidências do navegador](../artifacts/auditoria/browser-results.json).
- [Chamado concluído — desktop](../artifacts/auditoria/juridico-concluido-desktop.png).
- [Chamado concluído — celular](../artifacts/auditoria/juridico-concluido-mobile.png).
- [Rascunho exposto na outra conta](../artifacts/auditoria/rascunho-exposto-outra-conta.png).
- [Roteiro da API](../scripts/security-audit.mjs) e [roteiro jurídico visual](../scripts/legal-browser-audit.mjs).

Bancos, capturas, downloads e JSONs estão em `data/` e `artifacts/`, ignorados pelo Git. Esses links funcionam no diretório local; as evidências não serão automaticamente publicadas junto com o relatório.

```powershell
npm run check
npm test
npm run build
node scripts/security-audit.mjs
# Os próximos comandos exigem Edge/Chromium isolado com CDP em 127.0.0.1:9333.
node scripts/browser-test.mjs
node scripts/static-browser-test.mjs
node scripts/account-browser-test.mjs
node scripts/legal-browser-audit.mjs
```

Cada execução adicional cria bancos próprios com dados fictícios. Para reabrir o banco preservado, a partir da pasta do projeto, caso a prévia esteja desligada:

```powershell
$env:PORT = '4187'
$env:DATABASE_PATH = 'E:/Devs/Projetos/Albinur/mvp-solucoes/data/auditoria-navegador-1792412297610.sqlite'
node server.mjs
```

Não foram realizados testes de carga de produção, invasão de infraestrutura, integração com provedores externos, Safari/Firefox, restauração de backups ou revisão jurídica de políticas. Este relatório não certifica ausência de vulnerabilidades fora dos cenários exercitados.
