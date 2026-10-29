# MVP Soluções

Plataforma demonstrativa de atendimento em **Advocacia, Engenharia Civil e Tecnologia da Informação**, com cobertura inicial em Pernambuco e Belém–PA. Bruno administra a operação e participa da equipe de TI. Sem comissão da plataforma e sem pagamento integrado.

## Executar o MVP funcional

**Neon configurado para o piloto.** O projeto `holy-snow-61907956` utiliza Postgres, Neon Auth e uma API em Neon Functions. [Configuração, acessos da equipe e execução](docs/CONFIGURACAO-NEON.md). Com `.env.local` do Neon: `npm ci`, `npm run build` e `npm start` → http://127.0.0.1:4189/. O frontend Netlify precisa receber esta atualização de código após autorização de envio ao GitHub.

Requisito: **Node.js 24 ou superior**. Execute `npm ci` para instalar o driver PostgreSQL e as dependências de teste. O servidor local legado continua usando SQLite nativo.

```powershell
cd E:\Devs\Projetos\Albinur\mvp-solucoes
npm start
```

Abra **http://127.0.0.1:4173** (sem `.env.local` do Neon) ou **http://127.0.0.1:4189** (com as variáveis do Neon, que ativam o modo compartilhado). Em **Entrar**, use o login `user` e a senha `123` para testar como cliente. Para acompanhar o lado do especialista, use **Trocar conta** e entre com o login correspondente, também com a senha `123`. Os dados ficam em `data/mvp.sqlite`; reiniciar o servidor preserva os registros.

O servidor fica restrito ao computador local por padrão. O expediente de demonstração é **10h**, claramente indicado na interface, para permitir testes em qualquer horário. Para usar o relógio real:

```powershell
$env:DEMO_TIME = 'real'
npm start
```

O expediente real aceita solicitações de **08:00 até antes das 19:00**, no fuso `America/Recife`. O piloto considera todos os dias, pois não foi definida restrição de dias da semana. Esse comportamento deve ser confirmado antes do lançamento real.

## Equipe de demonstração

| Login | Perfil | Especialidades |
| --- | --- | --- |
| `user` | user | Cliente fictício para testes |
| `tayane` | Tayane | Advocacia geral |
| `miguel` | Miguel | Direito criminal |
| `feuzer` | Feuzer | Advocacia geral |
| `marcos` | Marcos | Engenharia civil |
| `maria` | Maria | Engenharia civil |
| `bruno` | Bruno | Suporte, conserto e montagem de computadores; administrador |
| `stefanny` | Stefanny | Desenvolvimento de software |
| `kleber` | Kleber | Engenharia de dados e suporte técnico |

**Senha temporária de todas as contas acima: `123`.** Esses acessos funcionam no modo demonstrativo local e na versão estática do Netlify/GitHub Pages. `DEMO_MODE=0` desativa o acesso temporário no servidor. Novas contas cadastradas no servidor continuam exigindo senhas de pelo menos 10 caracteres.

Perfis profissionais são demonstrativos, sem OAB, CREA, certificações, fotos ou avaliações inventadas. Todos estão inicialmente disponíveis nas regiões do piloto; a cobertura individual precisa ser validada antes de uso real.

## Funcionalidades implementadas

