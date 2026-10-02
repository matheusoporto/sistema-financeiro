# Telegram no MoneyRestly

A integração é direta: Telegram → webhook HTTPS → chatbot → SQLite da conta. Não exige n8n nem chave de IA. O interpretador atual usa regras em português; reconhece gastos, parcelas, categorias, correções, desfazer e relatórios em texto. Áudio, imagens e prints de relatórios não estão incluídos.

## 1. Antes de atualizar no Railway

Faça backup do banco existente e confira o volume persistente. Contas, gastos e vínculos ficam no SQLite, não no GitHub. Use uma única réplica do serviço com este banco.

Se já existe `MONEYRESTLY_DB`, mantenha seu caminho. Se ainda usa `FINANTO_DB`, renomeie a variável para `MONEYRESTLY_DB` mantendo o valor: mudar o caminho sem copiar o banco abriria outro banco vazio. Um banco com nome antigo funciona normalmente quando seu caminho é informado explicitamente.

Para uma instalação nova: monte o volume em `/data` e defina `MONEYRESTLY_DB=/data/moneyrestly.sqlite`. Para uma instalação existente, não altere o volume ou caminho sem migrar o banco. [Volumes no Railway](https://docs.railway.com/volumes).

## 2. Configurar as variáveis do serviço

Em Railway → seu serviço → Variables, configure:

| Variável | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token fornecido pelo BotFather; somente no servidor |
| `TELEGRAM_BOT_USERNAME` | Username do bot, sem `@`, e não seu nome de exibição |
| `TELEGRAM_WEBHOOK_SECRET` | Segredo aleatório independente, com 32 a 256 caracteres de letras, números, `_` e `-` |
| `PUBLIC_ORIGIN` | Endereço HTTPS atual do site, sem barra final, por exemplo `https://seu-site.up.railway.app` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `MONEYRESTLY_DB` | Caminho do banco no volume persistente, conforme a etapa anterior |

Mantenha a porta `PORT` fornecida pelo Railway. O projeto requer Node.js 24 ou superior. Para gerar o segredo no seu computador:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado para `TELEGRAM_WEBHOOK_SECRET`. Não coloque token ou segredo no código, no GitHub ou em mensagens de chat. [Variáveis do Railway](https://docs.railway.com/variables).

## 3. Publicar e ativar o webhook

Faça commit e push das alterações, aguarde o deploy do Railway e confirme que o site abre normalmente. O comando de inicialização continua sendo `npm start`.

Na CLI do Railway, entre na conta, selecione o projeto/serviço e abra uma sessão no contêiner com `railway ssh`. O painel também permite copiar o comando SSH do serviço. Dentro do contêiner, na pasta do projeto, execute:

```sh
npm run telegram:setup
```

O comando verifica se o token corresponde ao username, registra `/api/telegram/webhook` com o segredo e confirma o endereço registrado. Não imprime o token. Não o execute com o endereço de um servidor de teste: um bot tem apenas um webhook ativo. Repita a configuração se mudar o domínio ou o segredo. [Railway SSH](https://docs.railway.com/cli/ssh) · [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook).

## 4. Vincular cada usuário

1. Entre na conta pessoal do MoneyRestly.
2. No menu, clique em **Conectar Telegram** e depois em **Gerar link de conexão**.
3. Clique em **Abrir Telegram e conectar** e toque em **Iniciar / Start** no bot.
4. Aguarde a confirmação do bot. No site, clique em **Atualizar status**.
5. Envie `Gastei 85,90 no mercado via Pix` e confira o gasto no painel.
6. Experimente `relatório deste mês` ou `Comprei um celular por 1200 no crédito em 6 parcelas, categoria Online`.

O link expira em 10 minutos, só funciona uma vez e é guardado como hash no banco. Um Telegram só pode estar vinculado a uma conta; cada conta só pode ter um Telegram. Nunca compartilhe o link: ele concede acesso aos dados da conta. Para trocar de Telegram, use **Desconectar Telegram** no site antes de gerar outro link. A desconexão também cancela links pendentes.

O vínculo usa o identificador numérico enviado pelo Telegram, não o username digitado numa mensagem. Grupos, canais, mensagens editadas e mensagens de bots não são processados. [Deep linking oficial](https://core.telegram.org/bots/features#deep-linking).

## Comportamento e diagnóstico

- Chat do site e Telegram compartilham a conversa da conta. Uma pergunta pendente pode ser respondida em qualquer um deles. No crédito, a primeira fatura continua no mês seguinte.
- O webhook valida `X-Telegram-Bot-Api-Secret-Token`; um POST manual sem esse segredo retorna 403. Não usa cookie de login do site.
- Cada `update_id` fica registrado no banco junto com o processamento do gasto, na mesma transação. Reenvios e reinicializações não duplicam lançamentos. O identificador é preservado mesmo após a limpeza dos recibos do chat.
- Falhas de envio retornam 503 para o Telegram tentar novamente. Em um timeout após o Telegram aceitar a resposta, o texto da resposta pode se repetir; o gasto não se repete.
- Se o menu informar que a integração está indisponível, configure as três variáveis TELEGRAM e publique as mudanças. Configuração parcial impede a inicialização para evitar uma integração sem validação.
- Se o bot não responder, confirme deploy, domínio HTTPS, segredo, token e configuração do webhook. Não use polling/getUpdates ao mesmo tempo que o webhook.
- O teste real com seu bot depende das variáveis e do deploy. Os testes automatizados usam um Telegram simulado e não enviam mensagens reais.
