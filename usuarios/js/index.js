// /usuarios/js/index.js
(() => {
  // Ripple leve nos botões .yl-btn
  document.addEventListener('click', e => {
    const btn = e.target.closest('.yl-btn');
    if (!btn) return;
    const ripple = document.createElement('span');
    ripple.className = 'yl-ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top  = (e.clientY - rect.top  - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 450);
  });

  // Bottom nav: marca ativo
  const nav = document.querySelector('.yl-bottom-nav');
  if (nav) {
    nav.addEventListener('click', e => {
      const a = e.target.closest('a[data-nav]');
      if (!a) return;
      [...nav.querySelectorAll('a[data-nav]')].forEach(x => x.classList.remove('active'));
      a.classList.add('active');
    });
  }

  // Toggle do menu do header (se existir)
  const menuBtn = document.querySelector('[data-toggle="yl-menu"]');
  const menu    = document.querySelector('.yl-menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => menu.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && !menuBtn.contains(e.target)) menu.classList.remove('open');
    });
  }

  // Suaviza o scroll para âncoras
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
