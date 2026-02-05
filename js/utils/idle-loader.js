// js/utils/idle-loader.js

export function loadScriptWhenIdle(src, callback) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = callback;
      document.head.appendChild(script);
    });
  } else {
    // Fallback for browsers that don't support requestIdleCallback
    // Load script after a short delay
    setTimeout(() => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = callback;
      document.head.appendChild(script);
    }, 500); // Adjust delay as needed
  }
}



