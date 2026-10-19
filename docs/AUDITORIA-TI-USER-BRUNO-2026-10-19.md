# Auditoria funcional e de segurança — user e Bruno — 19/10/2026

**Atualização:** TI-01, TI-02, TI-03, TI-04 e P05 foram corrigidos e retestados. Veja [as correções e suas regras](CORRECOES-TI-2026-10-19.md). O conteúdo abaixo preserva a reprodução histórica das falhas. TI-05 e os demais riscos demonstrativos continuam pendentes.

O fluxo principal de TI foi testado com **user / 123** e **bruno / 123**, em servidor e navegador locais, com chamados e documentos inteiramente fictícios. Foram reproduzidos os problemas abaixo. Este documento é um relatório para correção; o comportamento da aplicação não foi alterado nesta auditoria.

Execução concluída: dez cenários HTTP, 21 ações de negócio e roteiro visual de TI, incluindo downloads, passaram nas verificações do roteiro. Nos cenários de falha, “passou” significa que a falha descrita foi reproduzida e conferida, não que a aplicação está sem defeitos. A execução final do roteiro visual não registrou exceções JavaScript.

Bruno também é administrador. Kleber e Tayane foram usados apenas em cenários auxiliares que precisam de outra identidade: transferência, acesso indevido, compatibilidade e suspensão. Os testes complementares de cadastro e recuperação usam contas fictícias cadastradas, pois user e Bruno são contas demonstrativas pré-definidas.

## Problemas reproduzidos no atendimento de TI

### TI-01 — Limite de anexos impede enviar comprovante e concluir o serviço

**Prioridade: alta funcional.**

Reprodução: user abre um chamado de suporte; Bruno aceita e envia proposta; user aprova. São compartilhados 15 documentos comuns. Bruno inicia a execução e registra a entrega. Ao tentar anexar o comprovante, user recebe HTTP 400: `Limite de 15 anexos por conversa.` Bruno também recebe HTTP 400 ao tentar concluir, porque não existe comprovante confirmado.

O chamado fica em `delivery` e ocupa uma vaga do especialista. A plataforma não oferece exclusão de anexos nem reserva espaço para comprovantes. É possível pedir encerramento administrativo, mas isso cancela o chamado e não conclui normalmente o serviço já entregue, afetando também a avaliação.

**Correção recomendada:** separar a quota de comprovantes da quota de documentos, ou reservar espaço para o pagamento. Tratar documentos de proposta na mesma regra e oferecer uma saída controlada para chamados que já atingiram o limite. Testar explicitamente o fechamento após a quota cheia.

### TI-02 — Proposta rejeitada salva o anexo; tentar novamente duplica o arquivo

**Prioridade: média funcional.**

Reprodução pelo formulário: Bruno abre uma proposta, informa valor R$ 150, escopo `curto`, prazo, pagamento, validade e anexa um PDF. O navegador permite enviar, mas a API rejeita o escopo por ter menos de dez caracteres. O arquivo já foi enviado numa requisição anterior e permanece no chat. Repetir o envio deixa **dois anexos e nenhuma proposta**.

O usuário vê erro na proposta, apesar de parte da operação ter sido persistida. Isso consome a quota de 15 arquivos e pode provocar TI-01. Não há duplicação de cobrança bancária: a plataforma não processa pagamentos.

**Correção recomendada:** validar os campos antes de enviar o arquivo e implementar uma operação que grave proposta e anexo em conjunto, ou reutilize o arquivo já enviado ao repetir a tentativa. A validação no navegador deve acompanhar as regras do servidor.

### TI-03 — Reagendamento não substitui o horário anterior

**Prioridade: média funcional.**

Reprodução: Bruno agenda um horário e user confirma. Seguindo a orientação da interface para reagendar, Bruno envia outro horário e user confirma novamente. Os dois permanecem `confirmed`. Tentar recusar o primeiro pela API retorna HTTP 400 porque ele já não está pendente. A interface não oferece cancelar ou substituir apenas aquele agendamento.

Ter vários encontros pode ser legítimo; o defeito está na falta de um fluxo para distinguir um novo encontro da substituição do anterior. Seguir a instrução atual para reagendar deixa ambos válidos na agenda.

**Correção recomendada:** adicionar reagendamento vinculado ao encontro original, preservando o histórico e marcando o horário antigo como substituído após a confirmação do novo. Permitir cancelamento individual conforme a regra acordada entre as partes.

### TI-04 — Chamado concluído conserva pendências sem ação possível

**Prioridade: baixa funcional.**