- Interface responsiva, identidade visual própria, navegação acessível e recursos SVG locais.
- Páginas de setores, diretório de especialistas, busca por nome/especialidade, ajuda, termos e privacidade.
- Formulário em três etapas, perguntas por serviço e rascunho privado por aba e sessão, acessível apenas após login. Logout e troca de conta removem o rascunho, inclusive nas outras abas. Rascunhos antigos sem autor são descartados. O setor escolhido é preservado durante a autenticação.
- Sem campo de preferência de dias ou horários no formulário. A abertura é registrada automaticamente ao enviar a solicitação; a conclusão ou cancelamento registra o encerramento. Data, ano, hora, minuto e segundo aparecem no acompanhamento e na administração, no horário de Brasília. Os horários são gerados pelo sistema e não podem ser definidos pelo formulário.
- Cadastro de clientes, login por senha com hash scrypt e cookies HttpOnly; recuperação simulada em ambiente de teste.
- Login temporário por usuário e senha para cliente, especialista e administrador, sem seleção de perfis na tela de acesso.
- Perfis profissionais apenas para exibição na página Especialistas; nenhuma escolha ou reserva de profissional ao solicitar atendimento.
- Encaminhamento por especialidade, região, disponibilidade e situação do perfil. Novos chamados começam com atendimento **a combinar**; remoto ou presencial é acordado entre cliente e especialista no chat.
- Especialistas compatíveis podem ler título, descrição, detalhes, serviço, cidade e data de abertura antes do aceite. Consultar não ocupa vaga nem inicia o atendimento; contatos da conta e histórico de conversas anteriores continuam restritos. A solicitação sai da fila dos demais especialistas assim que é aceita.
- Aceite exclusivo e limite transacional de **dois chamados ativos por profissional, ou três com o perfil completo**, incluindo projetos de engenharia.
- Chat privado com atualização a cada cinco segundos e histórico persistente no servidor local.
- Anexos privados em PDF, PNG e JPG: 2 MB por arquivo e 15 documentos comuns por conversa. Comprovantes não consomem essa quota e continuam disponíveis após os 15 documentos; exigem contratação aprovada e envio pelo cliente.
- Propostas versionadas com escopo, exclusões, valor, prazo, validade de 1 a 365 dias e condições de pagamento. O servidor bloqueia aprovação no instante do vencimento; é necessário enviar nova versão atualizada.
- Valor livremente negociado no chat, sem tabela ou piso por setor/assunto. Cliente e especialista podem enviar propostas e contrapropostas pelo formulário ou por documento em PDF/PNG/JPG (até 2 MB), informando valor e validade. A outra parte aprova ou recusa; ninguém aprova a própria proposta. A API valida apenas o formato monetário positivo em centavos, preservando os demais limites técnicos existentes.
- Aprovação vinculada à versão exata da proposta, registrada com usuário e data.
- Proposta com anexo é validada antes do envio e gravada em uma única operação. Se houver erro de validação ou falta de espaço na quota comum, nem arquivo nem proposta são gravados.
- O aceite registra o início da conversa. O especialista registra os agendamentos desde o início; o cliente confirma ou recusa. Horários exibidos em Brasília.
- Reagendamento vinculado ao encontro original: somente a confirmação do novo horário marca o antigo como substituído. Recusa ou cancelamento do novo mantém o anterior válido. Cliente e especialista podem cancelar um encontro com motivo registrado e notificação; cancelar o original também cancela reagendamentos pendentes dele.
- Comprovante anexado pelo cliente; recebimento declarado pelo profissional para a versão e valor exatos da proposta antes da conclusão. Nova proposta aprovada exige nova conferência explícita. Comprovantes antigos sem vínculo também precisam ser reconferidos.
- Cancelamento direto até aprovar a contratação, inclusive após conversa/agendamento. Cancelar ou encerrar sem cobrança cancela reuniões e propostas pendentes. Depois de contratar, o encerramento é solicitado pelo suporte.
- Ao tratar/finalizar um suporte vinculado a chamado aberto, o administrador confirma o encerramento do chamado, fechamento do chat, cancelamento da agenda e liberação da vaga. Suporte geral não encerra chamados; os já encerrados preservam status e datas originais.
- Novo encaminhamento antes da contratação: o motivo fica como observação para o próximo especialista. Cada profissional consulta somente sua participação; ex-participantes não recebem atualizações posteriores nem voltam à fila desse chamado. A administração mantém sua visão operacional, sem acesso geral a chats.
- Conclusão encerra propostas pendentes, encontros futuros e chats. Horários confirmados anteriores à conclusão ficam como encerrados no histórico. Dados antigos concluídos com pendências são normalizados sem alterar a data original de encerramento ou a proposta aprovada.
- Exportação do histórico em texto e download individual dos anexos.
- Exclusão de mensagens e anexos após 30 dias do encerramento de cada conversa.
- Notificações internas e indicação explícita de alertas externos simulados.
- Convite visível para avaliar o especialista após a conclusão, com nota de 1 a 5, comentário opcional e uma avaliação por chamado.
- Central de suporte, gestão de disponibilidade e suspensão de profissionais. A suspensão encerra as sessões abertas; ao tentar entrar, a pessoa é orientada a procurar a administração.
- Troca de senha em **Minha conta → Senha de acesso**, com senha atual, nova senha e confirmação. A troca encerra as demais sessões. Contas de demonstração usam a senha fixa de teste e não têm senha própria.
- Painel administrativo com metadados operacionais e auditoria, sem leitura geral de chats privados.
- Administração de contas: criar usuário com senha inicial e troca obrigatória no primeiro acesso, setor e serviços de cada especialista, desativação e exclusão. Clientes e especialistas ficam em listas separadas — a de clientes só oferece suspender e excluir. Administrar é exclusividade do administrador. A exclusão exige digitar o nome exato, anonimiza o perfil e guarda as informações por 360 dias. Nenhuma rotina apaga contas automaticamente. Detalhes em [contas e administração](docs/CONTAS-E-PERMISSOES-2026-10-29.md).

