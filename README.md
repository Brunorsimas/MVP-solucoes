# MVP Soluções

Plataforma demonstrativa de atendimento em **Advocacia, Engenharia Civil e Tecnologia da Informação**, com cobertura inicial em Pernambuco e Belém–PA. Bruno administra a operação e participa da equipe de TI. Sem comissão da plataforma e sem pagamento integrado.

## Executar o MVP funcional

Requisito: **Node.js 24 ou superior**. Não é necessário instalar pacotes: servidor, SQLite, autenticação e testes usam módulos nativos.

```powershell
cd E:\Devs\Projetos\Albinur\mvp-solucoes
npm start
```

Abra **http://127.0.0.1:4173**. Em **Entrar → Experimentar**, escolha um perfil. Para acompanhar os dois lados de um chamado, use **Trocar perfil**. Os dados ficam em `data/mvp.sqlite`; reiniciar o servidor preserva os registros.

O servidor fica restrito ao computador local por padrão. O expediente de demonstração é **10h**, claramente indicado na interface, para permitir testes em qualquer horário. Para usar o relógio real:

```powershell
$env:DEMO_TIME = 'real'
npm start
```

O expediente real aceita solicitações de **08:00 até antes das 19:00**, no fuso `America/Recife`. O piloto considera todos os dias, pois não foi definida restrição de dias da semana. Esse comportamento deve ser confirmado antes do lançamento real.

## Equipe de demonstração

| Perfil | Especialidades |
| --- | --- |
| Ana Oliveira | Cliente fictícia para testes |
| Tayane | Advocacia geral |
| Miguel | Direito criminal |
| Feuzer | Advocacia geral |
| Marcos | Engenharia civil |
| Maria | Engenharia civil |
| Bruno | Suporte, conserto e montagem de computadores; administrador |
| Stefanny | Desenvolvimento de software |
| Kleber | Engenharia de dados e suporte técnico |

Perfis profissionais são demonstrativos, sem OAB, CREA, certificações, fotos ou avaliações inventadas. Todos estão inicialmente disponíveis nas regiões do piloto; a cobertura individual precisa ser validada antes de uso real.

## Funcionalidades implementadas

- Interface responsiva, identidade visual própria, navegação acessível e recursos SVG locais.
- Páginas de setores, diretório de especialistas, busca por nome/especialidade, ajuda, termos e privacidade.
- Formulário em três etapas, perguntas por serviço e rascunho no navegador.
- Cadastro de clientes, login por senha com hash scrypt e cookies HttpOnly; recuperação simulada em ambiente de teste.
- Perfis demonstrativos selecionáveis para experimentar cliente, especialista e administrador.
- Encaminhamento por especialidade, região, modalidade, disponibilidade e situação do perfil.
- Aceite exclusivo e limite transacional de **dois chamados ativos por profissional**, incluindo projetos de engenharia.
- Chat privado com atualização a cada cinco segundos e histórico persistente no servidor local.
- Anexos privados em PDF, PNG e JPG, limitados a 2 MB por arquivo e 15 por conversa.
- Propostas versionadas com escopo, exclusões, valor, prazo, validade e condições de pagamento.
- Aprovação vinculada à versão exata da proposta, registrada com usuário e data.
- Proposta e confirmação de agendamentos, exibidos no horário de Brasília.
- Comprovante anexado pelo cliente; recebimento declarado pelo profissional antes da conclusão.
- Cancelamento direto antes da primeira interação profissional; suporte para encerramentos posteriores.
- Novo encaminhamento antes da contratação, sem compartilhar automaticamente a conversa anterior.
- Exportação do histórico em texto e download individual dos anexos.
- Exclusão de mensagens e anexos após 30 dias do encerramento de cada conversa.
- Notificações internas e indicação explícita de alertas externos simulados.
- Avaliação interna de atendimentos concluídos, central de suporte, gestão de disponibilidade e suspensão de profissionais.
- Painel administrativo com metadados operacionais e auditoria, sem leitura geral de chats privados.

## Roteiro para testar o fluxo completo

1. Entre como **Ana Oliveira**. Crie um chamado em TI → Suporte técnico, Recife, remoto.
2. Troque para **Bruno**, abra a fila e aceite o chamado. Envie uma mensagem e uma proposta.
3. Troque para **Ana** e aprove a proposta. Combine um horário se desejar.
4. Troque para **Bruno**, inicie a execução e registre a entrega.
5. Troque para **Ana** e anexe um comprovante fictício em PDF, PNG ou JPG.
6. Troque para **Bruno**, confirme o recebimento e conclua.
7. Confira a data de expiração do histórico, exporte a conversa e experimente a avaliação como cliente.

Para testar a capacidade, abra três chamados compatíveis e tente aceitar os três com o mesmo profissional. O terceiro deve ser bloqueado. Para testar transferência, devolva um chamado antes da contratação e assuma com outro profissional compatível.

## Duas versões, usos diferentes

| Versão | Persistência | Uso |
| --- | --- | --- |
| Servidor local (`npm start`) | SQLite no servidor; compartilhamento entre sessões autorizadas | Testar autenticação, permissões e fluxo funcional |
| GitHub Pages (`npm run build`) | Somente localStorage/sessionStorage do navegador | Demonstrar interface e interações com dados fictícios |

**A demonstração estática não é um backend multiusuário nem um ambiente seguro para dados reais.** Qualquer pessoa com acesso ao mesmo navegador pode acessar os dados de demonstração. O cadastro por senha exige o servidor local. Trocar de perfil simula os participantes de uma conversa.

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

## SEO

- Títulos e descrições, HTML semântico, conteúdos por serviço, páginas públicas pré-renderizadas no build estático, imagens leves e interface adaptada ao celular.
- O ambiente demonstrativo usa `noindex,nofollow` e `robots.txt` bloqueado. Remover essa proteção apenas no lançamento real, depois de revisar dados e conteúdo.
- `SITE_URL` gera URLs canônicas e `sitemap.xml` durante o build. O workflow usa a URL do repositório no GitHub Pages.
- Não há promessas de ranking, avaliações fabricadas ou páginas locais artificiais.
- A sigla DEO não foi definida; não há integração proprietária anunciada com esse nome.

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
| `PORT` | `4173` | Porta HTTP |
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
