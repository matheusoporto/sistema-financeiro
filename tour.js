/* A short introduction; completion belongs to the account, across devices. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const steps = [
    {
      title: 'Um gasto, poucos detalhes.',
      description: 'Clique em Novo gasto. Informe a compra, o valor, a data e a categoria. Salve e pronto: seu mês já fica atualizado.',
      preview: '<div class="tour-receipt"><span class="tour-pill">+ Novo gasto</span><small>NOME DA COMPRA</small><strong>Compras da semana</strong><div class="tour-preview-row"><span>Mercado</span><b>R$ 150,00</b></div><span class="tour-check">✓ Salvar gasto</span></div>'
    },
    {
      title: 'Parcelou? A gente distribui.',
      description: 'Informe o valor total e o número de parcelas. O MoneyRestly calcula cada uma e distribui nos próximos meses. Use as abas para acompanhar.',
      preview: '<div class="tour-example"><span class="tour-pill">Uma compra de R$ 300 em 3×</span><div class="tour-months"><div><small>JAN</small><strong>R$ 100</strong></div><div><small>FEV</small><strong>R$ 100</strong></div><div><small>MAR</small><strong>R$ 100</strong></div></div><p>Um mês de cada vez. Tudo no lugar.</p></div>'
    },
    {
      title: 'Descubra para onde foi.',
      description: 'Os gráficos mostram quais categorias pesam mais no mês. Use os filtros para olhar de perto e crie novas categorias ao adicionar um gasto.',
      preview: '<div class="tour-example tour-category-example"><div class="tour-mini-donut"></div><div><span class="tour-pill">Seu jeito de organizar</span><p>● Mercado</p><p>● Lazer</p><span class="tour-new-category">+ Criar nova categoria</span></div></div>'
    },
    {
      title: 'Dê um rumo ao seu mês.',
      description: 'Em Ajustar orçamento, defina quanto pretende gastar. Acompanhe o que resta e veja as próximas parcelas em Planejamento. Seus dados são salvos automaticamente.',
      preview: '<div class="tour-receipt"><small>ORÇAMENTO DO MÊS</small><strong>R$ 2.000,00</strong><div class="tour-meter"><span></span></div><div class="tour-preview-row"><span>Você ainda tem</span><b>R$ 800,00</b></div><span class="tour-check">✓ Pronto para começar</span></div>'
    },
    {
      title: 'Organize seus gastos conversando.',
      description: 'No celular, toque na barra da conversa para abrir o chat. No computador, ele já começa aberto. Escreva uma compra ou peça um relatório. Ele salva na sua conta e pergunta se faltar algo. Use − para minimizar.',
      preview: '<div class="tour-chat-example"><div class="tour-chat-heading">MoneyRestly <span>−</span></div><p class="tour-chat-user">Gastei 85,90 no mercado via Pix</p><p class="tour-chat-answer">✓ Registrei em Mercado.<br>Você pode pedir um relatório ou desfazer.</p><small>Uma mensagem. Tudo organizado.</small></div>'
    },
    {
      title: 'Leve seus gastos para o Telegram.',
      description: 'No menu, abra Conectar Telegram e gere seu link. Toque em Iniciar no bot para vincular sua conta. Depois, envie gastos ou peça relatórios na conversa privada. O link vale 10 minutos: não compartilhe.',
      preview: '<div class="tour-chat-example"><div class="tour-chat-heading">MoneyRestly no Telegram <span>↗</span></div><span class="tour-pill">Conectar Telegram → Iniciar</span><p class="tour-chat-user">Relatório deste mês</p><p class="tour-chat-answer">Seus gastos e parcelas, direto na conversa.</p><small>Você pode desconectar pelo site quando quiser.</small></div>'
    }
  ];
  const dialog = $('#tour-dialog');
  let user = null;
  let step = 0;
  let busy = false;
  function render() {
    const current = steps[step];
    $('#tour-title').textContent = current.title;
    $('#tour-description').textContent = current.description;
    $('#tour-counter').textContent = `PASSO ${step + 1} DE ${steps.length} · MENOS DE 1 MINUTO`;
    $('#tour-preview').innerHTML = current.preview; // Fixed illustrations only; no user data.
    $('#tour-dots').innerHTML = steps.map((_, index) => `<i class="${index === step ? 'active' : ''}"></i>`).join('');
    $('#tour-back').hidden = step === 0;
    $('#tour-next').textContent = step === steps.length - 1 ? 'Começar a usar ✓' : 'Próximo →';
    $('#tour-create').hidden = step !== steps.length - 1;
    if (dialog.open) $('#tour-title').focus({ preventScroll: true });
  }
  async function finish(createExpense = false) {
    if (busy || !user) return;
    const owner = user;
    busy = true;
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    $('#tour-error').hidden = true;
    try {
      await window.MoneyRestlyAPI.request('account/tour', { method: 'POST', body: {}, accountId: owner.id });
      if (user !== owner || !dialog.open) return;
      owner.tourCompleted = true;
      dialog.close();
      if (createExpense) $('#add-expense').click();
    } catch (error) {
      if (user !== owner || !dialog.open) return;
      $('#tour-error').textContent = error.message;
      $('#tour-error').hidden = false;
    } finally {
      busy = false;
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }
  $('#tour-next').onclick = () => { if (step === steps.length - 1) finish(); else { step++; render(); } };
  $('#tour-back').onclick = () => { if (step > 0) { step--; render(); } };
  $('#tour-skip').onclick = () => finish();
  $('#tour-create').onclick = () => finish(true);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('close', () => { user = null; });
  window.MoneyRestlyTour = Object.freeze({
    start(account) {
      if (!account || busy || dialog.open) return;
      user = account; step = 0;
      $('#tour-error').hidden = true;
      render(); dialog.showModal(); $('#tour-title').focus();
    }
  });
})();
