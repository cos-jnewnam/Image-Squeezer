// Shared by index.html and changelog.html. The pre-paint script in each page's
// head applies the saved choice; this only wires up the button.

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const themeBtn = document.getElementById('theme');

function isDark() {
  const choice = document.documentElement.dataset.theme;
  return choice ? choice === 'dark' : systemDark.matches;
}

function paintTheme() {
  if (!themeBtn) return;
  const dark = isDark();
  const label = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
  themeBtn.firstElementChild.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
}

themeBtn?.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  paintTheme();
});

// Only matters until someone picks a theme by hand.
systemDark.addEventListener('change', paintTheme);
paintTheme();
