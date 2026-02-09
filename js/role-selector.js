// Dynamic Role Selector with API integration
// Supports auto-complete, custom roles, and telemetry
// Loads roles from /api/roles endpoint (canonical 200-role list)

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
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
    this.init();
  }

  async init() {
    this.createDropdown();
    await this.loadRoles();
    this.setupListeners();
    this.showHint();
  }

  createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'role-selector-dropdown';
    this.dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #fff;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
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
    this.input.addEventListener('input', (e) => {
      this.handleInput(e.target.value);
    });

    this.input.addEventListener('focus', () => {
      if (this.input.value.length >= this.options.minChars) {
        this.handleInput(this.input.value);
      }
    });

    this.input.addEventListener('blur', () => {
      setTimeout(() => {
        this.hideDropdown();
      }, 200);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        this.handleKeyboard(e.key);
        return;
      }
      if (e.key === 'Escape') {
        this.hideDropdown();
      }
    });

    // Close suggestions before other UI clicks to avoid intercepting pointer events.
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  handleDocumentPointerDown(event) {
    const target = event && event.target;
    if (!target) return;
    if (target === this.input) return;
    if (this.dropdown && this.dropdown.contains(target)) return;
    this.hideDropdown();
  }

  handleDocumentKeyDown(event) {
    if (event && event.key === 'Escape') {
      this.hideDropdown();
    }
  }

  handleInput(value) {
    const query = value.toLowerCase().trim();

    if (query.length < this.options.minChars) {
      this.hideDropdown();
      return;
    }

    const matches = this.roles
      .filter((role) => role.name.toLowerCase().includes(query))
      .slice(0, this.options.maxResults);

    if (matches.length > 0 || this.options.showCustomOption) {
      this.showDropdown(matches, value);
    } else {
      this.hideDropdown();
    }
  }

  showDropdown(matches, rawQuery) {
    const query = rawQuery.trim();
    this.dropdown.innerHTML = '';
    this.dropdown.style.display = 'block';

    matches.forEach((role, index) => {
      const optionDiv = document.createElement('div');
      optionDiv.className = 'role-option';
      optionDiv.dataset.role = role.name;
      optionDiv.dataset.index = String(index);
      optionDiv.style.cssText = `
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-bottom: 1px solid #F3F4F6;
        transition: background 0.15s;
      `;

      optionDiv.addEventListener('mouseover', () => {
        optionDiv.style.background = '#F9FAFB';
      });
      optionDiv.addEventListener('mouseout', () => {
        optionDiv.style.background = '#fff';
      });

      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-weight: 500; color: #1F2937;';
      nameDiv.innerHTML = this.highlightMatch(role.name, query);
      optionDiv.appendChild(nameDiv);

      if (role.category) {
        const categoryDiv = document.createElement('div');
        categoryDiv.style.cssText = 'font-size: 0.875rem; color: #6B7280; margin-top: 0.25rem;';
        categoryDiv.textContent = role.category;
        optionDiv.appendChild(categoryDiv);
      }

      optionDiv.addEventListener('click', () => {
        this.selectRole(optionDiv.dataset.role === 'custom' ? query : optionDiv.dataset.role);
      });

      this.dropdown.appendChild(optionDiv);
    });

    if (this.options.showCustomOption) {
      const customDiv = document.createElement('div');
      customDiv.className = 'role-option role-custom';
      customDiv.dataset.role = 'custom';
      customDiv.style.cssText = `
        padding: 0.75rem 1rem;
        cursor: pointer;
        background: #F9FAFB;
        border-top: 2px solid #E5E7EB;
        font-style: italic;
        color: #6B7280;
      `;
      customDiv.addEventListener('mouseover', () => {
        customDiv.style.background = '#F3F4F6';
      });
      customDiv.addEventListener('mouseout', () => {
        customDiv.style.background = '#F9FAFB';
      });
      customDiv.textContent = `Use "${query}" as custom role`;
      customDiv.addEventListener('click', () => {
        this.selectRole(query);
      });
      this.dropdown.appendChild(customDiv);
    }
  }

  highlightMatch(text, query) {
    if (!query) {
      return this.escapeHtml(text);
    }

    // Find match position in original text (case-insensitive)
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    
    if (index === -1) {
      return this.escapeHtml(text);
    }

    // Split original text at match position, then escape each part separately
    // This ensures correct highlighting even if text contains HTML entities
    // We split first, then escape, to avoid position shifts from HTML entity encoding
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);

    return `${this.escapeHtml(before)}<strong>${this.escapeHtml(match)}</strong>${this.escapeHtml(after)}`;
  }

  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  selectRole(roleName) {
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
  }

  handleKeyboard(key) {
    const options = this.dropdown.querySelectorAll('.role-option');
    if (options.length === 0) return;

    if (key === 'Enter') {
      options[0].click();
    }
  }

  showHint() {
    if (!this.input.placeholder) {
      this.input.placeholder = 'Start typing your target role (e.g., Product Manager, Data Engineer)';
    }
  }
}

if (typeof window !== 'undefined') {
  window.RoleSelector = RoleSelector;
}
