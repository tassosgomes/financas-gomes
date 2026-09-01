# PRD — Gerenciador Financeiro Pessoal

**Versão:** 0.1
**Status:** Requisitos iniciais definidos
**Produto:** Gerenciador Financeiro Web Auto-hospedável

---

## 1. Visão do produto

Criar um gerenciador financeiro pessoal simples, preciso e auto-hospedável que permita organizar renda, despesas, patrimônio e dinheiro reservado sem exigir controle excessivamente detalhado da vida financeira.

O produto deve ajudar o usuário a responder facilmente:

* Para onde meu dinheiro está indo?
* Quanto posso gastar sem comprometer meus planos?
* Quanto tenho reservado para cada finalidade?
* Estou gastando mais ou menos do que planejei?
* Como estarão minhas finanças nos próximos meses?
* Meu patrimônio está evoluindo?
* Estou conseguindo atingir minhas metas?

O sistema deve favorecer uma relação tranquila com o dinheiro:

> **“Sei onde está indo meu dinheiro, sei o que posso gastar, consigo gastar sem peso na consciência e sei que meu futuro financeiro está caminhando bem.”**

---

# 2. Problema

Planilhas permitem grande flexibilidade, mas exigem manutenção manual, fórmulas e esforço recorrente para responder perguntas relativamente simples.

Por outro lado, muitos aplicativos financeiros existentes exigem controle detalhado demais, integrações bancárias ou registro de praticamente cada transação.

O produto deve ocupar o espaço intermediário:

**mais organizado e preciso que uma planilha, mas menos burocrático que um sistema financeiro tradicional.**

O usuário não precisa saber quanto gastou especificamente em cada café, mas deve conseguir entender quanto está consumindo com alimentação, lazer, mercado, transporte e demais áreas relevantes.

---

# 3. Público

Inicialmente, o produto será utilizado em um contexto financeiro pessoal/doméstico.

Deve suportar mais de um usuário, por exemplo:

* usuário principal;
* esposa ou outro membro da família.

Todos os usuários pertencentes à instalação compartilham a mesma realidade financeira.

Existe relação de confiança entre eles.

Na V1:

* não haverá diferentes níveis de permissão;
* não haverá RBAC;
* não haverá necessidade de autorização por operação;
* não haverá trilha de auditoria entre usuários.

Todos os usuários autenticados poderão utilizar integralmente o sistema.

---

# 4. Princípios do produto

## 4.1. Organizar sem burocratizar

O usuário não deve precisar alimentar o sistema diariamente.

A rotina esperada é utilizar o produto aproximadamente **uma vez por semana**, além de consultas ocasionais.

---

## 4.2. Planejamento e realidade coexistem

O sistema não deve substituir valores planejados quando valores reais forem informados.

Os dois precisam continuar disponíveis:

**Planejado / Orçado:** quanto era esperado.

**Realizado:** quanto efetivamente ocorreu.

**Desvio:** diferença entre os dois.

---

## 4.3. Cada real deve ter uma finalidade

A renda recebida deve ser distribuída entre caixinhas utilizando percentuais configurados pelo usuário.

Exemplo:

* 55% Despesas
* 20% Investimentos
* 15% Lazer
* 10% Reserva

A soma da distribuição deve ser **100%**.

---

## 4.4. O dinheiro pode acumular

Caixinhas representam dinheiro reservado e não apenas limites mensais.

Saldos não utilizados permanecem disponíveis nos meses seguintes.

Isso permite comportamentos como economizar em abril para gastar mais em maio devido a:

* aniversário;
* viagem;
* evento;
* compra planejada;
* qualquer outra necessidade futura.

---

## 4.5. O futuro importa

O produto deve mostrar não apenas a situação atual, mas também projetar meses futuros.

Receitas, despesas recorrentes, parcelas, metas e eventos extraordinários devem influenciar essa projeção.

---

## 4.6. Privacidade por padrão

O produto será auto-hospedável.

Nenhuma funcionalidade essencial deverá exigir o envio de informações financeiras para terceiros.

