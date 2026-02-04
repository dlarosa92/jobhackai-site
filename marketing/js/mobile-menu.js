(() => {
  const toggle = document.querySelector('.mobile-toggle');
  const nav = document.getElementById('mobileNav');
  const backdrop = document.getElementById('mobileNavBackdrop');

  if (!toggle || !nav || !backdrop) {
    return;
  }

  const openMenu = () => {
    nav.classList.add('open');
    backdrop.classList.add('show');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  };

  const closeMenu = () => {
    nav.classList.remove('open');
    backdrop.classList.remove('show');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  const toggleMenu = (event) => {
    if (event) {
      event.preventDefault();
    }
    if (nav.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  toggle.addEventListener('click', toggleMenu);
  backdrop.addEventListener('click', closeMenu);

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeMenu();
    }
  });
})();
