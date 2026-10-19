# Correções da auditoria — 19/10/2026

As sete solicitações foram implementadas localmente. O relatório original descreve o estado anterior às correções e permanece como registro histórico.

| Item | Comportamento implementado |
| --- | --- |
| 1. Rascunhos | Armazenamento por aba, vinculado à conta e sessão autenticadas. Logout e troca de conta apagam memória e armazenamento da aba; as demais abas recebem a alteração e também limpam seus rascunhos. Rascunhos antigos sem autor são descartados. Recarregar a página durante a mesma sessão preserva o próprio rascunho. |
| 2. Pagamento | Cada conferência registra proposta, valor, profissional e data. Aprovar outra versão exige nova conferência; a conclusão rejeita uma confirmação antiga. Uma tela desatualizada não consegue confirmar outra versão silenciosamente. O histórico das conferências é preservado. |
| 3. Suporte | Finalizar suporte vinculado a chamado aberto encerra esse chamado, fecha o chat, cancela propostas e reuniões pendentes e libera a vaga. A confirmação mostra explicitamente essa consequência. Suporte geral não encerra outros chamados. Atendimentos já encerrados mantêm status e datas. |
| 4. Início/agendamento | O aceite do especialista registra o início da conversa, exibido no chamado. O especialista registra horários desde esse início; o cliente confirma ou recusa. O cliente pode cancelar diretamente enquanto não houver contratação aprovada, inclusive depois de conversa ou reunião marcada. Após contratar, usa suporte. |
| 5. Reuniões | Cancelar, encerrar sem cobrança, devolver à fila ou encerrar pelo suporte cancela compromissos pendentes/confirmados. O histórico mantém o estado cancelado. |
| 6. Validade | Novas propostas têm vencimento explícito, com validade de 1 a 365 dias. A API rejeita aprovação a partir do instante exato do vencimento. A interface mostra “Vencida” e exige nova versão. Propostas antigas com validade numérica são interpretadas; validade antiga indeterminada exige atualização. |
| 7. Negociação livre | Conforme esclarecimento posterior do responsável, não há piso por setor/assunto. Cliente e especialista enviam propostas ou contrapropostas pelo formulário ou documento anexado. A outra parte aprova ou recusa. Dinheiro é registrado em centavos inteiros, rejeitando valores monetários inválidos. |

## Valores combinados entre as partes

O responsável esclareceu que o valor é combinado durante a conversa entre cliente e especialista. A configuração de mínimos por setor e assunto foi removida da interface e da API; configurações antigas não impõem preço aos novos acordos.

Em **Enviar proposta**, qualquer participante pode preencher o formulário ou selecionar **Anexar documento da proposta**. No modo documento, o arquivo contém escopo, prazo e pagamento; valor e validade são informados separadamente para registrar a versão que a outra parte aprovará. No formulário, o anexo é opcional. Propostas vencidas e confirmações de pagamento de versões anteriores continuam bloqueadas. Um documento solto no chat não contrata o serviço automaticamente.

## Validação

- **50 testes de domínio/API aprovados**, incluindo envio pelo cliente, documento obrigatório/opcional, contraproposta, bloqueio de autoaprovação, compatibilidade com propostas antigas e isolamento de anexos. Foram cobertos os dez assuntos da plataforma para precisão monetária.
- Nove cenários da auditoria de API repetidos sem erro do roteiro, com comprovação dos bloqueios e encerramentos corrigidos.
- Fluxo completo de navegador: abertura, aceite, proposta, agendamento do especialista, confirmação do cliente, execução, entrega, comprovante, conferência, conclusão e avaliação.
- Fluxo jurídico completo com as duas contas fictícias da auditoria, exportação e download reais no navegador e ausência de exposição do rascunho entre contas.
- Verificação de rascunhos entre abas, recarga na mesma sessão e descarte de rascunhos antigos nos modos local e estático.
- Ausência de controles administrativos de preços, bloqueio visual de proposta vencida e confirmação de encerramento pelo suporte testados no navegador.
- Negociação por documento do cliente, recusa e contraproposta por formulário do especialista e aprovação pelo cliente testadas no navegador nos modos local e estático, inclusive em celular.
- Build, sintaxe, navegação estática e menu de conta nos três tipos de perfil verificados.

Evidências locais, ignoradas pelo Git:

- [API após correções](../artifacts/auditoria/api-retest-results.json).
- [Atendimento jurídico após correções](../artifacts/auditoria/browser-retest-results.json).
- [Testes de abas e administração](../artifacts/auditoria/fixes-browser-results.json).
- [Testes da negociação livre](../artifacts/auditoria/negotiation-browser-results.json).
- [Painel administrativo](../artifacts/auditoria/admin-corrigido.png).
- [Atendimento jurídico concluído](../artifacts/auditoria/juridico-corrigido-desktop.png).
- [Formulário vazio após trocar de conta](../artifacts/auditoria/rascunho-isolado-outra-conta.png).

## Revisão local

Prévia: **http://127.0.0.1:4187/#/entrar**.

| Perfil | Login | Senha temporária |
| --- | --- | --- |
| Cliente de auditoria | `cliente.auditoria@example.test` | `TesteLocal!2026` |
| Especialista jurídico de auditoria | `juridico.auditoria@example.test` | `TesteLocal!2026` |
| Administração | `bruno` | `123` |

A prévia usa banco fictício separado. A demonstração estática continua armazenando dados no navegador; estas correções não a transformam em backend de produção. Contas e recuperação demonstrativas continuam temporárias. Nenhum envio ao GitHub ou deploy foi realizado.