Os dados financeiros permanecerão no banco de dados controlado pelo usuário.

---

# 5. Conceitos principais

## 5.1. Caixinha

Representa uma finalidade para o dinheiro reservado.

Exemplos:

* Despesas
* Lazer
* Investimentos
* Reserva

O sistema deve oferecer sugestões iniciais, mas todas as caixinhas poderão ser:

* criadas;
* renomeadas;
* removidas;
* reconfiguradas.

Cada caixinha possui um percentual de distribuição da renda.

---

## 5.2. Categoria

Representa **para onde o dinheiro foi**.

Exemplos:

* Mercado
* Combustível
* Restaurante
* Assinaturas
* Educação
* Casa
* Entretenimento

Uma categoria poderá possuir uma caixinha padrão.

Exemplo:

**Mercado → Despesas**

**Cinema → Lazer**

Assim, lançamentos rotineiros exigem menos decisões.

---

## 5.3. Tag

Representa uma informação auxiliar que não altera a finalidade financeira do gasto.

Principal caso inicial:

**cartão utilizado.**

Exemplos:

* Bradesco Visa
* Amazon
* BV

Isso permitirá responder perguntas como:

> Quanto gastei no cartão Bradesco este mês?

Sem transformar cartões em categorias financeiras.

---

## 5.4. Meta

Representa um objetivo financeiro associado a uma caixinha.

Exemplo:

**Viagem**

Objetivo: R$ 8.000
Prazo: julho/2027
Valor reservado: R$ 3.200

Uma meta não possui dinheiro independente: ela utiliza recursos de uma caixinha.

O sistema poderá calcular quanto precisa ser reservado mensalmente para atingir o objetivo.

---

# 6. Receitas

O sistema deverá suportar receitas planejadas e realizadas.

Exemplos:

* salário;
* horas extras;
* PLR/PPR;
* 13º salário;
* bônus;
* outras receitas.

## 6.1. Receita recorrente

O usuário poderá cadastrar uma previsão recorrente.

Exemplo:

**Salário esperado: R$ 10.000/mês**

Quando receber efetivamente R$ 11.500 devido a horas extras:

Planejado: R$ 10.000
Realizado: R$ 11.500
Diferença: +R$ 1.500

O valor planejado permanecerá registrado para comparação.

---

## 6.2. Distribuição automática

Quando o valor realizado for informado, a distribuição entre caixinhas será recalculada sobre o valor efetivamente recebido.

Exemplo:

Receita realizada: R$ 11.500

Com:

* 50% despesas;
* 20% investimentos;
* 20% lazer;
* 10% reserva;

o sistema distribuirá os R$ 11.500 utilizando essas proporções.

---

## 6.3. Alteração dos percentuais

Alterações futuras nos percentuais das caixinhas:

* não modificam períodos anteriores;
* passam a valer apenas dali em diante.

O histórico financeiro deve preservar as regras que estavam vigentes no momento correspondente.

---

## 6.4. Receitas extraordinárias

Receitas como PLR e 13º poderão ser cadastradas antecipadamente.

Exemplo:

**13º — dezembro — R$ 8.000 previsto**

Quando o pagamento acontecer, o usuário informa o valor realizado.

---

# 7. Despesas

## 7.1. Despesas fixas/recorrentes

O usuário poderá cadastrar uma despesa uma única vez e definir sua recorrência.

Exemplo:

**Internet — R$ 120/mês**

Ela aparecerá automaticamente nos meses futuros.

O realizado poderá ser alterado caso o valor efetivamente pago seja diferente.

---

## 7.2. Orçamentos variáveis

Categorias como Mercado não precisam representar uma conta fixa.

Exemplo:

**Mercado**

Orçamento mensal: R$ 1.500

Realizado: R$ 1.320

Disponível dentro do orçamento: R$ 180

O sistema não deve obrigar o usuário a cadastrar individualmente cada compra.

Quando desejar maior precisão, entretanto, o usuário poderá lançar várias despesas dentro da mesma categoria.

---

## 7.3. Parcelamentos

Compras parceladas serão cadastradas uma única vez.

