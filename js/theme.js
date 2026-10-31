/* Applies the saved Style and Day / Night choice before the page paints, so there is no flash.
   js/app.js wires up the controls in the top bar. */
(function () {
  var t = null, s = null;
  try { t = localStorage.getItem('pte:theme'); s = localStorage.getItem('pte:skin'); } catch (e) { /* storage blocked */ }
  var skins = ['paper', 'system', 'win98', 'xp', 'win7', 'pico', 'mvp', 'new', 'sakura'];
  var lightOnly = ['system', 'win98', 'xp', 'win7'];
  if (skins.indexOf(s) < 0) s = 'paper';
  document.documentElement.setAttribute('data-skin', s);
  if (lightOnly.indexOf(s) >= 0) t = 'light';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