Reprodução: uma proposta é aprovada; Bruno envia outra, ainda sem decisão, e mantém um encontro futuro confirmado. O pagamento da proposta aprovada é confirmado e o chamado é concluído. A nova proposta continua `pending`, apresentada como “Em análise”, enquanto o encontro continua confirmado.

A API bloqueia aprovar essa proposta após a conclusão; portanto, não foi demonstrada contratação indevida. A inconsistência é mostrar uma análise que não pode mais ser decidida, além de manter compromisso futuro sem tratar o encerramento.

**Correção recomendada:** encerrar explicitamente propostas pendentes ao concluir. Definir o tratamento de encontros futuros na conclusão, preservando datas e histórico dos encontros realizados.

### TI-05 — Sessão anterior à suspensão volta a funcionar após reativação

**Prioridade: média de segurança, especialmente se a suspensão tiver sido motivada por comprometimento da conta.**

Reprodução auxiliar: Kleber faz login. Bruno suspende o perfil; a mesma sessão passa a receber HTTP 401. Bruno reativa o perfil; o cookie antigo volta a executar ações com HTTP 200, sem novo login.

A suspensão bloqueia o acesso enquanto está ativa, mas não revoga as sessões. Não foi demonstrado que um atacante obtém o cookie por essa falha; o risco é reutilizar um cookie já comprometido após a reativação.

**Correção recomendada:** invalidar sessões ao suspender, ou manter uma versão de sessão por conta que obrigue nova autenticação após uma ação administrativa de segurança.

## Achados anteriores reconfirmados

| ID | Resultado atual | Condição e impacto |
|---|---|---|
| P05 | Ex-especialista recebe metadados posteriores à transferência | No cenário user → Bruno → Kleber, Bruno recebeu responsável atual, encerramento e motivo livre de encerramento. Não recebeu mensagens nem anexos da nova conversa. Prioridade média. |
| P01 | Recuperação devolve token no modo demo | Em contas cadastradas de teste, conhecer o e-mail permite redefinir a senha e ler contatos. Crítica se o servidor demo for exposto com dados reais. O modo normal não devolveu token. Não se refere à recuperação das contas fixas user/Bruno. |
| P02 | Credenciais compartilhadas permitem assumir perfis de teste | Inclui a administração de Bruno. Comportamento solicitado para demonstração; inadequado para dados reais. Login temporário foi bloqueado no modo normal. |
| P03 | Versão estática guarda o estado no navegador | Dados pessoais continuam no localStorage após logout; quem controla esse mesmo navegador pode ler o estado e alterar a identidade simulada. Não demonstra acesso remoto por outro dispositivo. |
| P06 | Cadastro revela existência de e-mail | HTTP 409 para endereço existente e 201 para novo, inclusive fora do modo demo. Permite enumeração de contas; não revela senha ou conversa. Prioridade baixa. |

A leitura do chamado por especialistas compatíveis **antes do aceite é comportamento autorizado**, conforme a definição do responsável. O antigo P04 não é considerado uma falha de acesso nesta auditoria.

Para P05, a correção deve limitar o ex-participante aos dados da sua participação encerrada. Para P01/P02/P03, a operação com usuários reais exige autenticação individual e backend, sem os atalhos demonstrativos. Para P06, recomenda-se cadastro com confirmação de e-mail e respostas públicas uniformes.

## Cobertura executada

