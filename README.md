# Orçaviva

Orçamento + vida: mais clareza para os seus próximos planos.

Controle financeiro pessoal com cadastro, login, recuperação de senha por e-mail, tour inicial, categorias personalizadas, orçamento e parcelas distribuídas entre os meses. Interface em HTML/CSS/JavaScript; servidor Node.js com banco SQLite persistente e Nodemailer para SMTP.

## Iniciar

É necessário Node.js 24 ou superior. Dentro da pasta `sistema-financeiro`, execute:

```powershell
npm.cmd install
npm.cmd start
```

Também é possível executar `node server.cjs` ou abrir **iniciar-orcaviva.cmd** no Windows depois de instalar as dependências. Acesse **http://localhost:3000** e escolha **Criar conta**. Não existe usuário ou senha padrão. O cadastro exige nome, e-mail único, usuário e senha. O usuário aceita de 3 a 30 letras, números, pontos, traços ou sublinhados; a senha deve ter entre 8 e 128 caracteres e pelo menos um caractere especial, como `!`, `@` ou `#`. Espaço e letras acentuadas não contam como caractere especial.

Esta versão precisa do servidor em execução. Abrir `index.html` diretamente apresenta as instruções de acesso e permite exportar dados da versão anterior.

## E-mail e recuperação de senha

O fluxo de recuperação está implementado, mas o envio real precisa das credenciais de uma conta remetente. O padrão sugerido para este projeto pessoal é Gmail com senha de app e TLS na porta 465. O mesmo código aceita outros serviços SMTP.

