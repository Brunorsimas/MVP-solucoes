# Auditoria de privacidade e terceira vaga — 19/10/2026

**Atualização das correções de TI:** P05 foi corrigido; o ex-especialista recebe apenas sua própria participação encerrada. O motivo de liberação é compartilhado explicitamente com o próximo especialista. [Detalhes e testes](CORRECOES-TI-2026-10-19.md). Restam P01, P02, P03 e P06 desta auditoria; P04 é uma regra autorizada do produto. Os registros anteriores abaixo são históricos.

**Atualização após esclarecimento do responsável:** especialistas compatíveis devem ler as informações da solicitação antes de aceitar. P04 foi reclassificado como acesso previsto pelo produto. Permanecem cinco achados de segurança pendentes; a avaliação original abaixo fica como histórico. A prévia agora inclui descrição e detalhes do pedido, com aviso no formulário. Contatos pessoais da conta e conversas anteriores continuam restritos.

Validação da atualização: 54 testes aprovados, build e verificação de sintaxe concluídos. No Edge, as versões local e estática mostraram a descrição expandida antes do aceite, com início e chat ainda bloqueados. A consulta não ocupou vaga. Testes da API confirmaram isolamento de contatos e da conversa anterior em transferências.

Resultado: seis achados reproduzidos com dados fictícios. Três são limitações do ambiente demonstrativo; os demais envolvem exposição de informações na projeção dos chamados ou identificação de contas cadastradas. Esta entrega implementa a terceira vaga e documenta os achados; não corrige os seis pontos abaixo.

## Alteração entregue

O especialista mantém duas vagas com perfil incompleto. A terceira é calculada pelo servidor quando estão preenchidos nome, e-mail de contato válido, telefone válido, estado, cidade e apresentação de pelo menos 20 caracteres. A regra vale para advocacia, engenharia e TI. Login e especialidades já definidos não são novos campos a preencher. Disponibilidade é uma preferência, não um requisito de completude.

Minha conta mostra progresso, informações faltantes e incentivo. Fila, catálogo, aceite e administração usam o limite calculado. Alertas consideram a terceira vaga. Não basta enviar `capacity: 3` na API: o servidor ignora essa tentativa e deriva o limite dos dados persistidos. Se o perfil ficar incompleto, chamados existentes continuam; novos aceites ficam bloqueados enquanto a quantidade ativa estiver no limite ou acima dele. Preenchimento não comprova identidade, titularidade do contato ou qualificação profissional.

## Escopo e evidências

- Servidor local, SQLite em memória, cliente e especialista jurídico fictícios criados pelo teste. Contas auxiliares simulam outro cliente, outro especialista, administrador e visitante.
- API HTTP real: projeções de dados, alteração de perfil, anexos, transferência, suporte, autenticação, recuperação e cadastro. Verificações específicas também executadas com `demo: false`.
- Microsoft Edge isolado: fluxo visual da terceira vaga, versões local e estática, tela de 390 px, HTML malicioso fictício na apresentação e armazenamento após logout.
- Não foram acessados dados reais, contas de terceiros, Netlify ou GitHub. Não foi realizado teste de invasão do serviço publicado. Severidade indica impacto potencial se houver dados reais nas condições descritas.
- Evidências locais regeneráveis, fora do Git: `artifacts/auditoria/privacy-results.json`, `profile-browser-results.json` e `profile-capacity-local.png` / `profile-capacity-static.png`.

## Achados

### P01 — Recuperação permite assumir conta cadastrada no modo demo

**Criticidade:** crítica se o servidor demonstrativo estiver público com dados reais. **Condição:** `demo: true`, padrão atual; não se aplica ao site puramente estático, que não tem essa API.

Uma requisição sem autenticação para `POST /api/auth/recover`, informando o e-mail cadastrado, recebe `demoToken`. Esse token foi usado em `/api/auth/reset` para definir outra senha. O login subsequente permitiu ler telefone e e-mail de contato da vítima fictícia. Reproduzido tanto no cliente quanto no especialista jurídico com conta cadastrada. O processo também invalidou a sessão anterior.

