(() => {
  const label = document.getElementById('rangeLabel');
  if (!label) return;

  const normalize = () => {
    const text = label.textContent.trim();
    const match = text.match(/^Weeks\s+(\d+)–\1$/);
    if (match) label.textContent = `Week ${match[1]}`;
  };

  const observer = new MutationObserver(normalize);
  observer.observe(label, { childList: true, characterData: true, subtree: true });
  normalize();
})();
