(() => {
  'use strict';
  const sidebar = document.querySelector('#main-sidebar');
  const toggle = document.querySelector('#mobile-menu-toggle');
  const closeButton = document.querySelector('#mobile-menu-close');
  const backdrop = document.querySelector('#mobile-menu-backdrop');
  const mobile = matchMedia('(max-width: 760px)');
  document.querySelector('#mobile-brand').append(sidebar.querySelector('.brand').cloneNode(true));
  let opened = false;
  let previousOverflow = '';
  const blocked = new Map();
  function close(restoreFocus = true) {
    if (opened) document.body.style.overflow = previousOverflow;
    opened = false;
    sidebar.classList.remove('is-open');
    sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
    sidebar.inert = mobile.matches;
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','Abrir menu');
    for (const [node, inert] of blocked) node.inert = inert;
    blocked.clear();
    if (restoreFocus && mobile.matches) toggle.focus({preventScroll:true});
  }
  function open() {
    if (!mobile.matches) return;
    opened = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.inert = false;
    sidebar.classList.add('is-open'); sidebar.setAttribute('role','dialog'); sidebar.setAttribute('aria-modal','true');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded','true'); toggle.setAttribute('aria-label','Fechar menu');
    for (const node of document.querySelector('#app-shell').children) {
      if (node === sidebar || node === backdrop || node.classList.contains('mobile-topbar')) continue;
      blocked.set(node,node.inert); node.inert = true;
    }
    closeButton.focus({preventScroll:true});
  }
  toggle.onclick = () => opened ? close() : open();
  closeButton.onclick = () => close(); backdrop.onclick = () => close();
  // Close before an action opens a dialog or moves focus to the chat.
  sidebar.addEventListener('click', event => {if (opened && event.target.closest('.nav-item, .brand')) close();},true);
  document.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.key === 'Escape') {event.preventDefault(); close();}
    if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('button, a[href]')].filter(node => !node.disabled && node.getClientRects().length);
      const first=items[0], last=items.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    }
  });
  mobile.addEventListener('change', () => close(false));
  window.MoneyRestlyMenu = Object.freeze({reset:()=>close(false)});
  close(false);
})();
