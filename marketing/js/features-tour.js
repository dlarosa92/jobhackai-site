/* Progressive enhancement for the public, illustrated product tour. */
(() => {
  const tour = document.querySelector('[data-product-tour]');
  if (!tour) return;
  const tabs = [...tour.querySelectorAll('[data-tour-tab]')];
  const panels = [...tour.querySelectorAll('[data-tour-panel]')];
  const tablist = tour.querySelector('[data-tour-tabs]');

  function selectTab(tab, focus = false) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
    if (focus) tab.focus();
  }

  tablist.setAttribute('role', 'tablist');
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  });
  panels.forEach(panel => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${panel.dataset.tourPanel}`);
    panel.tabIndex = 0;
  });
  selectTab(tabs.find(tab => tab.dataset.tourTab === 'conversation') || tabs[0]);
  tablist.hidden = false;

  const dialog = document.querySelector('[data-capture-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('[data-capture-caption]');
  document.querySelectorAll('[data-expand-capture]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const source = link.closest('figure').querySelector('img');
      image.src = link.href;
      image.alt = source.alt;
      caption.textContent = link.dataset.captureCaption;
      dialog.showModal();
    });
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
})();
