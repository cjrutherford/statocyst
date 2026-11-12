/* Statocyst landing page: platform-aware download links and lazy clip playback.
   Release URLs are baked into the HTML by tools/build-site.mjs at build time. */
(() => {
  const ua = navigator.userAgent;
  let platform = null;
  const isIPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  if (/Android/i.test(ua)) platform = 'android';
  else if (/iPhone|iPad|iPod/i.test(ua) || isIPad) platform = 'ios';
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'mac';
  else if (/Windows/i.test(ua)) platform = 'windows';
  else if (/Linux/i.test(ua)) platform = 'linux';

  const labels = {
    linux: 'for Linux',
    mac: 'for macOS',
    windows: 'for Windows',
    android: 'for Android',
    ios: 'for iOS',
  };

  const hero = document.getElementById('hero-download');
  const heroOs = document.getElementById('hero-os');
  const shelf = document.getElementById('shelf-primary');

  if (platform) {
    document.documentElement.dataset.platform = platform;
    // The markup uses data-win for Windows; keep the platform keys readable.
    const dataKey = platform === 'windows' ? 'win' : platform;
    if (heroOs && labels[platform]) heroOs.textContent = labels[platform];
    // iOS users need the shelf's install notes, not a direct IPA tap.
    if (platform === 'ios' && heroOs) heroOs.textContent = 'for iOS (sideload)';

    if (shelf) {
      const shelfUrl = shelf.dataset[dataKey];
      if (shelfUrl) shelf.href = shelfUrl;
      const label = { linux: 'Linux', mac: 'macOS', windows: 'Windows', android: 'Android', ios: 'iOS' }[platform];
      if (label) shelf.firstChild.textContent = `Download for ${label} `;
    }

    document.querySelectorAll('.download-row').forEach((row) => {
      if (row.dataset.os === platform) row.classList.add('is-detected');
    });
  }

  const clips = [...document.querySelectorAll('.video-phone')];

  for (const wrap of clips) {
    const video = wrap.querySelector('video');
    const toggle = wrap.querySelector('.video-toggle');
    if (!video || !toggle) continue;

    const label = () => {
      toggle.textContent = video.paused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} the ${wrap.querySelector('figcaption span')?.textContent || 'Statocyst'} clip`);
    };

    toggle.addEventListener('click', () => {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    video.addEventListener('play', label);
    video.addEventListener('pause', label);
    label();
  }
})();

/* Android Auto preview tabs (the only constructed car screens). */
(() => {
  const preview = document.querySelector('[data-car-preview]');
  if (!preview) return;
  const tabs = [...preview.querySelectorAll('[data-car-screen]')];
  const panel = preview.querySelector('#car-panel');
  const image = preview.querySelector('#car-screen');
  const full = preview.querySelector('#car-full');
  if (!tabs.length || !panel || !image) return;

  const screens = {
    'now-playing': {
      src: 'assets/screens/car-head-unit-now-playing.svg',
      alt: 'Constructed Android Auto now playing screen for Statocyst',
    },
    browse: {
      src: 'assets/screens/car-head-unit-browse.svg',
      alt: 'Constructed Android Auto browse screen for Statocyst',
    },
  };

  const select = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    const screen = screens[tab.dataset.carScreen];
    if (!screen) return;
    image.src = screen.src;
    image.alt = screen.alt;
    if (full) full.href = screen.src;
    panel.setAttribute('aria-labelledby', tab.id);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      tabs[next].focus();
      select(tabs[next]);
    });
  });
})();
