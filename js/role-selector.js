// Dynamic Role Selector with API integration
// Supports auto-complete, custom roles, and telemetry
// Loads roles from /api/roles endpoint (canonical 200-role list)

const ROLE_SELECTOR_INSTANCES = new Set();
let roleSelectorDocumentListenersBound = false;

function forEachRoleSelectorInstance(callback) {
  ROLE_SELECTOR_INSTANCES.forEach((instance) => {
    if (!instance || instance.isDestroyed || !instance.input || !instance.input.isConnected) {
      ROLE_SELECTOR_INSTANCES.delete(instance);
      instance?.destroy?.();
      return;
    }
    callback(instance);
  });
}

function handleRoleSelectorDocumentPointerDown(event) {
  forEachRoleSelectorInstance((instance) => {
    instance.handleDocumentPointerDown(event);
  });
}

function handleRoleSelectorDocumentKeyDown(event) {
  forEachRoleSelectorInstance((instance) => {
    instance.handleDocumentKeyDown(event);
  });
}

function bindRoleSelectorDocumentListeners() {
  if (roleSelectorDocumentListenersBound) return;
  document.addEventListener('pointerdown', handleRoleSelectorDocumentPointerDown, true);
  document.addEventListener('keydown', handleRoleSelectorDocumentKeyDown);
  roleSelectorDocumentListenersBound = true;
}

function unbindRoleSelectorDocumentListenersIfUnused() {
  if (!roleSelectorDocumentListenersBound) return;
  if (ROLE_SELECTOR_INSTANCES.size > 0) return;
  document.removeEventListener('pointerdown', handleRoleSelectorDocumentPointerDown, true);
  document.removeEventListener('keydown', handleRoleSelectorDocumentKeyDown);
  roleSelectorDocumentListenersBound = false;
}

// ---- Pure helpers (exported for Node tests; no DOM dependencies) ----

/** Case-insensitive substring filter over role names, capped at maxResults. */
export function filterRoles(roles, rawQuery, maxResults) {
  const query = String(rawQuery || '').toLowerCase().trim();
  if (!query) return [];
  return (roles || [])
    .filter((role) => role && typeof role.name === 'string' && role.name.toLowerCase().includes(query))
    .slice(0, maxResults);
}

/** HTML-escape without a DOM, so highlighting is testable in Node. */
export function escapeHtmlText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap the matched span in <strong>, escaping each part separately so entity
 * encoding cannot shift the match position.
 */
export function highlightRoleMatch(text, query) {
  const safeText = typeof text === 'string' ? text : '';
  const trimmed = String(query || '').trim();
  if (!trimmed) return escapeHtmlText(safeText);
  const index = safeText.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return escapeHtmlText(safeText);
  const before = safeText.substring(0, index);
  const match = safeText.substring(index, index + trimmed.length);
  const after = safeText.substring(index + trimmed.length);
  return `${escapeHtmlText(before)}<strong>${escapeHtmlText(match)}</strong>${escapeHtmlText(after)}`;
}

/** "software_engineering" -> "software engineering" for the category line. */
export function prettyCategory(category) {
  if (typeof category !== 'string') return '';
  return category.replace(/_/g, ' ').trim();
}

/**
 * Role Selector Component
 * Loads roles from /api/roles endpoint with fallback to pre-seeded list
 */
export class RoleSelector {
  constructor(inputElement, options = {}) {
    this.input = inputElement;
    this.options = {
      minChars: 2,
      maxResults: 8,
      showCustomOption: true,
      onSelect: null,
      ...options
    };
    this.roles = [];
    this.recentSelections = this.loadRecentSelections();
    this.dropdown = null;
    this.activeIndex = -1;
    this.optionEls = [];
    this.blurHideTimeout = null;
    this.isDestroyed = false;
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
    this.handleInputEvent = this.handleInputEvent.bind(this);
    this.handleFocusEvent = this.handleFocusEvent.bind(this);
    this.handleBlurEvent = this.handleBlurEvent.bind(this);
    this.handleInputKeyDown = this.handleInputKeyDown.bind(this);

    const existingInstance = this.input?.__jobHackAIRoleSelectorInstance;
    if (existingInstance && existingInstance !== this && typeof existingInstance.destroy === 'function') {
      existingInstance.destroy();
    }
    if (this.input) this.input.__jobHackAIRoleSelectorInstance = this;
    this.init();
  }