Exemplo:

**Notebook — R$ 6.000 — 10x de R$ 600 — início em setembro**

O sistema gerará automaticamente as ocorrências futuras.

Cada parcela deverá ser considerada nas projeções correspondentes.

---

## 7.4. Cartões

Na V1, cartões não serão entidades financeiras complexas.

Não haverá inicialmente:

* gestão de fatura;
* limite de cartão;
* fechamento;
* vencimento;
* pagamento da fatura;
* reconciliação.

O cartão poderá ser representado por uma **tag**.

O objetivo é permitir agrupamentos e relatórios.

---

# 8. Transferências entre caixinhas

O usuário poderá movimentar dinheiro entre caixinhas.

Exemplo:

Transferir R$ 300:

**Lazer → Despesas**

A operação deverá atualizar os respectivos saldos mantendo o histórico da movimentação.

---

# 9. Fechamento mensal

Um mês poderá possuir os estados:

* aberto;
* fechado.

No fechamento:

* valores restantes das caixinhas continuam disponíveis;
* o saldo é carregado para os próximos períodos;
* o histórico daquele mês permanece acessível.

Um mês fechado poderá ser reaberto.

Caso uma alteração retroativa afete meses posteriores, o sistema deverá alertar o usuário e recalcular as projeções necessárias.

---

# 10. Projeções

O sistema deverá permitir navegação indefinida pelos meses futuros.

Não haverá limite conceitual de 12 meses.

O usuário poderá acessar, por exemplo, março de 2028 e visualizar a situação projetada com base nas informações conhecidas.

A projeção deverá considerar:

* saldo anterior;
* receitas recorrentes;
* receitas extraordinárias previstas;
* despesas recorrentes;
* orçamentos;
* parcelamentos ativos;
* despesas extraordinárias futuras;
* distribuição das caixinhas;
* metas.

Conceitualmente:

**Saldo anterior + receitas previstas − despesas previstas = saldo projetado**

---

# 11. Despesas futuras

O usuário poderá registrar acontecimentos financeiros antecipadamente.

Exemplo:

**Viagem — dezembro — R$ 3.000**

A projeção de dezembro deverá imediatamente refletir esse gasto.

Caso exista uma meta relacionada, o sistema deverá conseguir mostrar:

* valor esperado;
* valor já reservado;
* valor ainda necessário.

---

# 12. Metas financeiras

Uma meta possuirá pelo menos:

* nome;
* valor alvo;
* prazo;
* caixinha relacionada;
* valor reservado/progresso.

Exemplo:

**Viagem**

Meta: R$ 8.000
Prazo: julho/2027
Reservado: R$ 3.200
Faltam: R$ 4.800

O sistema poderá informar a reserva mensal necessária para atingir o objetivo no prazo desejado.

---

# 13. Patrimônio

Patrimônio será parte da V1.

A intenção não é criar uma plataforma de investimentos, mas oferecer uma visão reconfortante da evolução financeira do usuário.

Ativos poderão incluir:

* dinheiro;
* reserva financeira;
* investimentos;
* previdência;
* veículos;
* imóveis;
* outros bens.

Investimentos poderão possuir categorias, mas não haverá controle individual de cada ativo financeiro na V1.

---

# 14. Dívidas

O sistema deverá permitir cadastrar passivos como:

* financiamentos;
* empréstimos;
* dívidas relevantes.

Assim será possível apresentar:

**Patrimônio líquido = ativos − passivos**

---

# 15. Histórico patrimonial

Quando o usuário atualizar o valor de um patrimônio, o sistema deverá preservar automaticamente os valores anteriores.

Exemplo:

Janeiro: R$ 100.000
Fevereiro: R$ 103.000
Março: R$ 105.000

O usuário não deverá precisar cadastrar manualmente a variação patrimonial.

O sistema deverá conseguir apresentar a evolução ao longo do tempo através de histórico e gráficos.

---

# 16. Dashboard

O dashboard deverá privilegiar clareza e tranquilidade.

Deverá apresentar pelo menos:

* saldo atual;
* receitas planejadas x realizadas;
* despesas planejadas x realizadas;
* saldo das caixinhas;
* patrimônio total;
* patrimônio líquido;
* projeções futuras;
* alertas relevantes.

---

# 17. Visualização das caixinhas

Cada caixinha deverá apresentar informações semelhantes a:

**Lazer**

Saldo acumulado: R$ 1.850
Planejado para o mês: R$ 1.000
Realizado no mês: R$ 650

A interface deverá permitir entender tanto:

* o comportamento no mês;
* quanto dinheiro continua reservado.

---

# 18. Alertas

O sistema poderá chamar atenção para situações como:

* orçamento próximo do limite;
* orçamento ultrapassado;
* caixinha com pouco saldo;
* mês futuro projetado negativo;
* receita prevista ainda não realizada;
* gasto significativamente diferente do planejado;
* parcela próxima do término;
* meta fora do ritmo necessário.

Os alertas devem orientar, e não gerar sensação de punição.

O uso de estados visuais como normal, atenção e crítico deve ser equilibrado.

---

# 19. Relatórios

O produto deverá conseguir responder facilmente:

1. Quanto recebi neste mês?
2. Quanto gastei?
3. Para onde meu dinheiro foi?
4. Quanto sobrou em cada caixinha?
5. Quanto estou reservando para investimentos?
6. Quanto meu patrimônio cresceu?
7. Quais são meus maiores gastos?
8. Como serão meus próximos meses?
9. Quanto tenho comprometido em parcelas?
10. Quanto gastei utilizando cada cartão/tag?

---

# 20. Comparação histórica

Categorias poderão ser comparadas entre períodos.

Exemplo:

**Mercado**

Junho: R$ 1.200
Julho: R$ 1.450
Agosto: R$ 1.320

O sistema também deverá conseguir calcular médias históricas, incluindo períodos como:

* últimos 3 meses;
* últimos 6 meses;
* últimos 12 meses.

---

# 21. Fluxo semanal principal

A utilização rotineira deverá exigir poucas ações.

A tela principal deverá oferecer acesso rápido a operações como:

**Adicionar receita**

**Adicionar despesa**

**Transferir entre caixinhas**

**Atualizar patrimônio**

A expectativa é que o usuário consiga manter as informações atualizadas utilizando o produto aproximadamente uma vez por semana.

---

# 22. Primeiro acesso

O primeiro acesso poderá apresentar um assistente de configuração.

Etapas sugeridas:

1. criar/configurar caixinhas;
2. definir percentuais;
3. informar renda mensal esperada;
4. cadastrar despesas recorrentes;
5. informar patrimônio inicial.

Qualquer etapa poderá ser ignorada e configurada posteriormente.

---

# 23. Autenticação

O sistema deverá exigir autenticação.

Deverá ser possível cadastrar mais de um usuário.

Na V1, usuários possuem confiança mútua e acesso equivalente.

Não fazem parte da V1:

* perfis de acesso;
* permissões;
* aprovação de operações;
* auditoria por usuário;
* segregação financeira entre usuários.

---

# 24. Desktop e mobile web

O produto será desenvolvido prioritariamente para uso em desktop.

A experiência deverá ser:

* simples;
* limpa;
* direta;
* com baixa carga cognitiva.

A V1 **não terá aplicativo nativo** e não será projetada com abordagem mobile-first.

Entretanto, a aplicação web deverá ser suficientemente responsiva para permitir consultas ocasionais na rua através do navegador do celular.

Exemplos:

* consultar saldo de uma caixinha;
* consultar orçamento disponível;
* verificar projeções;
* consultar alguma informação financeira rapidamente.

Uma experiência mobile completa será considerada evolução futura.

---

# 25. Exportação

O usuário deverá possuir controle sobre seus próprios dados.

A V1 deverá oferecer exportação dos dados financeiros pelo menos em **CSV**.

Formatos adicionais poderão ser avaliados futuramente.

---

# 26. Backup

Por ser um produto auto-hospedado e armazenar informações importantes, backups são requisito relevante.

