---
impacto: capacidade_nova
secao: adicionado
titulo: Automações com palavra-chave e teste, fluxos com botões, links rastreados, valores da empresa, pontuação e resumo de campanha
---

As automações ganharam o gatilho "Quando chegar mensagem com palavra-chave" (contém,
exata ou começa com, ignorando acentos) e as ações "Pausar a IA nesta conversa" e
"Enviar conversão para plataforma de anúncio". O editor tem o botão Testar, que
simula a regra com um contato sem enviar nada, uma lista do que falta para ela
estar pronta para ativar e o histórico de execuções.

Os fluxos de follow-up ganharam os passos Botões, Lista, Webhook (assinado com
HMAC), Transferir e Passar para a IA. No WhatsApp oficial, botões e listas
aparecem como botões; nos outros canais, como lista numerada. Um roteiro de
atendimento pode ser marcado como "resposta pronta" e responde sem chamar o
modelo de IA.

`{{link:https://…}}` numa mensagem vira um link curto rastreado por contato. A
tela Links de saída mostra quem clicou, por campanha e por contato. Em
Configurações › Valores personalizados a empresa guarda textos como PIX, endereço
e horário e os usa como `{{empresa.chave}}` em qualquer mensagem.

Em Configurações › Pontuação do lead, regras dão pontos por resposta, agendamento,
orçamento, etapa ou tag. O total e o extrato aparecem no negócio, ao lado do
score. A nova campanha mostra, antes de salvar, quantos recebem, o limite do
número, a janela, o ritmo e a duração estimada.

Também há telas de conexão com o GA4 e o TikTok, mas elas ainda não enviam as
vendas: o envio segue indo só para a plataforma que trouxe o contato, e hoje
nenhum contato fica marcado como vindo do GA4 ou do TikTok.

Nenhuma ação é necessária na atualização.