| Área | Cenários exercitados | Resultado |
|---|---|---|
| Entrada e navegação | Login, senha errada, logout, menu da conta, teclado, mobile, páginas de serviços, termos, privacidade, ajuda e diretório | Fluxos verificados; limitações de demonstração acima |
| Solicitação | Formulário em três etapas, login obrigatório, setor preservado, descrição, detalhes, região e data automática | Chamado criado pelo cliente; leitura prévia pelo especialista sem iniciar atendimento |
| Rascunhos | Salvar/recarregar, troca de conta e logout em outra aba, descarte de armazenamento antigo sem dono | Isolamento passou em local e estático com user/Bruno |
| Fila e capacidade | Compatibilidade, disponibilidade, dois atendimentos, terceiro por perfil completo, corrida pelo último lugar e remoção de campo | Limites e exclusividade passaram; remoção de dados preservou chamados existentes |
| Conversa | Mensagens dos dois participantes, HTML como texto, bloqueio antes do aceite e após conclusão | Fluxo e escape verificados |
| Anexos | PDF, download privado, conteúdo incompatível, tamanho excedido, limite de quantidade, comprovante e exportação TXT | Proteção de acesso passou; TI-01 e TI-02 reproduzidos |
| Propostas | Formulário, documento do cliente, recusa, aprovação pela outra parte, expiração, valores inválidos e mudança do orçamento | Regras de versão e pagamento passaram; TI-02/TI-04 pendentes |
| Agenda | Especialista propõe, cliente confirma/recusa, segunda decisão bloqueada, cancelamento do chamado | Cancelamento limpa agenda; TI-03/TI-04 pendentes |
| Execução | Iniciar, entregar, conferir pagamento, concluir, datas e vaga liberada | Caminho normal passou; limite de anexos bloqueia o caminho alternativo |
| Avaliação | Nota, comentário, convite após conclusão e bloqueio de avaliação duplicada | Passou |
| Encerramento | Cancelar antes do contrato, encerramento sem cobrança, transferência e suporte após contrato | Fluxos passaram; P05 permanece |
| Perfil e administração | Dados privados, progresso, terceira vaga, busca, notificações, suporte, suspensão/reativação e restrição do cliente | TI-05 permanece |
| Segurança HTTP | Sessão obrigatória, CSRF, origem estrangeira, alteração indevida de papel/id, acesso a anexos alheios e arquivos internos | Tentativas bloqueadas nos cenários executados |
| Retenção | Conteúdo disponível antes de 30 dias e removido no limite | Mensagens e anexos eliminados conforme o relógio de teste |
| Hospedagem estática | Build em subdiretório, página direta de serviço, assets e persistência da sessão | Passou no servidor estático local |

As 21 ações de negócio existentes no domínio foram exercitadas pela API: accept, appointment, appointmentDecision, cancel, closeNoCharge, complete, confirmReceipt, createTicket, deliver, message, profile, proposal, proposalDecision, readNotifications, release, resolveSupport, review, startService, support, toggleProfessional e upload.

## Evidências e reexecução

- `scripts/ti-audit.mjs` → `artifacts/auditoria/ti-api-results.json`: cenários HTTP com user/Bruno e auxiliares.
- `scripts/ti-browser-audit.mjs` → `artifacts/auditoria/ti-browser-results.json`: fluxo visual, downloads e reprodução de TI-02/TI-03/TI-04.
- `scripts/ti-draft-browser-audit.mjs` → `artifacts/auditoria/ti-draft-browser-results.json`: rascunhos user/Bruno, expiração e encerramento por suporte.
- `scripts/privacy-audit.mjs` → `artifacts/auditoria/privacy-results.json`: achados anteriores e modos demo/normal.
- `scripts/account-browser-test.mjs` → `artifacts/account-browser-report.json`: menu, acessibilidade por teclado, edição e logout em local/estático.
- Capturas: `artifacts/auditoria/ti-proposta-anexo-erro.png`, `ti-agenda-duplicada.png` e `ti-concluido-pendente.png`.

Visualizar: [anexo persistido apesar da proposta rejeitada](../artifacts/auditoria/ti-proposta-anexo-erro.png), [dois horários confirmados](../artifacts/auditoria/ti-agenda-duplicada.png), [chamado concluído com pendências](../artifacts/auditoria/ti-concluido-pendente.png).

Os testes HTTP usam bancos em memória. Os testes de navegador usam perfil isolado do Edge, dados fictícios e origens locais. Os artefatos permanecem fora do Git. Para rodar os testes de navegador, é necessário Edge/Chromium com depuração local na porta 9333 e `npm run build` concluído. O roteiro respeita o limite de logins, aguardando a janela seguinte quando necessário.

A verificação de sintaxe, os 54 testes da suíte existente e o build passaram. Um teste antigo de perfil ainda esperava cinco campos para especialistas; essa expectativa do teste foi atualizada para os seis campos atuais. Falhas de sincronização do roteiro automatizado foram tratadas no próprio roteiro, sem serem classificadas como defeitos da plataforma.

## Limites e prioridade

Não foram feitos testes de carga, pentest da hospedagem pública, revisão jurídica nem validação de todos os formatos e dispositivos possíveis. Alertas reais por e-mail/WhatsApp, confirmação bancária, verificação de identidade e entrega real de recuperação de senha não estão implementados; não foram apresentados como funcionalidades aprovadas. Cadastro/recuperação foram verificados em cenários complementares com contas fictícias, além dos acessos temporários pedidos.

Para o funcionamento do MVP, priorizar TI-01, TI-02 e TI-03. Para dados reais, tratar também os riscos demonstrativos P01/P02/P03, o isolamento P05 e a revogação TI-05 antes da exposição pública. TI-04 e P06 completam a lista de ajustes. Nenhuma publicação foi feita.
