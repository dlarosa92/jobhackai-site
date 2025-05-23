// usageMeter.js
// Handles mock-interview usage limits and progress indicators

/**
 * Initializes the usage meter for a given feature.
 * @param {Object} options
 * @param {string} options.interviewSelector - Selector for mock interview form
 * @param {string} options.feedbackSelector - Selector for feedback display
 */
export function initUsageMeter({ interviewSelector, feedbackSelector }) {
    const form = document.querySelector(interviewSelector);
    const feedback = document.querySelector(feedbackSelector);
    let used = 0;
    const maxAllowed = window.userTier === 'premium' ? Infinity : 0; // only premium
  
    if (!form) return;
  
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (used >= maxAllowed) {
        alert('Mock interviews available only for Premium subscribers.');
        return;
      }
      used++;
      updateMeter();
      // proceed with form submission logic...
    });
  
    function updateMeter() {
      if (!feedback) return;
      feedback.textContent = `Mock Interviews used: ${used} of ${maxAllowed}`}  
    }
  }
  