## Roteiro para testar o fluxo completo

1. Clique em **Solicitar atendimento**. Se ainda não estiver autenticado, entre com **user / 123** antes de acessar o formulário. Crie um chamado em TI → Suporte técnico, Recife. O tipo de atendimento será combinado no chat; o formulário não permite escolher especialista ou modalidade.
2. Use **Trocar conta** e entre com **bruno / 123**. Abra a fila, aceite o chamado e envie uma mensagem e uma proposta.
3. Entre novamente como **user / 123** e aprove a proposta. Combine um horário se desejar.
4. Entre como **bruno / 123**, inicie a execução e registre a entrega.
5. Entre como **user / 123** e anexe um comprovante fictício em PDF, PNG ou JPG.
6. Entre como **bruno / 123**, confirme o recebimento e conclua.
7. Entre como **user / 123**, abra o chamado concluído e clique em **Avaliar especialista**. Escolha de 1 a 5 estrelas e, se desejar, deixe um comentário. Confira também a data de expiração do histórico e exporte a conversa.

Para testar a capacidade, abra três chamados compatíveis e tente aceitar os três com o mesmo profissional. O terceiro deve ser bloqueado. Para testar transferência, devolva um chamado antes da contratação e assuma com outro profissional compatível.

## Duas versões, usos diferentes

| Versão | Persistência | Uso |
| --- | --- | --- |
| Servidor local (`npm start`) | SQLite no servidor; compartilhamento entre sessões autorizadas | Testar autenticação, permissões e fluxo funcional |
| Piloto compartilhado (`npm run build:shared` + Netlify Functions) | PostgreSQL privado no servidor | Testes pela internet após configurar o banco online |
| GitHub Pages (`npm run build`) | Somente localStorage/sessionStorage do navegador | Demonstrar interface e interações com dados fictícios |

**A demonstração estática não é um backend multiusuário nem um ambiente seguro para dados reais.** Qualquer pessoa com acesso ao mesmo navegador pode acessar os dados de demonstração. O login temporário com senha `123` funciona nesta demonstração; o cadastro de novas contas exige o servidor local. Trocar de conta simula os participantes de uma conversa. Dados antigos são migrados sem apagar o histórico; a conta demonstrativa Ana passa a usar o login `user`.

## GitHub Pages

O repositório contém uma ação em `.github/workflows/pages.yml` que verifica, testa e gera a demonstração estática ao receber alterações em `main`. O resultado fica disponível por sete dias como artefato **mvp-solucoes-demonstracao**, na execução da ação. O repositório informado é privado e sua visibilidade é preservada.

Para publicar posteriormente, verifique o plano e a visibilidade do site no GitHub Pages. Um repositório privado não garante que seu site Pages seja privado. Se desejar essa publicação, configure **Settings → Pages → GitHub Actions** e execute manualmente a ação marcando **publish_pages**. Por padrão, nenhuma publicação pública ocorre. O conteúdo publicado será exclusivamente `dist/`; banco, sessões, arquivos de usuários e artefatos de testes não são versionados.

