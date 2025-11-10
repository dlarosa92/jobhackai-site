// Dynamic Role Selector with Firestore integration
// Supports auto-complete, custom roles, and telemetry

import { getFirestore, collection, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { app } from './firebase-config.js';

/**
 * Role Selector Component
 * Loads roles from Firestore collection 'roles' with fallback to pre-seeded list
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
    this.init();
  }

  async init() {
    // Create dropdown element
    this.createDropdown();
    
    // Load roles from Firestore or use fallback
    await this.loadRoles();
    
    // Setup event listeners
    this.setupListeners();
    
    // Show hint
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
    
    // Insert after input
    this.input.parentNode.insertBefore(this.dropdown, this.input.nextSibling);
  }

  async loadRoles() {
    try {
      // Try to load from Firestore
      const db = getFirestore(app);
      const rolesRef = collection(db, 'roles');
      const q = query(rolesRef, orderBy('name'), limit(100));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        this.roles = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          category: doc.data().category || 'general',
          type: 'standard'
        }));
      } else {
        // Fallback to pre-seeded roles
        this.roles = this.getPreSeededRoles();
      }
    } catch (error) {
      console.warn('[RoleSelector] Firestore load failed, using fallback:', error);
      // Fallback to pre-seeded roles
      this.roles = this.getPreSeededRoles();
    }
  }

  getPreSeededRoles() {
    // Pre-seeded roles from Business Model Appendix B
    return [
      // AI/ML Roles
      { name: 'AI Engineer', category: 'ai-ml', type: 'standard' },
      { name: 'Machine Learning Engineer', category: 'ai-ml', type: 'standard' },
      { name: 'Data Scientist', category: 'ai-ml', type: 'standard' },
      { name: 'MLOps Engineer', category: 'ai-ml', type: 'standard' },
      
      // Data Roles
      { name: 'Data Engineer', category: 'data', type: 'standard' },
      { name: 'Data Analyst', category: 'data', type: 'standard' },
      { name: 'Business Intelligence Analyst', category: 'data', type: 'standard' },
      { name: 'Data Architect', category: 'data', type: 'standard' },
      
      // Software Engineering
      { name: 'Software Engineer', category: 'engineering', type: 'standard' },
      { name: 'Senior Software Engineer', category: 'engineering', type: 'standard' },
      { name: 'Full Stack Developer', category: 'engineering', type: 'standard' },
      { name: 'Backend Developer', category: 'engineering', type: 'standard' },
      { name: 'Frontend Developer', category: 'engineering', type: 'standard' },
      { name: 'DevOps Engineer', category: 'engineering', type: 'standard' },
      { name: 'Site Reliability Engineer', category: 'engineering', type: 'standard' },
      { name: 'Cloud Engineer', category: 'engineering', type: 'standard' },
      
      // Product & Management
      { name: 'Product Manager', category: 'product', type: 'standard' },
      { name: 'Product Owner', category: 'product', type: 'standard' },
      { name: 'Technical Product Manager', category: 'product', type: 'standard' },
      { name: 'Scrum Master', category: 'agile', type: 'standard' },
      { name: 'Project Manager', category: 'management', type: 'standard' },
      { name: 'Engineering Manager', category: 'management', type: 'standard' },
      
      // Design
      { name: 'UX Designer', category: 'design', type: 'standard' },
      { name: 'UI Designer', category: 'design', type: 'standard' },
      { name: 'Product Designer', category: 'design', type: 'standard' },
      { name: 'Graphic Designer', category: 'design', type: 'standard' },
      
      // Marketing & Sales
      { name: 'Digital Marketing Manager', category: 'marketing', type: 'standard' },
      { name: 'SEO Specialist', category: 'marketing', type: 'standard' },
      { name: 'Content Writer', category: 'marketing', type: 'standard' },
      { name: 'Social Media Manager', category: 'marketing', type: 'standard' },
      { name: 'Sales Representative', category: 'sales', type: 'standard' },
      { name: 'Account Executive', category: 'sales', type: 'standard' },
      
      // Business & Operations
      { name: 'Business Analyst', category: 'business', type: 'standard' },
      { name: 'Operations Manager', category: 'business', type: 'standard' },
      { name: 'Customer Success Manager', category: 'business', type: 'standard' },
      { name: 'HR Specialist', category: 'hr', type: 'standard' },
      { name: 'Recruiter', category: 'hr', type: 'standard' },
      
      // Finance & Legal
      { name: 'Financial Analyst', category: 'finance', type: 'standard' },
      { name: 'Accountant', category: 'finance', type: 'standard' },
      { name: 'Legal Assistant', category: 'legal', type: 'standard' },
      { name: 'Paralegal', category: 'legal', type: 'standard' },
      
      // Administrative
      { name: 'Administrative Assistant', category: 'admin', type: 'standard' },
      { name: 'Executive Assistant', category: 'admin', type: 'standard' },
      { name: 'Office Manager', category: 'admin', type: 'standard' }
    ];
  }

  setupListeners() {
    // Input handler
    this.input.addEventListener('input', (e) => {
      this.handleInput(e.target.value);
    });

    // Focus handler
    this.input.addEventListener('focus', () => {
      if (this.input.value.length >= this.options.minChars) {
        this.handleInput(this.input.value);
      }
    });

    // Blur handler (delay to allow click)
    this.input.addEventListener('blur', () => {
      setTimeout(() => {
        this.hideDropdown();
      }, 200);
    });

    // Keyboard navigation
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        this.handleKeyboard(e.key);
      }
    });
  }

  handleInput(value) {
    const query = value.toLowerCase().trim();
    
    if (query.length < this.options.minChars) {
      this.hideDropdown();
      return;
    }

    // Filter roles
    const matches = this.roles
      .filter(role => role.name.toLowerCase().includes(query))
      .slice(0, this.options.maxResults);

    // Show dropdown with matches
    if (matches.length > 0 || this.options.showCustomOption) {
      this.showDropdown(matches, query);
    } else {
      this.hideDropdown();
    }
  }

  showDropdown(matches, query) {
    let html = '';

    // Add matches
    matches.forEach((role, index) => {
      html += `
        <div class="role-option" data-role="${role.name}" data-index="${index}" style="
          padding: 0.75rem 1rem;
          cursor: pointer;
          border-bottom: 1px solid #F3F4F6;
          transition: background 0.15s;
        " onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='#fff'">
          <div style="font-weight: 500; color: #1F2937;">${this.highlightMatch(role.name, query)}</div>
          ${role.category ? `<div style="font-size: 0.875rem; color: #6B7280; margin-top: 0.25rem;">${role.category}</div>` : ''}
        </div>
      `;
    });

    // Add custom option
    if (this.options.showCustomOption) {
      html += `
        <div class="role-option role-custom" data-role="custom" style="
          padding: 0.75rem 1rem;
          cursor: pointer;
          background: #F9FAFB;
          border-top: 2px solid #E5E7EB;
          font-style: italic;
          color: #6B7280;
        " onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background='#F9FAFB'">
          Use "${query}" as custom role
        </div>
      `;
    }

    this.dropdown.innerHTML = html;
    this.dropdown.style.display = 'block';

    // Add click handlers
    this.dropdown.querySelectorAll('.role-option').forEach(option => {
      option.addEventListener('click', () => {
        this.selectRole(option.dataset.role === 'custom' ? query : option.dataset.role);
      });
    });
  }

  highlightMatch(text, query) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return text;
    
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);
    
    return `${before}<strong>${match}</strong>${after}`;
  }

  selectRole(roleName) {
    this.input.value = roleName;
    this.hideDropdown();
    
    // Save to recent selections
    this.saveRecentSelection(roleName);
    
    // Track telemetry
    this.trackSelection(roleName);
    
    // Callback
    if (this.options.onSelect) {
      this.options.onSelect(roleName, this.isCustomRole(roleName));
    }
  }

  isCustomRole(roleName) {
    return !this.roles.some(role => role.name.toLowerCase() === roleName.toLowerCase());
  }

  trackSelection(roleName) {
    const isCustom = this.isCustomRole(roleName);
    
    // Track in analytics (if available)
    if (window.gtag) {
      window.gtag('event', 'role_selected', {
        role_name: roleName,
        role_type: isCustom ? 'custom' : 'standard',
        event_category: 'resume_feedback'
      });
    }
    
    // Store in localStorage for telemetry
    try {
      const telemetry = JSON.parse(localStorage.getItem('roleSelectorTelemetry') || '[]');
      telemetry.push({
        role: roleName,
        type: isCustom ? 'custom' : 'standard',
        timestamp: Date.now()
      });
      // Keep last 100 selections
      localStorage.setItem('roleSelectorTelemetry', JSON.stringify(telemetry.slice(-100)));
    } catch (e) {
      console.warn('[RoleSelector] Failed to track selection:', e);
    }
  }

  saveRecentSelection(roleName) {
    this.recentSelections = this.recentSelections.filter(r => r !== roleName);
    this.recentSelections.unshift(roleName);
    this.recentSelections = this.recentSelections.slice(0, 10); // Keep last 10
    
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
    this.dropdown.style.display = 'none';
  }

  handleKeyboard(key) {
    // Keyboard navigation implementation
    const options = this.dropdown.querySelectorAll('.role-option');
    if (options.length === 0) return;
    
    // Implementation would go here
    // For now, just select first option on Enter
    if (key === 'Enter' && options.length > 0) {
      options[0].click();
    }
  }

  showHint() {
    if (!this.input.placeholder) {
      this.input.placeholder = 'Start typing your target role (e.g., Product Manager, Data Engineer)';
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.RoleSelector = RoleSelector;
}
