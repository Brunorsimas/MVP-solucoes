# Brechas que podem gerar lucro

**Data:** 30/10/2026
**Escopo:** leitura de investidor sobre o repositório completo, com verificação em produção.
**Resumo:** a engenharia está acima da média para o estágio; o modelo de negócio não existe. Hoje a plataforma é tecnicamente capaz e comercialmente neutra — por decisão publicada, não por esquecimento.

---

## O ponto de partida

`public/app.js:189`, texto da página "Como funciona", visível a qualquer visitante:

> "Você acompanha cada passo, com transparência e **sem comissão da plataforma**."
> "O pagamento é feito diretamente ao profissional. A plataforma não processa transações."

Isso não é uma lacuna de implementação. É uma promessa publicada ao usuário, com peso contratual. Take rate zero, por escrito.

Teto atual: 9 especialistas × 3 chamados simultâneos (`domain.js:171`) = **27 atendimentos em paralelo**, com 0% de captura. Receita máxima do software hoje: **R$ 0**.

As brechas abaixo estão ordenadas por retorno sobre esforço.

---

## 1. O ativo real: trilha de negociação auditada

**Esta é a tese mais forte do repositório.**

O que foi construído sem ser o objetivo declarado: um registro completo e defensável de negociação profissional.

| Peça | Onde |
| --- | --- |
| Proposta versionada, com contraproposta | `domain.js:405-412` |
| Validade com vencimento automático | `proposalExpired`, `proposalExpiresAt` |
| Aprovação obrigatória da outra parte | `domain.js:413-426` |
| Comprovante conferido contra a proposta vigente | `domain.js:431-438` |
| Conclusão bloqueada sem pagamento confirmado | `domain.js:439-441` |
| Auditoria de cada ação | `state.audit`, `record()` |
| Retenção de 360 dias dos perfis removidos | `DELETED_RETENTION_DAYS` |

Escritório de advocacia e de engenharia no Brasil negocia por WhatsApp e e-mail. Em disputa com o cliente, não prova o que foi combinado, quando, nem por qual valor.

**Como lucrar:** vender ao escritório, não ao consumidor. Assinatura mensal de um sistema de atendimento com trilha auditável.

- Faixa: R$ 149–499/mês, por escritório ou por usuário.
- 40 escritórios a R$ 299 = **R$ 11.960/mês recorrente**.
- Não depende de volume de consumidor, nem de marketing caro, nem resolve galinha-e-ovo.
- O código já cobre cerca de 80% disso.

**Falta:** multi-tenant (hoje é uma instância e um estado global), marca por cliente, relatório gerencial, exportação.

---

## 2. Comissão sobre transação

A brecha mais óbvia de um marketplace — e a mais difícil aqui.

Referência de mercado: 10% a 20% de take rate. Com ticket médio de R$ 800 e 15%, cada atendimento rende R$ 120.

**O obstáculo é estrutural.** A plataforma optou por não tocar no dinheiro: o cliente paga por fora e anexa o comprovante. Nada impede as duas partes de combinarem fora da plataforma na segunda conversa. É o *leakage* clássico, e aqui ele é integral — não existe nem atrito, nem incentivo para permanecer.

**Como fechar:** integrar um PSP (Asaas, Pagar.me, Stripe Connect) com **split automático** e retenção em custódia. O dinheiro entra na plataforma e sai para o profissional já descontada a comissão.

**Custo real:** 4 a 8 semanas, adequação regulatória, conta de pagamento e reescrita dos Termos de uso — que hoje prometem o contrário.

Sem controlar o fluxo financeiro, qualquer comissão é pedido de favor com boleto.

---

## 3. Lead qualificado por chamado aceito

Cobrar do especialista, não do cliente. R$ 15–40 por chamado aceito; advocacia suporta valor maior.

**Vantagem:** não exige tocar em dinheiro de transação. Implementação: carteira pré-paga e débito no momento do aceite (`domain.js:360-366`, ponto único). Semanas, não meses.

**Desvantagem:** alinha o incentivo errado — a plataforma passa a ganhar com volume, não com qualidade do atendimento. E o teto é baixo: 27 chamados simultâneos não sustentam uma equipe.

Serve como receita-ponte, não como modelo.

---

## 4. Assinatura do especialista

Plano grátis com capacidade 2; plano pago com capacidade maior, destaque na vitrine e selo de verificado.

Elegante porque **a trava já está codificada**: `professionalCapacity()` (`domain.js:171`) retorna 2 ou 3 conforme o perfil esteja completo. Transformar em plano é alterar uma função.

**Condição:** só funciona depois de existir demanda real. Ninguém paga por destaque em vitrine sem visitantes. Guardar para a fase 2.

---

## 5. Verificação OAB/CREA como produto

Hoje é passivo: `docs/ANALISE-MVP-PARA-PRODUCAO-2026-10-21.md:130` aponta a ausência de validação de registro como risco regulatório, e o cartão do especialista admite que as qualificações não foram verificadas.

Invertendo: selo de verificado é exatamente o que o cliente de advocacia procura antes de confiar. Converte obrigação regulatória em diferencial comercial, e pode ser cobrado do especialista como parte do plano.

