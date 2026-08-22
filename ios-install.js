(() => {
  const installBtn = document.getElementById('installBtn');
  const toast = document.getElementById('toast');
  if (!installBtn) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  if (isIOS && !standalone) {
    installBtn.hidden = false;
    installBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast('On iPhone/iPad: tap Share, then “Add to Home Screen”.');
    }, { capture: true });
  }
})();
