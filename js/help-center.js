/**
 * Help Center Search Functionality
 * Client-side search similar to role-selector.js pattern
 */

class HelpCenterSearch {
  constructor() {
    this.searchInput = document.getElementById('help-search');
    this.resultsContainer = document.getElementById('help-search-results');
    this.allSections = [];
    this.currentQuery = '';
    
    if (!this.searchInput || !this.resultsContainer) {
      console.warn('[Help Center] Search elements not found');
      return;
    }
    
    this.extractAllContent();
    this.setupListeners();
    this.setupTocHighlighting();
  }

  extractAllContent() {
    // Extract all questions and answers from the page
    document.querySelectorAll('.help-section').forEach(section => {
      const sectionTitle = section.querySelector('.help-section-title')?.textContent || '';
      const sectionId = section.id;
      
      section.querySelectorAll('.help-question').forEach(qa => {
        const question = qa.querySelector('.help-q')?.textContent || '';
        const answer = qa.querySelector('.help-a')?.textContent || '';
        
        this.allSections.push({
          sectionTitle,
          sectionId,
          question,
          answer,
          fullText: `${question} ${answer}`.toLowerCase(),
          element: qa
        });
      });
    });
  }

  setupListeners() {
    // Debounced search (waits 300ms after user stops typing)
    let searchTimeout;
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      this.currentQuery = query;
      
      searchTimeout = setTimeout(() => {
        if (query.length < 2) {
          this.hideResults();
          this.showAllSections();
          this.clearHighlights();
          return;
        }
        this.performSearch(query);
      }, 300);
    });

    // Close results on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.help-search-container')) {
        this.hideResults();
        // Restore consistent state: clear search, show all sections, clear highlights
        // Only if there's an active search query to avoid disrupting user's current view
        if (this.searchInput.value.trim().length >= 2) {
          this.searchInput.value = '';
          this.showAllSections();
          this.clearHighlights();
        }
      }
    });

    // Keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideResults();
        this.searchInput.value = '';
        this.showAllSections();
        this.clearHighlights();
      }
    });
  }

  performSearch(query) {
    const searchTerm = query.toLowerCase();
    const matches = this.allSections.filter(item => 
      item.fullText.includes(searchTerm) ||
      item.question.toLowerCase().includes(searchTerm) ||
      item.answer.toLowerCase().includes(searchTerm) ||
      item.sectionTitle.toLowerCase().includes(searchTerm)
    );

    if (matches.length > 0) {
      this.showResults(matches, query);
      this.highlightMatches(matches);
    } else {
      this.showNoResults(query);
      this.hideAllSections();
    }
  }

  showResults(matches, query) {
    this.resultsContainer.innerHTML = '';
    this.resultsContainer.hidden = false;

    // Group by section
    const bySection = {};
    matches.forEach(match => {
      if (!bySection[match.sectionId]) {
        bySection[match.sectionId] = {
          title: match.sectionTitle,
          items: []
        };
      }
      bySection[match.sectionId].items.push(match);
    });

    // Render results
    Object.entries(bySection).forEach(([sectionId, data]) => {
      const sectionDiv = document.createElement('div');
      sectionDiv.className = 'help-search-result-section';
      sectionDiv.innerHTML = `
        <h3 class="help-search-section-title">${this.escapeHtml(data.title)}</h3>
        ${data.items.map(item => `
          <div class="help-search-result-item" data-section="${sectionId}" data-question="${this.escapeHtml(item.question)}">
            <div class="help-search-question">${this.highlightText(item.question, query)}</div>
            <div class="help-search-preview">${this.highlightText(item.answer.substring(0, 150), query)}...</div>
          </div>
        `).join('')}
      `;
      this.resultsContainer.appendChild(sectionDiv);
    });

    // Click handler to scroll to result
    this.resultsContainer.querySelectorAll('.help-search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const sectionId = item.dataset.section;
        const question = item.dataset.question;
        this.scrollToResult(sectionId, question);
        this.hideResults();
        this.searchInput.value = ''; // Clear search after selection
        this.showAllSections();
        // Don't clear highlights here - scrollToResult sets a temporary highlight
        // that will clear itself after 2 seconds
      });
    });
  }

  highlightText(text, query) {
    if (!query) return this.escapeHtml(text);
    // Highlight BEFORE escaping to avoid matching HTML entities
    // Escape the query for regex, then apply highlighting to original text
    const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
    const highlighted = text.replace(regex, '<mark>$1</mark>');
    // Now escape the result, but preserve the <mark> tags
    return this.escapeHtmlPreservingMark(highlighted);
  }

  escapeHtmlPreservingMark(text) {
    // Escape HTML but preserve <mark> tags
    // First, temporarily replace mark tags with placeholders
    const markPlaceholder = '___MARK_TAG___';
    const endMarkPlaceholder = '___END_MARK_TAG___';
    const textWithPlaceholders = text
      .replace(/<mark>/gi, markPlaceholder)
      .replace(/<\/mark>/gi, endMarkPlaceholder);
    
    // Escape HTML
    const div = document.createElement('div');
    div.textContent = textWithPlaceholders;
    let escaped = div.innerHTML
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    // Restore mark tags
    return escaped
      .replace(new RegExp(markPlaceholder, 'g'), '<mark>')
      .replace(new RegExp(endMarkPlaceholder, 'g'), '</mark>');
  }

  escapeHtml(text) {
    // Properly escape HTML for use in attributes (escapes <, >, &, ", and ')
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML
      .replace(/"/g, '&quot;')  // Escape double quotes for HTML attributes
      .replace(/'/g, '&#39;');   // Escape single quotes for HTML attributes
  }

  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  highlightMatches(matches) {
    // Hide all sections first
    this.hideAllSections();
    
    // Show only matching sections and highlight
    const shownSections = new Set();
    matches.forEach(match => {
      shownSections.add(match.sectionId);
      const section = document.getElementById(match.sectionId);
      if (section) {
        section.style.display = 'block';
      }
    });

    // Scroll to first match
    if (matches.length > 0) {
      const firstMatch = matches[0];
      const section = document.getElementById(firstMatch.sectionId);
      if (section) {
        setTimeout(() => {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }

  scrollToResult(sectionId, questionText) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const questionEl = Array.from(section.querySelectorAll('.help-q'))
      .find(el => el.textContent.includes(questionText));
    
    if (questionEl) {
      questionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight briefly
      const originalBg = questionEl.style.backgroundColor;
      questionEl.style.backgroundColor = 'rgba(0, 122, 48, 0.1)';
      questionEl.style.transition = 'background-color 0.3s';
      setTimeout(() => {
        questionEl.style.backgroundColor = originalBg;
      }, 2000);
    }
  }

  showNoResults(query) {
    this.resultsContainer.innerHTML = `
      <div class="help-search-no-results">
        <p>No results found for "<strong>${this.escapeHtml(query)}</strong>"</p>
        <p class="help-search-suggestion">Try different keywords or <a href="support.html">contact support</a></p>
      </div>
    `;
    this.resultsContainer.hidden = false;
  }

  hideResults() {
    this.resultsContainer.hidden = true;
  }

  hideAllSections() {
    document.querySelectorAll('.help-section').forEach(section => {
      section.style.display = 'none';
    });
  }

  showAllSections() {
    document.querySelectorAll('.help-section').forEach(section => {
      section.style.display = 'block';
    });
  }

  clearHighlights() {
    // Remove any temporary highlights
    document.querySelectorAll('.help-q').forEach(el => {
      el.style.backgroundColor = '';
      el.style.transition = '';
    });
  }

  setupTocHighlighting() {
    // Highlight active TOC link based on scroll position
    const tocLinks = document.querySelectorAll('.help-toc-link');
    const sections = document.querySelectorAll('.help-section');

    if (tocLinks.length === 0 || sections.length === 0) return;

    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.id;
          // Skip sections without IDs (e.g., "Still Need Help?" section)
          if (!sectionId) return;
          
          tocLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${sectionId}`) {
              link.classList.add('active');
            }
          });
        }
      });
    }, observerOptions);

    sections.forEach(section => {
      observer.observe(section);
    });

    // Also handle click on TOC links
    tocLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent triggering document click handler
        
        const targetId = link.getAttribute('href').substring(1);
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          // If there's an active search, clear it and show all sections first
          // This ensures the target section is visible before scrolling
          if (this.searchInput.value.trim().length >= 2) {
            this.searchInput.value = '';
            this.showAllSections();
            this.clearHighlights();
            this.hideResults();
          }
          
          // Small delay to ensure section is visible before scrolling
          setTimeout(() => {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Update active state
            tocLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
          }, 50);
        }
      });
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  new HelpCenterSearch();
});

