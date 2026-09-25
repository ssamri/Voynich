// Applique le thème avant le premier rendu (évite le flash de couleur).
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('vx-theme') || 'system';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
