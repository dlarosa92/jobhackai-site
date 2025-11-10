/**
 * JobHackAI Role Selector Component
 * AI-assisted searchable combo-box for job titles
 */

(function() {
  'use strict';

  // Common job roles database (can be loaded from roles.json or Firebase)
  const COMMON_ROLES = [
    // Engineering
    'Software Engineer', 'Full-stack Developer', 'Backend Developer', 'Frontend Developer',
    'Platform Engineer', 'DevOps Engineer', 'Site Reliability Engineer (SRE)',
    'Data Engineer', 'Data Scientist', 'AI Engineer', 'ML Engineer', 'LLM Engineer',
    'Security Engineer', 'Cloud Engineer', 'Infrastructure Engineer',
    
    // Product & Management
    'Product Manager', 'Product Owner', 'Epic Owner', 'Business Owner',
    'Technical Product Manager', 'Product Designer', 'UX Designer', 'UI Designer',
    'UX/UI Developer', 'UX Researcher',
    
    // Agile & Delivery
    'Scrum Master', 'Release Train Engineer (RTE)', 'Agile Coach',
    'Delivery Manager', 'Program Manager',
    
    // Architecture
    'Solution Architect', 'System Architect', 'Data Architect', 'Enterprise Architect',
    'Cloud Architect', 'Security Architect',
    
    // Quality & Testing
    'QA Engineer', 'Test Engineer', 'QA Automation Engineer', 'Quality Assurance Manager',
    
    // Security
    'Threat Analyst', 'Security Analyst', 'Cybersecurity Engineer', 'Information Security Analyst',
    
    // Data & Analytics
    'Data Analyst', 'Business Analyst', 'Data Management', 'IT Governance',
    'Business Intelligence Analyst', 'Analytics Engineer',
    
    // Other
    'Technical Writer', 'Technical Program Manager', 'Engineering Manager',
    'Software Architect', 'Lead Software Engineer', 'Senior Software Engineer'
  ];

  /**
   * Filter roles based on search query
   * @param {string} query - Search query
   * @param {Array<string>} roles - Roles array
   * @returns {Array<string>} Filtered roles
   */
  function filterRoles(query, roles = COMMON_ROLES) {
    if (!query || query.trim().length === 0) {
      return roles.slice(0, 10); // Show top 10 by default
    }

    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/);

    // Score each role
    const scored = roles.map(role => {
      const roleLower = role.toLowerCase();
      let score = 0;

      // Exact match gets highest score
      if (roleLower === queryLower) {
        score = 1000;
      }
      // Starts with query
      else if (roleLower.startsWith(queryLower)) {
        score = 500;
      }
      // Contains all query words
      else if (queryWords.every(word => roleLower.includes(word))) {
        score = 100;
        // Bonus for word order matching
        const roleWords = roleLower.split(/\s+/);
        let wordOrderMatch = 0;
        for (let i = 0; i < Math.min(queryWords.length, roleWords.length); i++) {
          if (roleWords[i].startsWith(queryWords[i])) {
            wordOrderMatch++;
          }
        }
        score += wordOrderMatch * 50;
      }
      // Contains any query word
      else if (queryWords.some(word => roleLower.includes(word))) {
        score = 50;
      }

      return { role, score };
    });

    // Sort by score and return top matches
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.role);
  }

  /**
   * Create searchable role selector
   * @param {HTMLElement} inputElement - Input element to enhance
   * @param {Object} options - Configuration options
   * @returns {Object} Controller object
   */
  function createRoleSelector(inputElement, options = {}) {
    const {
      placeholder = 'Start typing your target role (e.g., Data Engineer, Product Manager)',
      showTooltip = true,
      customRoles = []
    } = options;

    if (!inputElement) {
      console.error('[ROLE-SELECTOR] Input element required');
      return null;
    }

    // Combine custom roles with common roles
    const allRoles = [...new Set([...customRoles, ...COMMON_ROLES])];

    // Set placeholder
    inputElement.placeholder = placeholder;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'jh-role-dropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
      margin-top: 4px;
    `;

    // Wrap input in container for positioning
    const container = document.createElement('div');
    container.style.cssText = 'position: relative; width: 100%;';
    inputElement.parentNode.insertBefore(container, inputElement);
    container.appendChild(inputElement);
    container.appendChild(dropdown);

    // Tooltip
    if (showTooltip) {
      const tooltip = document.createElement('div');
      tooltip.className = 'jh-role-tooltip';
      tooltip.style.cssText = `
        font-size: 0.875rem;
        color: #6B7280;
        margin-top: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      `;
      tooltip.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span>Start typing to see suggestions</span>
      `;
      container.appendChild(tooltip);
    }

    // Render dropdown items
    function renderDropdownItems(roles) {
      dropdown.innerHTML = '';

      if (roles.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.cssText = `
          padding: 1rem;
          color: #6B7280;
          text-align: center;
          font-size: 0.95rem;
        `;
        noResults.textContent = 'No matching roles found';
        dropdown.appendChild(noResults);
        return;
      }

      roles.forEach(role => {
        const item = document.createElement('div');
        item.className = 'jh-role-item';
        item.style.cssText = `
          padding: 0.75rem 1rem;
          cursor: pointer;
          transition: background 0.15s;
          border-bottom: 1px solid #F3F4F6;
        `;
        item.textContent = role;

        item.addEventListener('mouseenter', () => {
          item.style.background = '#F9FAFB';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'white';
        });

        item.addEventListener('click', () => {
          inputElement.value = role;
          dropdown.style.display = 'none';
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        });

        dropdown.appendChild(item);
      });

      // Add "Other / Custom Role" option
      const customItem = document.createElement('div');
      customItem.className = 'jh-role-item jh-role-custom';
      customItem.style.cssText = `
        padding: 0.75rem 1rem;
        cursor: pointer;
        transition: background 0.15s;
        background: #F9FAFB;
        font-style: italic;
        color: #6B7280;
        border-top: 2px solid #E5E7EB;
      `;
      customItem.textContent = 'Other / Custom Role';
      customItem.addEventListener('click', () => {
        inputElement.focus();
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(customItem);
    }

    // Handle input
    let debounceTimer;
    inputElement.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();

      debounceTimer = setTimeout(() => {
        if (query.length === 0) {
          dropdown.style.display = 'none';
          return;
        }

        const filtered = filterRoles(query, allRoles);
        renderDropdownItems(filtered);
        dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
      }, 150);
    });

    // Handle focus
    inputElement.addEventListener('focus', () => {
      const query = inputElement.value.trim();
      if (query.length > 0) {
        const filtered = filterRoles(query, allRoles);
        renderDropdownItems(filtered);
        dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
      }
    });

    // Handle blur (with delay to allow clicks)
    inputElement.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.style.display = 'none';
      }, 200);
    });

    // Handle keyboard navigation
    let selectedIndex = -1;
    inputElement.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.jh-role-item:not(.jh-role-custom)');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        if (items[selectedIndex]) {
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
          items[selectedIndex].style.background = '#F3F4F6';
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        items.forEach((item, idx) => {
          item.style.background = idx === selectedIndex ? '#F3F4F6' : 'white';
        });
      } else if (e.key === 'Enter' && selectedIndex >= 0 && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].click();
      } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        selectedIndex = -1;
      }
    });

    return {
      input: inputElement,
      dropdown,
      filterRoles: (query) => filterRoles(query, allRoles),
      setRoles: (roles) => {
        allRoles.length = 0;
        allRoles.push(...roles);
      }
    };
  }

  // Export public API
  window.JobHackAIRoleSelector = {
    createRoleSelector,
    filterRoles,
    COMMON_ROLES
  };
})();