É um atalho intencional de demonstração, mas equivale a tomada de conta quando exposto a terceiros. No teste com `demo: false`, a API não retornou token; envio real de recuperação ainda não está implementado.

**Correção recomendada:** não retornar tokens de recuperação ao navegador solicitante. Implementar entrega ao canal previamente verificado, resposta genérica e proteção contra abuso. Desativar o modo demo antes de qualquer operação pública com dados reais.

### P02 — Credenciais públicas dão acesso às contas de teste, inclusive administração

**Criticidade:** crítica se essas contas armazenarem informações reais acessíveis publicamente. **Condição:** modo demo local ou estático.

O código servido publica os usuários demonstrativos e `DEMO_PASSWORD = '123'`. O teste entrou como Bruno e recebeu privilégios administrativos. Qualquer pessoa que use as mesmas credenciais também assume as contas correspondentes; não existe separação entre pessoas usando um login compartilhado.

As credenciais foram solicitadas para testes e não constituem um novo mecanismo de invasão. O risco é manter esse acesso durante uso real. No servidor com `demo: false`, Bruno/123 foi rejeitado com HTTP 401. Isso, sozinho, não corrige a arquitetura da versão estática descrita em P03.

**Correção recomendada:** contas individuais, credenciais próprias, remoção dos acessos de demonstração na operação real e separação do ambiente de testes. Dados reais não devem ser colocados nas contas compartilhadas.

### P03 — Dados pessoais persistem acessíveis no navegador da versão estática

**Criticidade:** alta em navegador compartilhado. **Condição:** acesso ao mesmo perfil do navegador e à origem do site estático.

Após salvar telefone e contato de Tayane e sair, a interface estava deslogada, mas `localStorage['mvp-solucoes-static-v1']` ainda continha esses dados em texto legível. Reproduzido também no Edge real após logout. O armazenamento contém o estado completo da demonstração, não apenas os dados da conta atual.

No teste do módulo estático, alterar `sessionStorage['mvp-solucoes-static-session-v2']` para o identificador de Bruno também concedeu a identidade administrativa na simulação. Toda autorização ocorre no próprio cliente.

Isso **não demonstra acesso remoto de outro computador**. Demonstra ausência de isolamento diante de alguém com acesso ao mesmo navegador. A correção anterior dos rascunhos não remove esse banco de demonstração: são mecanismos diferentes.

**Correção recomendada:** usar backend autenticado para usuários reais e entregar ao navegador somente os dados autorizados. Não tentar proteger o estado completo apenas escondendo telas ou criptografando com chave entregue ao mesmo navegador. Manter a versão estática restrita a dados fictícios.

### P04 — Título livre do chamado fica visível antes do aceite

**Situação atual:** reclassificado. A leitura do chamado antes do aceite foi explicitamente autorizada como requisito funcional. Não é contabilizado como falha de controle de acesso. O registro abaixo descreve a análise anterior a essa definição.

**Criticidade:** média; pode aumentar conforme o conteúdo digitado. **Condição:** especialista compatível com o chamado na fila.

O cliente criou um chamado com um nome fictício e uma referência a caso familiar no título. Outro especialista jurídico, ainda sem vínculo com o atendimento, recebeu esse título e a cidade na resposta de `/api/state`. A descrição completa e o identificador do cliente foram corretamente omitidos.

A fila precisa informar o tipo de serviço e pode precisar da região. O problema é expor o título livre sem evitar que contenha identidade ou informações pessoais. A mesma projeção de chamados é utilizada no modo normal do servidor; não há uma condição de demo em `projectState` para essa exposição.

**Correção recomendada:** mostrar antes do aceite apenas protocolo, setor, assunto e localização estritamente necessária, com resumo sem identificação. Manter título e detalhes livres restritos aos participantes. Não depender apenas de um aviso para o cliente não digitar dados pessoais.

