// --- BEGIN redirect tracer v2 (defensive) ---
(function(){
  try {
    if (window.__redirWrapped) return;
    const wrap = (obj, name) => {
      try {
        const orig = obj[name];
        if (typeof orig !== 'function') return;
        obj[name] = function(url){
          try { console.warn(`[REDIRECT TRACER] ${name}(${url})\nStack:\n${new Error().stack}`); } catch(_) {}
          return orig.apply(this, arguments);
        };
      } catch(_) { /* no-op */ }
    };
    wrap(location, 'replace');
    wrap(location, 'assign');
    try {
      const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
      if (desc && typeof desc.set === 'function') {
        const origSetHref = desc.set;
        Object.defineProperty(location, 'href', {
          set(v){ try { console.warn(`[REDIRECT TRACER] href = ${v}`); } catch(_) {} origSetHref.call(location, v); }
        });
      }
    } catch(_) { /* ignore if prototype not accessible */ }
    window.__redirWrapped = true;
    try { console.log('🧭 Redirect tracer enabled'); } catch(_) {}
  } catch(_) { /* never break auth redirect flow */ }
})();