**Observação:** advocacia é atividade regulada. Essa verificação deixa de ser oportunidade e vira requisito no momento em que houver atendimento pago real.

---

## 6. Licenciar o núcleo de atendimento

O repositório carrega 89 testes automatizados, auditoria de segurança, de privacidade e de TI, além de hardening específico contra abuso administrativo (`tests/admin-hardening.test.mjs`).

Para quem está montando um marketplace vertical e não quer construir o fluxo de proposta, comprovante e retenção do zero, isso tem valor de licenciamento.

Teto baixo e esforço quase nulo. Vale mencionar apenas se aparecer o comprador certo — não é estratégia de crescimento.

---

## O que derruba o valuation

Corrigir antes de qualquer conversa com investidor ou cliente pagante.

| Risco | Severidade | Onde |
| --- | --- | --- |
| Sem verificação OAB/CREA — advocacia é atividade regulada | **Crítico** | Nenhuma validação no código |
| Sem e-mail transacional: recuperação de senha não funciona | Alto | Nenhum provider integrado |
| Estado inteiro da aplicação em **uma linha JSONB**, anexos em base64 dentro | Alto | `database/schema.mjs:3` |
| LGPD incompleta: sem exportação, sem exclusão a pedido, termos não versionados | Alto | Item 5 da análise de produção |
| Pagamento fora da plataforma: leakage integral | Alto | Decisão de produto |
| Zero defensibilidade: nada aqui é difícil de copiar | Alto | — |
| Mercado endereçável estreito: PE + Belém, 3 setores | Médio | `domain.js:1-5`, regiões fixas no código |

O ponto do JSONB merece tradução comercial: **as escritas são serializadas globalmente** (`postgres-store.mjs:25`, `SELECT ... FOR UPDATE`). Duas pessoas em chamados sem nenhuma relação esperam uma pela outra. O sistema não cresce com servidor maior — exige reescrita do modelo de dados antes de qualquer tração.

### Corrigido em 30/10/2026

O acesso de demonstração estava ativo em produção: `POST /api/auth/test-login` aceitava qualquer um dos nove perfis com a senha `123`, dando leitura de chamados, conversas e anexos alheios. `TEST_LOGIN_ENABLED` passou a `"0"` em `neon.ts` e a Function foi republicada; a rota agora responde `403`. A tela de acesso publicada nunca listou os logins — `public/app.js:197` já os ocultava fora do modo local.

---

## Como vender

As duas primeiras teses são incompatíveis no curto prazo. Escolher uma.

### Tese A — SaaS para escritórios (recomendada)

**Para quem:** escritórios de advocacia e engenharia de 3 a 20 pessoas, em Recife e Belém.

**Discurso:** "Seu escritório atende cliente pelo WhatsApp. Quando dá problema, você não prova o que foi combinado. Aqui cada proposta tem versão, validade, aprovação registrada e comprovante conferido."

**Canal:** venda direta. A rede pessoal do time vale mais que anúncio. Vinte reuniões presenciais valem mais que qualquer campanha.

**Preço:** R$ 299/mês até 5 usuários; R$ 599 até 15. Primeiro mês grátis, sem cartão.

**Primeiros 10 clientes:** de graça, em troca de depoimento e uso do nome. Nessa fase não se vende software — compra-se evidência.

**Meta de 6 meses:** 30 escritórios pagantes, R$ 9.000 a R$ 18.000/mês recorrente.

### Tese B — Marketplace de consumidor

**Problema estrutural:** mercado de dois lados, aquisição cara, leakage integral, e concorrência direta com Jusbrasil, GetNinjas, Habitissimo e o próprio Google. Exige capital de marketing antes de qualquer receita.

**Só funciona com nicho estreito.** Não "advocacia", mas "rescisão trabalhista em Recife, resposta em 24h". Nicho profundo vence marketplace largo.

**Honestamente:** esta tese precisa de dinheiro de fora. A Tese A se paga sozinha.

### Tese C — Agência de serviço (o que já existe de fato)

O time já reúne especialistas de advocacia, engenharia e TI. O software é ferramenta interna, não produto.

Vende-se **resultado**, não software. Margem sobre o serviço prestado, não comissão de intermediação.

Receita imediata, sem rodada, sem PSP e sem verificação de registro no código — porque cada especialista responde pelo próprio. O sistema fica como vantagem operacional e, depois, vira produto já validado em uso real.

---

## Sequência recomendada

1. **Operar a Tese C por 90 dias.** Atender clientes reais usando o próprio sistema. É o único jeito honesto de descobrir se a trilha de proposta resolve dor real.
2. **Se resolver, migrar para a Tese A.** Multi-tenant, cobrança por assinatura, venda para escritórios vizinhos.
3. **Adiar comissão até existir PSP com split.** Antes disso, não é cobrável.
4. **Não captar agora.** Um cheque hoje precifica um MVP sem receita; com 30 escritórios pagando, precifica um SaaS.

A engenharia está à frente do modelo de negócio. É o problema bom de ter — o inverso não tem conserto.