```powershell
npm run build
```

Para testar o resultado estático localmente, sirva `dist/` por HTTP; não abra `index.html` diretamente por `file://`. Exemplo, se Python estiver instalado:

```powershell
python -m http.server 4180 --directory dist
```

Abra http://127.0.0.1:4180. O build funciona também em subdiretórios do GitHub Pages. Páginas públicas de serviços têm HTML inicial próprio em `/servicos/advocacia/`, `/servicos/engenharia/` e `/servicos/ti/`.

## Publicar o piloto compartilhado no Netlify

O arquivo `netlify.toml` na raiz configura a publicação automaticamente ao conectar o repositório `Brunorsimas/MVP-solucoes`:

| Configuração | Valor |
| --- | --- |
| Production branch | `main` |
| Base directory | raiz do repositório (`.`) |
| Build command | `npm run build:shared` |
| Publish directory | `dist` |
| Node.js | `24` |

Se um projeto já importado mostrar **Page not found**, execute um novo deploy do último commit depois de atualizar a configuração. O build cria `dist/index.html`; publicar a raiz do código-fonte ou deixar de executar o build não disponibiliza a página inicial correta.

Arrastar apenas `dist/` publica a demonstração estática gerada por `npm run build`, sem banco compartilhado. O piloto compartilhado deve ser publicado junto com suas funções pelo fluxo configurado no repositório, após autorização.

Não use `npm start` como comando de build. A configuração atual do Netlify publica o frontend compartilhado e as funções em `netlify/functions/`, com PostgreSQL via `DATABASE_URL` secreta no servidor. Consulte [o guia de ativação](docs/BANCO-COMPARTILHADO.md) antes de publicar. Sem o banco, a API responde com indisponibilidade; a plataforma não usa armazenamento do navegador como substituto. O build padrão `npm run build` permanece uma demonstração estática para GitHub Pages e não compartilha dados. A navegação usa `#/...` e as páginas públicas de serviços são arquivos HTML reais.

## SEO

- Títulos e descrições, HTML semântico, conteúdos por serviço, páginas públicas pré-renderizadas no build estático, imagens leves e interface adaptada ao celular.
- O ambiente demonstrativo usa `noindex,nofollow` e `robots.txt` bloqueado. Remover essa proteção apenas no lançamento real, depois de revisar dados e conteúdo.
- `SITE_URL` gera URLs canônicas e `sitemap.xml` durante o build. O workflow usa a URL do repositório no GitHub Pages.
- Não há promessas de ranking, avaliações fabricadas ou páginas locais artificiais.
- A sigla DEO não foi definida; não há integração proprietária anunciada com esse nome.

## Prévia local e menu da conta

As alterações de interface devem ser revisadas em uma prévia local antes de qualquer envio ao GitHub. O envio remoto depende de autorização explícita do responsável.

Ao entrar, clique na seta ao lado do nome e da foto no canto superior direito. O menu apresenta **Minha conta** e **Sair** para clientes, especialistas e administrador. Ele fecha ao clicar fora, ao navegar ou ao pressionar Escape; as opções também funcionam por teclado.

Em **Minha conta**, é possível preencher nome, e-mail de contato, telefone, estado e cidade. Os campos de contato são opcionais e privados. O usuário de acesso não muda ao salvar os dados. Especialistas continuam podendo atualizar apresentação e disponibilidade. O formulário mostra o preenchimento do cadastro e preserva os valores salvos ao acessar novamente.

## Testes

```powershell
npm run check
npm test
npm run build
```

Os testes de domínio e HTTP cobrem horário, capacidade, concorrência de aceite, aprovação, pagamento, permissões, CSRF, arquivos privados, recuperação de senha, transferência e retenção.

O teste de navegador usa um Chromium/Edge existente com uma porta CDP isolada. Não instala navegador nem dependências:

