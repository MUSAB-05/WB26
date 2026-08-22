(() => {
  const root = document.documentElement;
  const btn = document.getElementById('themeBtn');
  const meta = document.getElementById('themeColorMeta');
  if (!btn) return;

  const getTheme = () => root.dataset.theme === 'light' ? 'light' : 'dark';
  const sync = () => {
    const theme = getTheme();
    const light = theme === 'light';
    btn.textContent = light ? '🌙' : '💡';
    btn.title = light ? 'Switch to dark mode' : 'Switch to light mode';
    btn.setAttribute('aria-label', btn.title);
    meta?.setAttribute('content', light ? '#eef0f4' : '#252630');
  };

  btn.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('wb-theme', next); } catch {}
    sync();
  });

  sync();
})();
