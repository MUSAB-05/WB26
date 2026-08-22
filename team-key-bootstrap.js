(() => {
  const configured = window.APP_CONFIG?.TEAM_TOKEN || '';
  if (!configured) return;

  try {
    const queryToken = new URLSearchParams(location.search).get('team');
    if (queryToken) {
      localStorage.setItem('wb-token', queryToken);
      return;
    }
    if (!localStorage.getItem('wb-token')) localStorage.setItem('wb-token', configured);
  } catch {
    // Local storage can be unavailable in restrictive browser modes.
  }
})();