```powershell
# Primeiro inicie um navegador de teste isolado com --remote-debugging-port=9333.
node scripts/browser-test.mjs

# Troca de senha, criação de usuário, setor do especialista e exclusão (porta CDP 9345).
node scripts/admin-users-browser-test.mjs
```

O teste cria seu próprio servidor e banco em memória, executa o fluxo completo e salva capturas desktop/mobile e relatório em `artifacts/` (ignorado pelo Git).

## Arquitetura

```text
public/              Interface, estilos, SVGs e domínio compartilhado
  app.js             Telas e interações
  domain.js          Regras e projeções autorizadas dos dados
  demo.js            Adaptador estático, exclusivamente demonstrativo
server.mjs           HTTP, sessões, autenticação, arquivos e SQLite
tests/               Testes de regras e API
scripts/             Build estático e testes de navegador
data/                SQLite local — não versionado
dist/                Build para GitHub Pages — não versionado
```

O domínio é persistido como um documento JSON no SQLite. Cada mutação ocorre dentro de uma transação `BEGIN IMMEDIATE`, sem operações assíncronas no trecho de alteração, para evitar duplicidade de aceite e ultrapassagem de capacidade em um servidor. Contas e sessões têm tabelas próprias. Esse desenho serve ao piloto; grandes volumes exigem dimensionamento, limites, migração para tabelas normalizadas e testes de carga.

## Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORT` | `4173` local / `4189` Neon | Porta HTTP; o padrão muda quando `.env.local` traz as variáveis do Neon |
| `HOST` | `127.0.0.1` | Interface de rede; não expor o modo demo à internet |
| `DATABASE_PATH` | `data/mvp.sqlite` | Caminho do banco |
| `DEMO_MODE` | `1` | Perfis demonstrativos e recuperação simulada; `0` desativa |
| `DEMO_TIME` | `10` | Hora simulada; `real` utiliza o relógio atual |
| `COOKIE_SECURE` | desativado | `1` exige HTTPS no cookie |
| `SITE_URL` | vazio | URL pública para metadados do build |
| `CDP_PORT` | `9333` | Porta do navegador isolado para QA |

`DEMO_MODE=0` não transforma automaticamente o MVP em uma aplicação pronta para produção. Os usuários profissionais demonstrativos não possuem senha provisionada para operação real.

## Retenção e privacidade

O servidor exclui mensagens e anexos vencidos ao iniciar, nas requisições e a cada minuto. O SQLite usa `secure_delete`; após expurgo, o WAL é consolidado. Na versão estática, o expurgo ocorre quando o aplicativo é aberto. Cada conversa transferida tem seu prazo próprio.

Propostas, aprovações e metadados são registros distintos do chat e ainda não têm prazo definitivo de retenção. A política deve ser revisada antes de receber dados reais. Backups externos ou cópias baixadas não são administrados por este MVP; não prometa exclusão dessas cópias sem implantar sua política correspondente.

Administradores não recebem mensagens de outros atendimentos pela API. A manutenção do banco no sistema operacional ainda depende do responsável pelo servidor; controle de acesso na interface não substitui controle de infraestrutura.

## O que ainda depende da preparação para operação real

- Hospedagem paga, HTTPS, domínio e capacidade definida.
- Provedor de e-mail, verificação efetiva de endereço, entrega real da recuperação e alertas.
- Integração oficial de WhatsApp, se desejada. Nenhum contato real foi cadastrado ou divulgado.
- Provisionamento dos profissionais, autenticação em dois fatores e validação de registros/qualificações.
- Varredura antimalware dos anexos; o MVP verifica tipo, assinatura inicial e tamanho, não faz análise antivírus.
- Política aprovada de retenção por categoria, backups com restauração testada e monitoramento operacional.
- Procedimentos de cancelamento após contratação, suporte e eventual acesso excepcional.
- Revisão dos termos, privacidade e regras específicas de cada profissão.

Essas dependências não estão disfarçadas como serviços ativos. Não envie dados pessoais reais, processos, documentos de clientes ou comprovantes bancários reais nesta fase.