### P05 — Especialista anterior vê informações posteriores à transferência

**Criticidade:** média. **Condição:** especialista que participou de uma conversa anterior do chamado.

Após devolver o chamado à fila e outro especialista aceitá-lo, o primeiro continuou recebendo o responsável atual, status e data de encerramento em `/api/state`. Quando o novo especialista encerrou sem cobrança, o antigo também recebeu o texto livre de `closeReason`, que pode conter informações particulares do novo atendimento.

As mensagens e anexos da nova conversa permaneceram protegidos. O vazamento está nos campos gerais do chamado, retornados por cópia ampla do objeto, e não no chat. A projeção é compartilhada entre os modos normal e demo.

**Correção recomendada:** construir a visão do ex-participante a partir de uma lista explícita de campos da sua participação encerrada. Não retornar responsável posterior, motivo de encerramento posterior, novas datas ou outros detalhes da nova relação. Preservar somente seu histórico autorizado dentro da retenção aplicável.

### P06 — Cadastro permite descobrir se um e-mail tem conta

**Criticidade:** baixa. **Condição:** acesso à rota pública de cadastro, inclusive com `demo: false`.

O mesmo cadastro retornou HTTP 201 quando o e-mail estava livre e HTTP 409 quando já existia. Isso permite confirmar a existência de uma conta associada a um e-mail conhecido. Não fornece senha, telefone ou conversa. O limite de tentativas reduz a velocidade, mas não elimina essa distinção.

**Correção recomendada:** adotar fluxo de cadastro por confirmação de e-mail com resposta pública uniforme, evitando confirmar a terceiros se o endereço já está registrado. Avaliar também diferenças de status, conteúdo e tempo de resposta.

## Proteções que passaram nos cenários executados

- Telefone, e-mail de contato e cidade do perfil não apareceram no catálogo/API pública nem nas visões de outros clientes, especialistas ou administrador. A capacidade pública é apenas 2 ou 3; os campos faltantes ficam restritos à própria conta.
- Enviar outro `id`, papel, privilégio administrativo ou capacidade na atualização de perfil não alterou outra conta nem concedeu esses privilégios.
- Cliente estranho, especialista estranho e administrador não conseguiram baixar anexos de uma conversa alheia: HTTP 404; visitante sem sessão recebeu 401.
- Conversas e anexos de especialistas diferentes permaneceram separados na transferência.
- Suporte ficou visível para seu autor e administração, conforme a função do canal.
- Mutação sem sessão, com token CSRF inválido ou origem externa foi bloqueada.
- HTML inserido na apresentação foi exibido como texto no Edge: não criou imagem nem executou o código fictício.
- No modo normal, login de teste foi rejeitado e recuperação não devolveu token.

Esses resultados se limitam aos cenários executados. Não equivalem a certificação de segurança nem eliminam outros possíveis problemas.

## Validação da entrega

`npm run check`, `npm test` (52 testes aprovados) e `npm run build` concluídos. O teste de capacidade cobre os três setores, falta de cada campo, tentativa de forjar limite, concorrência pelo último lugar, notificações e redução do limite sem interromper chamados. O teste no Edge cobre salvar o perfil, aceitar o terceiro, bloquear o quarto, redução do limite, privacidade do catálogo, escape de HTML e apresentação móvel nas versões local e estática.

Reexecução local:

```text
node scripts/privacy-audit.mjs
node scripts/profile-browser-test.mjs
```

O segundo comando requer Edge/Chromium isolado com depuração local na porta 9333, além do build em `dist/`. Ambos usam dados fictícios; a auditoria HTTP usa banco em memória e não modifica as contas da prévia.

Prioridade: tratar P01/P02/P03 antes de dados reais; corrigir P05 e minimizar P04 no servidor; depois reduzir a enumeração de P06. Nenhuma publicação foi realizada nesta entrega.
