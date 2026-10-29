# Correções do atendimento de TI — 19/10/2026

As cinco correções solicitadas foram implementadas localmente.

1. **Comprovantes separados da quota comum:** os 15 anexos comuns não impedem envio do comprovante. Cada arquivo continua limitado a 2 MB. Somente o cliente pode enviar comprovantes, após uma proposta aprovada. Confirmar a versão e o valor atuais continua obrigatório para concluir.
2. **Proposta e arquivo em conjunto:** o navegador usa a mesma validação de campos do domínio antes de enviar o arquivo. O formulário envia proposta e anexo numa única requisição; todas as validações precedem a gravação. A transação do servidor desfaz a operação inteira em caso de erro. O modo estático também valida tudo antes de alterar o estado. A API anterior por `fileId` continua disponível para documentos já anexados pelo próprio autor na conversa atual.
3. **Reagendamento e cancelamento individual:** o especialista usa Reagendar no cartão do encontro original. O novo horário fica pendente e o anterior continua válido. Confirmar o novo marca o antigo como Substituído; recusar ou cancelar a proposta de novo horário mantém o anterior. Cliente e especialista podem cancelar um encontro, informando motivo. O motivo fica no histórico e a outra parte é notificada. Cancelar o original cancela também o reagendamento ainda pendente. Um encontro independente continua podendo ser criado pelo botão Registrar agendamento.
4. **Transferência privada com observação:** o motivo da liberação aparece ao especialista compatível na fila e acompanha o novo atendimento. Mensagens, anexos, propostas e encontros do profissional anterior não são compartilhados. O ex-participante vê sua própria participação encerrada, com datas e motivo próprios, sem receber status, responsável ou motivo de encerramento posteriores. Ex-participantes ficam fora de novos aceites desse chamado. A visão administrativa de metadados operacionais permanece separada dos chats privados.
5. **Encerramento completo:** concluir cancela propostas pendentes, encerra chats e cancela encontros futuros/pendentes. Encontros já confirmados com data anterior à conclusão permanecem como Encerrados no histórico, sem afirmar que foram realizados. A proposta efetivamente aprovada, os comprovantes e a avaliação continuam preservados conforme as regras anteriores. A vaga é liberada e nenhuma proposta fica Em análise após a conclusão.

## Registros existentes

Na leitura dos dados, chamados já concluídos ou cancelados têm suas pendências encerradas usando a data original de encerramento. A atualização é idempotente. Motivos de transferência antigos são recuperados da mensagem de liberação quando ela ainda existe; o sistema não inventa conteúdo já removido pela retenção. O prazo de 30 dias para mensagens e anexos continua vinculado ao encerramento da respectiva conversa.

## Validação

- 63 testes automatizados aprovados, incluindo os 54 anteriores e nove novos cenários de correção.
- Testes HTTP de rollback, concorrência pela última vaga de anexo, comprovante após quota cheia e autorização de agendamento.
- Testes de reagendamento confirmado/recusado, cancelamento pelo cliente/especialista, cancelamento do original com substituição pendente e bloqueio de ações após encerramento.
- Testes de transferência múltipla, observação visível ao novo especialista e visão do anterior sem alterações posteriores.
- No Edge, versões local e estática: duas propostas inválidas não salvaram arquivos; a proposta válida salvou um único anexo; o comprovante foi enviado após 15 documentos; reagendamento e cancelamento individual funcionaram; conclusão limpou pendências e liberou vaga; transferência protegeu ambas as conversas. Layout móvel conferido.
- Reexecução dos dez cenários da auditoria de TI e da auditoria de privacidade.

Evidências locais: `artifacts/auditoria/ti-corrections-browser-results.json`, `ti-api-retest-results.json`, `privacy-results.json`. Capturas: [encerramento corrigido](../artifacts/auditoria/ti-corrigido-encerramento-local.png) e [histórico privado após transferência](../artifacts/auditoria/ti-corrigido-transferencia-local.png).

## Itens da auditoria fora desta solicitação

Permanecem documentados os acessos compartilhados de demonstração, recuperação simulada, armazenamento da versão estática e enumeração de e-mail. Esta entrega não os classifica como corrigidos. A reutilização de sessão após reativação de perfil (TI-05) foi corrigida depois, em [contas e permissões](CONTAS-E-PERMISSOES-2026-10-29.md).

Nenhum envio ao GitHub foi realizado.