  async init() {
    if (this.isDestroyed) return;
    this.createDropdown();
    await this.loadRoles();
    if (this.isDestroyed) return;
    this.setupListeners();
    this.showHint();
  }

  createDropdown() {
    if (!this.input || !this.input.parentNode) return;

    // The dropdown is absolutely positioned against its nearest positioned
    // ancestor. Pages that wrap the input in a position:relative container get
    // it beneath the field; pages that do not (the voice interview page's
    // plain .vi-field) had the dropdown anchor to some distant ancestor and
    // render nowhere near the input - suggestions existed but were effectively
    // invisible. Make the parent the positioning context ourselves, so the
    // component works on every page without page CSS knowing about it.
    const parent = this.input.parentNode;
    try {
      if (parent instanceof Element && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
    } catch (_) { /* getComputedStyle can throw on detached nodes; harmless */ }

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'role-selector-dropdown';
    this.dropdown.setAttribute('role', 'listbox');
    if (this.input.id) this.dropdown.id = this.input.id + '-listbox';
    this.dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #fff;
      border: 1px solid #CBD5E1;
      border-radius: 10px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
      margin-top: 4px;
    `;

    this.input.parentNode.insertBefore(this.dropdown, this.input.nextSibling);
  }

  async loadRoles() {
    try {
      // Try API endpoint first
      const response = await fetch('/api/roles');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.roles) {
          this.roles = data.roles.map(role => ({
            id: role.id,
            name: role.label,
            category: role.category || 'general',
            type: 'standard'
          }));
          return; // Success, exit early
        }
      }
    } catch (error) {
      console.warn('[RoleSelector] API load failed, using fallback:', error);
    }
    
    // Fallback
    this.roles = this.getPreSeededRoles();
    
    // If fallback is empty, log info that custom roles are supported
    if (this.roles.length === 0) {
      console.info('[RoleSelector] Using custom role mode - users can type any role');
    }
  }

  getPreSeededRoles() {
    // Minimal fallback - full list comes from /api/roles
    // Return a small subset of most common roles for offline/fallback scenarios
    return [
      { name: 'Software Engineer', category: 'software_engineering', type: 'standard' },
      { name: 'Product Manager', category: 'product_management', type: 'standard' },
      { name: 'Product Owner', category: 'product_management', type: 'standard' },
      { name: 'Data Engineer', category: 'data_engineering', type: 'standard' },
      { name: 'Data Scientist', category: 'data_science', type: 'standard' },
      { name: 'DevOps Engineer', category: 'devops', type: 'standard' },
      { name: 'Cloud Engineer', category: 'cloud_engineering', type: 'standard' },
      { name: 'Machine Learning Engineer', category: 'ml_engineering', type: 'standard' },
      { name: 'AI Engineer', category: 'ai_ml', type: 'standard' },
      { name: 'Full-Stack Developer', category: 'software_engineering', type: 'standard' },
      { name: 'Front-End Engineer', category: 'software_engineering', type: 'standard' },
      { name: 'Back-End Engineer', category: 'software_engineering', type: 'standard' },
      { name: 'Site Reliability Engineer (SRE)', category: 'platform_engineering', type: 'standard' },
      { name: 'Scrum Master', category: 'agile_delivery', type: 'standard' },
      { name: 'Agile Coach', category: 'agile_delivery', type: 'standard' },
      { name: 'Solution Architect', category: 'architecture', type: 'standard' },
      { name: 'Security Engineer', category: 'security', type: 'standard' },
      { name: 'QA Engineer', category: 'quality', type: 'standard' },
      { name: 'UX Designer', category: 'ux', type: 'standard' },
      { name: 'Business Analyst', category: 'business', type: 'standard' }
    ];
  }

  setupListeners() {
    if (this.isDestroyed || !this.input) return;
    this.input.addEventListener('input', this.handleInputEvent);
    this.input.addEventListener('focus', this.handleFocusEvent);
    this.input.addEventListener('blur', this.handleBlurEvent);
    this.input.addEventListener('keydown', this.handleInputKeyDown);

    ROLE_SELECTOR_INSTANCES.add(this);
    bindRoleSelectorDocumentListeners();
  }

  handleInputEvent(event) {
    this.handleInput(event?.target?.value || '');
  }

  handleFocusEvent() {
    if (this.isDestroyed || !this.input) return;
    if (this.input.value.length >= this.options.minChars) {
      this.handleInput(this.input.value);
    }
  }

  handleBlurEvent() {
    if (this.isDestroyed) return;
    if (this.blurHideTimeout) {
      clearTimeout(this.blurHideTimeout);
    }
    this.blurHideTimeout = setTimeout(() => {
      this.hideDropdown();
      this.blurHideTimeout = null;
    }, 200);
  }

  handleInputKeyDown(event) {
    if (this.isDestroyed) return;
    const open = this.isDropdownOpen();

    if (event.key === 'ArrowDown') {
      // Closed + enough characters: ArrowDown opens the suggestions
      if (!open) {
        if (this.input && this.input.value.trim().length >= this.options.minChars) {
          event.preventDefault();
          this.handleInput(this.input.value);
          this.setActive(0);
        }
        return;
      }
      event.preventDefault();
      this.setActive(this.activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      this.setActive(this.activeIndex <= 0 ? this.optionEls.length - 1 : this.activeIndex - 1);
      return;
    }
    if (event.key === 'Enter') {
      // Only claim Enter while the list is open; otherwise the page keeps it
      if (!open || this.optionEls.length === 0) return;
      event.preventDefault();
      const target = this.optionEls[this.activeIndex >= 0 ? this.activeIndex : 0];
      if (target) target.click();
      return;
    }
    if (event.key === 'Escape') {
      this.hideDropdown();
    }
  }

  isDropdownOpen() {
    return !!(this.dropdown && this.dropdown.style.display !== 'none');
  }

  // One active option, shared by hover and arrow keys, wrapping at both ends.
  setActive(index) {
    if (this.isDestroyed || this.optionEls.length === 0) return;
    const count = this.optionEls.length;
    const next = ((index % count) + count) % count;
    this.activeIndex = next;
    for (let i = 0; i < count; i++) {
      const el = this.optionEls[i];
      const active = i === next;
      el.style.background = active ? '#E8F0FE' : (el.dataset.baseBg || '#fff');
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    const activeEl = this.optionEls[next];
    if (activeEl) {
      if (activeEl.id && this.input) this.input.setAttribute('aria-activedescendant', activeEl.id);
      if (typeof activeEl.scrollIntoView === 'function') activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  handleDocumentPointerDown(event) {
    if (this.isDestroyed) return;
    const target = event && event.target;
    if (!target) return;
    if (target === this.input) return;
    if (this.dropdown && this.dropdown.contains(target)) return;
    this.hideDropdown();
  }

  handleDocumentKeyDown(event) {
    if (this.isDestroyed) return;
    if (event && event.key === 'Escape') {
      this.hideDropdown();
    }
  }

  handleInput(value) {
    if (this.isDestroyed) return;
    const query = value.toLowerCase().trim();

    if (query.length < this.options.minChars) {
      this.hideDropdown();
      return;
    }

    const matches = filterRoles(this.roles, query, this.options.maxResults);

    if (matches.length > 0 || this.options.showCustomOption) {
      this.showDropdown(matches, value);
    } else {
      this.hideDropdown();
    }
  }

  showDropdown(matches, rawQuery) {
    if (this.isDestroyed || !this.dropdown) return;
    const query = rawQuery.trim();
    this.dropdown.innerHTML = '';
    this.dropdown.style.display = 'block';
    this.optionEls = [];
    this.activeIndex = -1;
    if (this.input) {
      this.input.setAttribute('aria-expanded', 'true');
      this.input.removeAttribute('aria-activedescendant');
    }

    const idBase = (this.input && this.input.id ? this.input.id : 'role') + '-option-';
    const addOption = (el) => {
      const index = this.optionEls.length;
      el.id = idBase + index;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      // Hover and arrow keys share one active state, so what the mouse
      // highlights is exactly what Enter would pick.
      el.addEventListener('mouseover', () => this.setActive(index));
      this.optionEls.push(el);
      this.dropdown.appendChild(el);
    };

    matches.forEach((role) => {
      const optionDiv = document.createElement('div');
      optionDiv.className = 'role-option';
      optionDiv.dataset.role = role.name;
      optionDiv.dataset.baseBg = '#fff';
      optionDiv.style.cssText = `
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-bottom: 1px solid #F3F4F6;
        transition: background 0.15s;
        background: #fff;
      `;

      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-weight: 600; color: #111827; font-size: 1rem;';
      nameDiv.innerHTML = highlightRoleMatch(role.name, query);
      optionDiv.appendChild(nameDiv);

      const categoryLabel = prettyCategory(role.category);
      if (categoryLabel) {
        const categoryDiv = document.createElement('div');
        categoryDiv.style.cssText = 'font-size: 0.85rem; color: #4B5563; margin-top: 0.2rem;';
        categoryDiv.textContent = categoryLabel;
        optionDiv.appendChild(categoryDiv);
      }

      optionDiv.addEventListener('click', () => {
        this.selectRole(optionDiv.dataset.role);
      });

      addOption(optionDiv);
    });

    if (this.options.showCustomOption) {
      const customDiv = document.createElement('div');
      customDiv.className = 'role-option role-custom';
      customDiv.dataset.role = 'custom';
      customDiv.dataset.baseBg = '#F9FAFB';
      customDiv.style.cssText = `
        padding: 0.75rem 1rem;
        cursor: pointer;
        background: #F9FAFB;
        border-top: 2px solid #E5E7EB;
        font-style: italic;
        color: #4B5563;
      `;
      customDiv.textContent = `Use "${query}" as custom role`;
      customDiv.addEventListener('click', () => {
        this.selectRole(query);
      });
      addOption(customDiv);
    }
  }

  selectRole(roleName) {
    if (this.isDestroyed || !this.input) return;
    this.input.value = roleName;
    this.hideDropdown();
    this.saveRecentSelection(roleName);
    this.trackSelection(roleName);

    if (this.options.onSelect) {
      this.options.onSelect(roleName, this.isCustomRole(roleName));
    }
  }

  isCustomRole(roleName) {
    return !this.roles.some((role) => role.name.toLowerCase() === roleName.toLowerCase());
  }

  trackSelection(roleName) {
    const isCustom = this.isCustomRole(roleName);

    if (window.gtag) {
      window.gtag('event', 'role_selected', {
        role_name: roleName,
        role_type: isCustom ? 'custom' : 'standard',
        event_category: 'resume_feedback'
      });
    }

    try {
      const telemetry = JSON.parse(localStorage.getItem('roleSelectorTelemetry') || '[]');
      telemetry.push({
        role: roleName,
        type: isCustom ? 'custom' : 'standard',
        timestamp: Date.now()
      });
      localStorage.setItem('roleSelectorTelemetry', JSON.stringify(telemetry.slice(-100)));
    } catch (e) {
      console.warn('[RoleSelector] Failed to track selection:', e);
    }
  }

  saveRecentSelection(roleName) {
    this.recentSelections = this.recentSelections.filter((r) => r !== roleName);
    this.recentSelections.unshift(roleName);
    this.recentSelections = this.recentSelections.slice(0, 10);
    localStorage.setItem('roleSelectorRecent', JSON.stringify(this.recentSelections));
  }

  loadRecentSelections() {
    try {
      return JSON.parse(localStorage.getItem('roleSelectorRecent') || '[]');
    } catch (e) {
      return [];
    }
  }

  hideDropdown() {
    if (this.dropdown) {
      this.dropdown.style.display = 'none';
    }
    this.optionEls = [];
    this.activeIndex = -1;
    if (this.input) {
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  showHint() {
    if (!this.input || this.isDestroyed) return;
    if (!this.input.placeholder) {
      this.input.placeholder = 'Start typing your target role (e.g., Product Manager, Data Engineer)';
    }
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.blurHideTimeout) {
      clearTimeout(this.blurHideTimeout);
      this.blurHideTimeout = null;
    }

    this.input?.removeEventListener('input', this.handleInputEvent);
    this.input?.removeEventListener('focus', this.handleFocusEvent);
    this.input?.removeEventListener('blur', this.handleBlurEvent);
    this.input?.removeEventListener('keydown', this.handleInputKeyDown);

    if (this.input && this.input.__jobHackAIRoleSelectorInstance === this) {
      delete this.input.__jobHackAIRoleSelectorInstance;
    }

    ROLE_SELECTOR_INSTANCES.delete(this);
    unbindRoleSelectorDocumentListenersIfUnused();

    this.hideDropdown();
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }
    this.dropdown = null;
  }
}

if (typeof window !== 'undefined') {
  window.RoleSelector = RoleSelector;
}