O produto deverá permitir uma estratégia automatizada e recorrente de backup para armazenamento externo controlado pelo usuário.

Exemplos de destino incluem armazenamento compatível com S3, como S3 ou R2.

A definição técnica exata do mecanismo ficará para a etapa de arquitetura.

---

# 27. Edição e exclusão

Lançamentos poderão ser:

* criados;
* editados;
* excluídos.

Ao alterar um dado histórico que tenha impacto futuro, o sistema deverá recalcular os valores dependentes.

Alterações em períodos fechados deverão gerar um aviso apropriado.

---

# 28. Requisitos de experiência

O produto deve evitar:

* formulários excessivamente longos;
* quantidade exagerada de campos obrigatórios;
* linguagem contábil desnecessária;
* controle granular imposto ao usuário;
* excesso de dashboards e indicadores;
* sensação de estar “prestando contas” ao sistema.

A experiência desejada é:

**registrar pouco, entender muito.**

---

# 29. Fora do escopo da V1

Não fazem parte da V1:

* integração bancária;
* Open Finance;
* importação automática de extrato;
* alimentação automática através de IA;
* MCP;
* categorização automática por GPT;
* importação da planilha existente;
* controle de investimento ativo por ativo;
* cotação automática de investimentos;
* gestão sofisticada de cartões;
* controle empresarial;
* emissão de boletos;
* emissão de notas fiscais;
* funcionalidades contábeis;
* permissões avançadas;
* auditoria;
* aplicativo iOS;
* aplicativo Android;
* experiência mobile-first.

---

# 30. Possíveis evoluções — V2/V3

## Automação financeira

Integração via MCP/IA para interpretar extratos e sugerir ou criar lançamentos.

Fluxo conceitual:

**Extrato → GPT → identificação → categorização → lançamento no gerenciador**

Esse fluxo deverá respeitar os princípios de privacidade estabelecidos pelo produto.

---

## Experiência mobile

Uma versão futura poderá oferecer uma experiência realmente otimizada para celular e eventualmente aplicativo nativo.

---

## Integrações financeiras

Poderão ser avaliadas posteriormente:

* Open Finance;
* bancos;
* corretoras;
* cartões;
* investimentos.

Nenhuma delas é necessária para validar a proposta central do produto.

---

# 31. Métricas de sucesso da V1

Como se trata inicialmente de um produto pessoal, as métricas devem avaliar utilidade, e não crescimento.

A V1 será considerada bem-sucedida se:

* o usuário abandonar a planilha como ferramenta principal;
* uma atualização semanal levar poucos minutos;
* for possível entender rapidamente quanto ainda pode ser gasto;
* projeções futuras forem confiáveis;
* o planejamento e realizado puderem ser comparados facilmente;
* saldos das caixinhas forem compreensíveis;
* patrimônio líquido puder ser acompanhado ao longo do tempo;
* despesas importantes puderem ser identificadas sem registrar todas as pequenas compras;
* o produto transmitir sensação de controle, e não de burocracia.

---

# 32. Critério central de produto

Sempre que houver conflito entre adicionar uma funcionalidade e preservar simplicidade, deve-se perguntar:

> **Essa funcionalidade ajuda o usuário a entender melhor seu dinheiro sem aumentar significativamente o trabalho necessário para manter o sistema atualizado?**

Se a resposta for não, provavelmente ela não pertence ao núcleo do produto.

---

# 33. Resumo da proposta

O Gerenciador Financeiro será um sistema pessoal/doméstico baseado em quatro pilares:

### Organizar

Entender receitas, despesas e para onde o dinheiro está indo.

### Reservar

Distribuir automaticamente a renda entre caixinhas e acumular recursos para diferentes finalidades.

### Planejar

Comparar planejado versus realizado e visualizar meses futuros, parcelas, despesas extraordinárias e metas.

### Evoluir

Acompanhar patrimônio líquido e garantir que decisões do presente estejam contribuindo para um futuro financeiro saudável.

A proposta não é registrar cada centavo.

A proposta é possuir informação suficiente para tomar decisões financeiras com confiança.
