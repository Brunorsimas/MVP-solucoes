# Troca de senha e administração de contas — 29/10/2026

Duas entregas combinadas: cada pessoa passa a trocar a própria senha, e Bruno passa a administrar as contas da plataforma (criar, definir o setor dos especialistas, desativar e excluir).

## Troca de senha pela própria pessoa

Fica em **Minha conta → Senha de acesso**, nos dois ambientes.

- Pede a senha atual, a nova senha e a confirmação. As três são conferidas no servidor; o navegador só antecipa a comparação da confirmação.
- A nova senha tem de 10 a 128 caracteres e precisa ser diferente da atual.
- A troca encerra as demais sessões da conta e mantém apenas a sessão que fez a alteração.
- O limite é de 10 tentativas por janela, por conta.
- Contas de demonstração usam a senha fixa de teste e não têm senha própria: nelas a tela explica isso e recusa a troca (`409`).
- No ambiente Neon, contas do Neon Auth trocam a senha pelo próprio provedor, com `revokeOtherSessions`. Contas criadas pela administração trocam pela API da plataforma.

## Quem cria cada tipo de conta

| Perfil | Quem cria |
| --- | --- |
| Cliente | A própria pessoa, pela aba **Criar conta** na tela de acesso — ou o administrador |
| Especialista | Somente o administrador |
| Administrador | Ninguém pela interface |

O auto-cadastro continua aberto ao público e **sempre produz uma conta de cliente**. O papel é fixado no servidor (`role: 'client'`), não lido da requisição: enviar `role: 'professional'` ou `admin: true` no corpo do cadastro não tem efeito algum. `tests/shared-database.test.mjs` cobre exatamente essa tentativa — o cadastro responde `201` e o perfil volta como cliente comum.

Por isso a tabela de **Clientes** na administração é alimentada pelos dois caminhos, enquanto a de **Especialistas por setor** só recebe perfis criados pelo administrador.

O cadastro público exige nome, e-mail válido, senha de 10 a 128 caracteres e aceite dos termos, com a data do aceite registrada. São 10 tentativas por IP e e-mail duplicado responde `409`. No ambiente Neon, a confirmação de e-mail do provedor é exigida antes do primeiro acesso.

## Administração de contas

Quem administra é apenas o administrador. Não existem permissões nomeadas distribuídas entre especialistas: todo especialista atende os chamados do seu setor, como já era, e o que a administração gerencia é o setor de cada um.

A página **Administração** lista os perfis em tabelas separadas por tipo:

- **Especialistas por setor:** uma tabela para cada setor (Advocacia, Engenharia civil, Tecnologia da informação), com os serviços que a pessoa atende, quantos chamados tem em andamento, a situação e as ações. Cada linha reúne tudo: **Setor e serviços**, **Suspender/Reativar** e **Excluir**.
- **Clientes:** tabela à parte, só com **Suspender/Reativar** e **Excluir**. Uma conta de cliente nunca recebe os controles de setor ou de fila.
- **Criar usuário:** nome, e-mail de acesso, tipo (cliente ou especialista), setor e serviços quando for especialista, e a senha inicial. Os campos de setor só aparecem ao escolher Especialista. A senha inicial é combinada pessoalmente; no primeiro acesso a troca é obrigatória e, até trocar, a conta não executa nenhuma ação.
- **Setor e serviços:** cada especialista atende **um** setor. Ao trocar o setor, a lista de serviços acompanha, e ao menos um serviço do setor precisa ser marcado. As regras de chat, documentos, propostas e finalização do chamado não mudam para ninguém.
- **Desativar:** alcança qualquer perfil não administrador, cliente ou especialista. A suspensão encerra as sessões abertas na hora. Ao tentar entrar, a pessoa recebe `403` com "Usuário desativado, entre em contato como administrador do sistema". A mensagem só aparece depois de a senha conferir, para não revelar quais logins existem.
- **Excluir:** exige digitar o nome exato do perfil. O perfil é anonimizado, os chamados abertos são encerrados, as credenciais e sessões são apagadas, e as conversas continuam legíveis para a outra parte.

## Nada é apagado automaticamente

Um perfil excluído permanece guardado por **360 dias**, com um aviso na administração mostrando a contagem regressiva e a data da exclusão. Passado o prazo, o perfil continua lá: a remoção definitiva é sempre um ato explícito do administrador. Nenhuma rotina, expiração ou limpeza remove contas sozinha.

## Correções associadas

### Setor lido por chave de protótipo

A validação de setor consultava `SECTORS[payload.sector]` diretamente. Uma requisição com `sector: "__proto__"` ou `sector: "constructor"` devolvia um objeto herdado de `Object.prototype`, passava pela verificação e só quebrava adiante. Agora existe `sectorOf()`, que só aceita chaves próprias do catálogo. Aplicada nos três pontos do domínio — abrir chamado, criar usuário e definir setor — e nos cinco da interface. Coberta por `tests/admin-hardening.test.mjs`.

### Caixas de seleção esticadas

A regra `.field input{width:100%}` também alcançava os checkboxes, esticando cada caixa pela largura do campo e empurrando o rótulo para a borda direita. Corrigido com largura e altura fixas em `.check-label input`. Afetava também os termos de uso.

### TI-05

A falha TI-05 (sessão anterior à suspensão voltando a funcionar após a reativação) está corrigida. A suspensão apaga as sessões da conta, então a reativação exige um novo login. Os roteiros de auditoria `scripts/security-audit.mjs` e `scripts/ti-audit.mjs` foram atualizados para afirmar o comportamento corrigido.

## Validação

- 89 testes automatizados aprovados, incluindo `tests/admin-users.test.mjs`, `tests/password-login.test.mjs` e `tests/admin-hardening.test.mjs`.
- `tests/admin-hardening.test.mjs` cobre especificamente o abuso: 15 tentativas de ação administrativa por não-administrador (especialista, cliente e um perfil com `admin` forjado como texto), cliente recusando setor e fila por payload forjado, administrador protegido contra exclusão e suspensão, 7 confirmações inválidas de exclusão, retenção que chega a zero sem apagar nada, troca de setor preservando o atendimento em curso e o chat, e chaves de protótipo recusadas.
- `node scripts/security-audit.mjs`, `scripts/privacy-audit.mjs` e `scripts/ti-audit.mjs` concluem sem falha.
- `scripts/admin-users-browser-test.mjs` no Edge, 8 checagens sem erros de console: troca de senha com senha atual errada e confirmação divergente recusadas; senha antiga deixa de funcionar; usuário criado aparece na tabela; aviso de primeira troca exibido e removido; a linha de cliente oferece somente suspender e excluir, enquanto a do especialista também traz o setor; especialistas agrupados pelos três setores; troca de setor exigindo um serviço do setor escolhido; exclusão exige o nome exato e mostra os 360 dias; login de conta desativada responde `403` com a mensagem combinada.
- Evidências: `artifacts/admin-users-browser-report.json`, `artifacts/admin-account-password.png`, `artifacts/admin-users-tables.png`, `artifacts/admin-sector-form.png`, `artifacts/admin-users-deleted.png`.

Nenhum envio ao GitHub foi realizado.
