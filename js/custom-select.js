/* JobHackAI Design System: Custom Select Enhancer
 * Converts native <select> into a consistent dropdown UI.
 * - Keeps original <select> in DOM (visually hidden) so existing JS continues to work.
 * - Supports dynamic option updates (MutationObserver).
 * - Basic keyboard support.
 */

(() => {
  const ENHANCED = new WeakMap();

  function isEnhanceableSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (select.hasAttribute('data-native')) return false; // opt-out
    if (select.multiple) return false;
    const size = Number(select.getAttribute('size') || '0');
    if (Number.isFinite(size) && size > 1) return false;
    if (select.disabled) return true; // still enhance (button will mirror disabled)
    return true;
  }

  function getSelectedOption(select) {
    return select.options?.[select.selectedIndex] || null;
  }

  function optionIsPlaceholder(opt) {
    if (!opt) return true;
    // Treat "empty value" option as placeholder if it's disabled/hidden, or if it's the common prompt.
    const empty = (opt.value ?? '') === '';
    return empty && (opt.disabled || opt.hidden);
  }

  function createIconChev() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('jh-dropdown__chev');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    return svg;
  }

  function createIconCheck() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('jh-dropdown__check');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '20 6 9 17 4 12');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'currentColor');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);

    return svg;
  }

  function closeAll(except = null) {
    document.querySelectorAll('.jh-dropdown.jh-dropdown--open').forEach((el) => {
      if (except && el === except) return;
      el.classList.remove('jh-dropdown--open');
      const btn = el.querySelector('.jh-dropdown__button');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function enhanceSelect(select) {
    if (!isEnhanceableSelect(select)) return null;
    if (ENHANCED.has(select)) return ENHANCED.get(select);

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'jh-dropdown';

    // Build button
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jh-dropdown__button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const buttonText = document.createElement('span');
    buttonText.className = 'jh-dropdown__button-text';

    const chev = createIconChev();

    button.appendChild(buttonText);
    button.appendChild(chev);

    // Build menu
    const menu = document.createElement('div');
    menu.className = 'jh-dropdown__menu';
    menu.setAttribute('role', 'listbox');

    // Insert wrapper in DOM: replace select with wrapper, then put select inside wrapper.
    const parent = select.parentNode;
    if (!parent) return null;

    parent.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(button);
    wrapper.appendChild(menu);

    // Prevent clicks inside the dropdown from bubbling to the global "click outside" handler.
    // Without this, clicks on disabled options or menu padding can close the dropdown unexpectedly.
    wrapper.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Hide native select but keep it functional for existing JS.
    select.classList.add('jh-select-native');
    select.tabIndex = -1;

    function syncSelected() {
      const selectedValue = select.value;
      const selected = getSelectedOption(select);
      buttonText.textContent = (selected && selected.textContent) ? selected.textContent : 'Select…';

      menu.querySelectorAll('.jh-dropdown__option').forEach((el) => {
        const isSelected = el.dataset.value === selectedValue;
        el.setAttribute('aria-selected', String(isSelected));
      });
    }

    // Override the value property to sync visual display when set programmatically
    // Store the original descriptor to restore it later
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value') ||
                                    Object.getOwnPropertyDescriptor(select, 'value');
    let _value = select.value;
    Object.defineProperty(select, 'value', {
      get() {
        return _value;
      },
      set(newValue) {
        const oldValue = _value;
        _value = newValue;
        if (oldValue !== newValue) {
          syncSelected();
        }
      }
    });

    function renderOptions() {
      // Clear menu
      menu.innerHTML = '';

      const selected = getSelectedOption(select);
      const selectedLabel = selected ? selected.textContent || '' : '';
      buttonText.textContent = selectedLabel || 'Select…';

      const opts = Array.from(select.options || []);
      const selectedValue = select.value;

      opts.forEach((opt) => {
        // Exclude true placeholders from menu.
        if (optionIsPlaceholder(opt)) return;

        const optEl = document.createElement('div');
        optEl.className = 'jh-dropdown__option';
        optEl.setAttribute('role', 'option');
        optEl.tabIndex = -1;
        optEl.dataset.value = opt.value;
        optEl.setAttribute('aria-selected', String(opt.value === selectedValue));

        const label = document.createElement('span');
        label.textContent = opt.textContent || '';

        const check = createIconCheck();

        optEl.appendChild(label);
        optEl.appendChild(check);

        if (opt.disabled) {
          optEl.style.opacity = '0.55';
          optEl.style.cursor = 'not-allowed';
        } else {
          optEl.addEventListener('click', () => {
            if (select.disabled) return;
            const oldValue = select.value;
            const newValue = opt.value;
            if (oldValue !== newValue) {
              select.value = newValue;
              // Match native <select>: only fire "change" when value changes.
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            close();
          });
        }

        menu.appendChild(optEl);
      });

      // Mirror disabled state.
      button.disabled = !!select.disabled;
      wrapper.classList.toggle('is-disabled', !!select.disabled);

      // Ensure aria-selected stays accurate.
      syncSelected();
    }

    function open() {
      if (select.disabled) return;
      closeAll(wrapper);
      wrapper.classList.add('jh-dropdown--open');
      button.setAttribute('aria-expanded', 'true');

      // Focus selected option for keyboard.
      const selectedEl = menu.querySelector('.jh-dropdown__option[aria-selected="true"]');
      (selectedEl || menu.querySelector('.jh-dropdown__option'))?.focus?.();
    }

    function close() {
      wrapper.classList.remove('jh-dropdown--open');
      button.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      if (wrapper.classList.contains('jh-dropdown--open')) close();
      else open();
    }

    // Button events
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    // Keyboard on button
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    // Keyboard navigation in menu
    menu.addEventListener('keydown', (e) => {
      const items = Array.from(menu.querySelectorAll('.jh-dropdown__option'));
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);

      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        button.focus();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[Math.min(items.length - 1, idx + 1)];
        next?.focus();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[Math.max(0, idx - 1)];
        prev?.focus();
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const current = items[idx] || null;
        if (!current) return;
        const value = current.dataset.value;
        const opt = Array.from(select.options).find(o => o.value === value);
        if (opt && !opt.disabled && !select.disabled) {
          const oldValue = select.value;
          const newValue = value;
          if (oldValue !== newValue) {
            select.value = newValue;
            // Match native <select>: only fire "change" when value changes.
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          close();
          button.focus();
        }
      }
    });

    // Keep in sync with select changes
    const onSelectChange = () => {
      syncSelected();
    };
    select.addEventListener('change', onSelectChange);

    // Observe option list changes (dynamic dropdowns)
    const mo = new MutationObserver(() => {
      renderOptions();
    });
    mo.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });

    // Initial render
    renderOptions();

    const instance = {
      select,
      wrapper,
      button,
      menu,
      refresh: renderOptions,
      destroy: () => {
        mo.disconnect();
        select.removeEventListener('change', onSelectChange);
        // Restore the original value property
        if (originalValueDescriptor) {
          Object.defineProperty(select, 'value', originalValueDescriptor);
        } else {
          delete select.value; // Fallback if no original descriptor
        }
        close();
        // unwrap: move select back
        const p = wrapper.parentNode;
        if (p) p.insertBefore(select, wrapper);
        wrapper.remove();
        select.classList.remove('jh-select-native');
        select.tabIndex = 0;
        ENHANCED.delete(select);
      }
    };

    ENHANCED.set(select, instance);
    return instance;
  }

  function enhanceAll(root = document) {
    const selects = Array.from(root.querySelectorAll('select'));
    selects.forEach(enhanceSelect);
  }

  // Global event: click outside closes
  document.addEventListener('click', () => closeAll(null));

  // Expose for pages that add selects dynamically
  window.JobHackAIDropdowns = {
    enhanceAll,
    enhanceSelect
  };

  // Auto-enhance when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAll(document));
  } else {
    enhanceAll(document);
  }
})();
