// Wix Migration Utilities
class WixMigrationHelper {
  constructor() {
    this.componentMap = {
      // Layout Components
      'mi-card': 'wix-card',
      'mi-main': 'wix-container',
      'mi-history-sidebar': 'wix-sidebar',
      
      // Form Components
      'clg-input': 'wix-input',
      'clg-btn': 'wix-button',
      'clg-label': 'wix-label',
      
      // Navigation
      'nav-links': 'wix-menu',
      'mobile-nav': 'wix-mobile-menu',
      
      // Feedback Components
      'mi-feedback': 'wix-feedback',
      'mi-score-grid': 'wix-grid'
    };

    this.styleMap = {
      // Colors
      '--color-bg-light': 'wix-color-1',
      '--color-text-main': 'wix-color-2',
      '--color-text-secondary': 'wix-color-3',
      '--color-cta-green': 'wix-color-4',
      '--color-accent-blue': 'wix-color-5',
      
      // Typography
      '--font-family-base': 'wix-font-1',
      '--font-weight-regular': 'wix-font-weight-1',
      '--font-weight-bold': 'wix-font-weight-2',
      
      // Spacing
      '--space-xs': 'wix-spacing-1',
      '--space-sm': 'wix-spacing-2',
      '--space-md': 'wix-spacing-3',
      '--space-lg': 'wix-spacing-4'
    };
  }

  // Convert CSS classes to Wix components
  convertClassToWix(className) {
    return this.componentMap[className] || className;
  }

  // Convert CSS variables to Wix styles
  convertStyleToWix(styleValue) {
    return this.styleMap[styleValue] || styleValue;
  }

  // Generate Wix component code
  generateWixComponent(componentName, props) {
    const wixComponent = this.convertClassToWix(componentName);
    return `$w('${wixComponent}').setProps(${JSON.stringify(props, null, 2)})`;
  }

  // Convert CSS to Wix styles
  convertCSSToWix(css) {
    let wixCSS = css;
    Object.entries(this.styleMap).forEach(([original, wix]) => {
      wixCSS = wixCSS.replace(new RegExp(original, 'g'), wix);
    });
    return wixCSS;
  }

  // Generate Wix page structure
  generateWixPageStructure(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Convert elements to Wix components
    const convertElement = (element) => {
      const className = element.className;
      const wixComponent = this.convertClassToWix(className);
      
      // Generate Wix component code
      const props = {
        id: element.id,
        className: wixComponent,
        children: Array.from(element.children).map(convertElement)
      };
      
      return this.generateWixComponent(wixComponent, props);
    };
    
    return convertElement(doc.body);
  }

  // Generate Wix data binding
  generateWixDataBinding(data) {
    return {
      $w: {
        // Page data
        pageData: {
          title: data.title,
          description: data.description
        },
        
        // User data
        userData: {
          name: data.userName,
          email: data.userEmail,
          plan: data.userPlan
        },
        
        // Interview data
        interviewData: {
          role: data.role,
          score: data.score,
          feedback: data.feedback
        }
      }
    };
  }
}

// Export the migration helper
export default WixMigrationHelper; 