1. Use uma conta Gmail para o projeto, ative a verificação em duas etapas e crie uma [senha de app na Conta Google](https://support.google.com/accounts/answer/185833?hl=pt-BR). Algumas contas administradas podem não permitir esse recurso.
2. Copie `.env.example` para `.env` na pasta `sistema-financeiro`. Preencha `SMTP_USER` com o Gmail remetente, `SMTP_PASS` com a senha de app e `MAIL_FROM` com o mesmo e-mail. Use a senha de app sem os espaços de agrupamento exibidos pelo Google. Não use a senha normal da conta nem compartilhe o arquivo.
3. Execute `npm.cmd run check:email` para verificar a conexão e a autenticação sem enviar mensagens. Reinicie o servidor após mudar o `.env`.
4. No site, clique em **Esqueci minha senha**, informe o e-mail cadastrado e abra o link recebido. Defina e confirme a nova senha e entre novamente.

O link expira em 30 minutos, só funciona uma vez e não é gravado em logs ou no localStorage. O banco guarda apenas o hash do token. Redefinir a senha invalida os demais links e todas as sessões daquela conta; contas e gastos são mantidos. A resposta não revela se o e-mail está cadastrado. Há limites de solicitações por endereço e IP. Se o SMTP não estiver configurado, o site informa a indisponibilidade; falhas do provedor são registradas sem credenciais, endereços ou tokens. O envio ocorre em segundo plano: se o servidor reiniciar antes do envio, solicite um novo link.

Na rede local, peça a recuperação acessando pelo IP do computador (por exemplo, `http://192.168.1.64:3000`) para que o link abra também no celular. Um link pedido em `localhost` só abre no próprio computador. Para acesso público, configure `PUBLIC_ORIGIN` com o endereço HTTPS real do site.

Contas antigas continuam aceitando suas senhas anteriores. Um aviso no painel permite cadastrar o e-mail com confirmação da senha atual; só depois disso a recuperação fica disponível para essas contas. O cadastro não faz uma confirmação prévia de posse do e-mail: confira o endereço antes de salvar.

Referências da implementação: [SMTP no Nodemailer](https://nodemailer.com/smtp), [Gmail no Nodemailer](https://nodemailer.com/guides/using-gmail) e [recuperação de senha — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Tour inicial

No primeiro acesso de cada conta, um tour de cinco passos apresenta gastos, parcelas mensais, categorias/gráficos, orçamento/planejamento e o chatbot. O quinto passo mostra uma conversa de exemplo e explica como minimizar e reabrir o chat. É possível voltar, avançar, **Pular tour** ou concluir e abrir o formulário de gasto. As ilustrações não criam compras reais. A conclusão ou o pulo ficam salvos na conta no servidor, inclusive para outros dispositivos. Quem já concluiu pode acessar o novo passo pelo menu **Rever tour**.

## Conversar com o Orçaviva

Ao entrar na conta, o chat já aparece aberto no canto inferior direito, sem bloquear o painel ou capturar o foco. Use **−** para minimizar e a barra **Conversar com Orçaviva** para reabrir; o texto digitado e o histórico permanecem na conversa ao minimizar. O atalho do menu também expande o chat. O layout se ajusta ao celular. Esta versão interpreta português por regras locais, sem credenciais de IA ou WhatsApp, e salva na mesma conta do painel. O chat fica indisponível no modo de demonstração para não misturar gastos fictícios com a conta real, e desaparece ao sair da conta.

Experimente uma compra por mensagem:

```text
Gastei 85,90 no mercado via Pix
Comprei um celular por 2.400 em 10 vezes
Comprei um tênis em 3 vezes de 100, categoria Online
Comprei uma cadeira por 300 no crédito em 3 vezes, primeira parcela em 31/10/2026, categoria Online
```

Valores são em reais e escritos com números. “300 em 3 vezes” é R$ 300 no total; “3 vezes de 100” é R$ 300 no total também. Sem data, o chat usa hoje no horário de São Paulo. São aceitos `hoje`, `ontem`, `DD/MM/AAAA`, `AAAA-MM-DD` e nomes dos meses (sem dia, usa dia 1; sem ano, usa o ano atual). O chat distribui parcelas a partir da data informada; ainda não calcula vencimento ou fechamento de cartão.

Se faltar nome, valor, número de parcelas ou categoria, o bot pergunta antes de registrar. Responda só ao detalhe pedido, como `Online` ou `300,00`. Nas sugestões, clique para preencher e depois envie. `Criar categoria Transporte` cria uma categoria durante essa pergunta; `cancelar` abandona os detalhes pendentes. Compras completas são registradas automaticamente e a resposta mostra o resultado. O pagamento informado (Pix, crédito, débito, dinheiro ou boleto) também fica salvo e aparece no painel.

Consultas e ajustes:

```text
Relatório deste mês
Relatório de setembro de 2026
Relatório de 2026-10
Quanto gastei com mercado este mês?
Corrigir último gasto: valor 90
Corrigir último gasto: categoria Restaurantes
Corrigir último gasto: data 20/09/2026
Corrigir último gasto: parcelas 3
Corrigir último gasto: pagamento Pix
Desfazer último gasto
Ajuda
```

Nas novas compras pelo chat, **crédito começa no mês seguinte à compra**, mesmo sem parcelamento. Exemplo: compra em 15/09 → primeira fatura em 15/10. O dia é limitado ao último dia do mês quando necessário (31/01 → 28/02, ou 29/02 em ano bissexto). Se você informar explicitamente “primeira parcela”, “primeira fatura” ou “vencimento” com uma data, o chat respeita essa escolha. Pix, débito, dinheiro e boleto mantêm a data informada ou hoje. Corrigir o pagamento de outra modalidade para crédito avança a primeira cobrança uma vez; corrigir para crédito novamente não avança outra vez. O comando “corrigir ... data” ajusta diretamente a data da primeira cobrança. Compras já salvas não são remanejadas automaticamente.

Os relatórios consultam os lançamentos do mês, incluindo as parcelas, e exibem total, maior gasto, categorias e orçamento disponível quando definido. O resultado pode ser baixado como texto e o gráfico como SVG. Cada relatório no histórico é uma fotografia daquele momento; envie outra consulta para atualizar os valores.

O desfazer reverte apenas a última inclusão ou correção feita pelo chat, uma vez. Depois de desfazer uma correção, a compra volta à versão anterior; não há uma pilha de desfazer. Se ela tiver sido alterada pelo painel, o chat não desfaz outra versão silenciosamente. A conversa mantém as últimas 40 mensagens no servidor e pertence à conta. O histórico não entra no backup JSON financeiro; as compras e formas de pagamento entram normalmente.

Para testar sem afetar seus dados, crie uma conta separada. Os testes automatizados já usam contas e bancos temporários. Mensagens sem estrutura reconhecida recebem exemplos; ambiguidades numéricas e formatos não suportados não geram gastos. Ainda não há interpretação por IA externa, áudio, comprovantes, envio por WhatsApp ou exportação em PDF.

### Base para a próxima integração

- `chat-engine.cjs`: interpretação por regras, perguntas pendentes, consultas e comandos financeiros, sem dependência da interface.
- `chat-service.cjs`: execução por conta, histórico e recibos de mensagens. A transação SQLite salva o gasto, a conversa e a resposta juntos; revisão da conta e da conversa impede sobrescritas concorrentes. Reenviar a mesma mensagem com o mesmo identificador não cria outra compra.
- `GET /api/chat` e `POST /api/chat`: adaptador do chat web, protegido pela sessão, conta e CSRF. O POST recebe `text`, `messageId`, `revision` e `chatRevision`.
- `chat.js` e `chat.css`: conversa no site, atualização do painel e downloads de relatórios. O navegador mantém o envio pendente na sessão da aba para repetir o mesmo identificador após uma falha de rede.

A integração com WhatsApp precisará verificar a assinatura da Meta, vincular o remetente a uma conta autorizada e mapear o identificador da mensagem para evitar reprocessamento. Ela poderá reutilizar o serviço de aplicação após resolver essa identidade. Um futuro interpretador de IA deverá produzir dados estruturados, validados por `Finance`, sem decidir a identidade da conta ou executar SQL. Nenhuma rota pública de WhatsApp ou chave de IA foi habilitada nesta etapa.

## Categorias e painel

Em **Novo gasto → Categoria → Criar nova categoria**, digite o nome e clique em **Criar categoria**. A categoria fica selecionada e passa a aparecer nos filtros, gráficos e backups. Cada conta pode criar até 100 categorias, com nomes de até 40 caracteres. Nomes duplicados são recusados, mesmo com diferenças de maiúsculas e acentos.

Informe o valor total da compra e a quantidade de parcelas. R$ 100,00 em três vezes gera R$ 33,34, R$ 33,33 e R$ 33,33. Datas no fim do mês respeitam meses mais curtos. Editar ou excluir uma compra altera todas as suas parcelas.

- **Visão geral:** resumo, gráficos, orçamento e maior compra do mês.
- **Minhas despesas:** busca, filtros, ordenação, edição, exclusão e CSV.
- **Planejamento:** próximos seis meses e parcelas comprometidas.
- **Backup JSON:** compras, categorias e orçamentos da conta. Importar substitui o conteúdo após confirmação; backups antigos continuam compatíveis. O limite é aproximadamente 8 MB.
- **Demonstração:** dados fictícios locais, separados da conta.
- **Sair:** aguarda o envio das alterações, encerra a sessão e limpa o cache confirmado. Pendências em conflito permanecem recuperáveis no próximo acesso à mesma conta.

## Trazer os gastos anteriores

Se você usava o arquivo aberto diretamente, abra o mesmo `index.html` atualizado no mesmo navegador. Quando encontra os dados antigos, a tela oferece **Baixar meus gastos anteriores**. Baixe o JSON, entre em http://localhost:3000 e use **Importar backup**.

Se a versão antiga já funcionava no mesmo endereço HTTP, um aviso no painel permite importar os gastos locais. Os dados anteriores não são apagados. Armazenamentos de `file://` e HTTP são separados pelo navegador; por isso a transferência entre esses endereços usa backup.

## Salvamento e contas

A mudança de nome preserva as contas e os gastos existentes. O banco, os identificadores de armazenamento e o protocolo de autenticação mantêm os nomes internos antigos por compatibilidade; não é necessário migrar os dados. O inicializador antigo `iniciar-finanto.cmd` também continua funcionando.

Os dados ficam em `data/finanto.sqlite`, separados por usuário. O navegador mantém cópias de trabalho por conta e pendências separadas por aba. Alterações são enviadas automaticamente após um pequeno intervalo de 300 ms; o indicador do painel confirma o salvamento no servidor.

A conta é atualizada ao entrar, ao voltar à aba e a cada 15 segundos. Se a conexão cair, pendências são preservadas localmente para retomar o envio. Se outro dispositivo editar os dados antes, o painel oferece download das pendências e carregamento da versão atual, sem sobrescrever silenciosamente. O login deve ser validado novamente ao reabrir o painel.

As senhas não são salvas em localStorage ou em backups financeiros. O servidor guarda hashes scrypt com salt individual; sessões usam cookies HttpOnly, duram 12 horas e são verificadas em cada acesso aos dados. Há limite de tentativas, validação de origem, token CSRF e proteção contra troca de conta em outra aba. E-mail e conclusão do tour ficam na conta, separados do backup financeiro.

## Outros dispositivos e hospedagem

Para acessar de outro dispositivo, use a mesma conta no **mesmo servidor**. Iniciar servidores separados cria bancos independentes. O projeto ainda não está publicado na internet.

Para uso público, hospede o processo Node com armazenamento persistente e proxy HTTPS. Exemplo de configuração:

```powershell
$env:NODE_ENV = 'production'
$env:PUBLIC_ORIGIN = 'https://orcaviva.seu-dominio.com'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:FINANTO_DB = 'C:/dados/finanto/finanto.sqlite'
node server.cjs
```

O proxy deve encaminhar para o processo Node. `PUBLIC_ORIGIN` deve ser a origem exata do site, sem caminho, e ativa cookies Secure quando usa HTTPS. Produção recusa iniciar sem uma origem HTTPS e mantém `HOST=127.0.0.1` como padrão.

Em uso local, `npm.cmd start` e `iniciar-orcaviva.cmd` agora escutam em `0.0.0.0` e mostram os IPs disponíveis. Em outro aparelho conectado à mesma rede, abra `http://IP-DO-COMPUTADOR:3000`. O computador com o servidor precisa continuar ligado. `localhost` continua funcionando no próprio computador; o login em cada endereço usa sua própria sessão, mas acessa o mesmo banco de contas.

Não é necessário fixar `PUBLIC_ORIGIN` para a rede local: são aceitos os IPs IPv4 atuais do computador, seu nome de rede e localhost, na porta do servidor. As verificações de origem e CSRF continuam ativas. Para voltar ao acesso somente pelo próprio computador, configure `HOST=127.0.0.1` antes de iniciar.

Caso o Windows bloqueie conexões de outros aparelhos, autorize entrada TCP na porta 3000 apenas para a sub-rede local e para o executável Node.js. Não é necessário abrir portas no roteador. HTTP na rede não cifra a conexão; use HTTPS para acesso público. A compatibilidade do cache em HTTP usa [Crypto.getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues), disponível também nesse contexto.

O banco e arquivos internos não são servidos por HTTP. Para backup completo das contas, pare o servidor antes de copiar o banco SQLite. Os JSONs do painel contêm apenas os dados financeiros da respectiva conta.

## Testes e arquivos

```powershell
npm.cmd test
npm.cmd run test:browser
```

Testes HTTP e do navegador usam bancos e perfis temporários. O teste de interface usa Microsoft Edge; `EDGE_PATH` permite informar outro Chromium compatível.

- `finance.js`: categorias, validação e cálculos em centavos.
- `server.cjs`: API, contas, sessões e SQLite.
- `api.js`: comunicação, cache e sincronização.
- `app.js`: painel e formulários.
- `styles.css` e `auth.css`: layout responsivo.

Referências: [SQLite no Node.js](https://nodejs.org/api/sqlite.html), [armazenamento de senhas — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [sessões — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
