(() => {
  // Shared randomized background pool; bump this file to trigger the site deploy.
  const sets = [
    ['me01', 188],
    ['me02', 130],
    ['me02.5', 295],
    ['me03', 124],
    ['me04', 122],
    ['me05', 120]
  ];

  const totalCards = sets.reduce((sum, [, count]) => sum + count, 0);

  function randomIndex(max) {
    if (globalThis.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      globalThis.crypto.getRandomValues(value);
      return value[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function cardPath(index) {
    let offset = index;
    for (const [setId, count] of sets) {
      if (offset < count) return `card-images/${setId}/${offset + 1}.webp`;
      offset -= count;
    }
    return 'card-images/me01/1.webp';
  }

  function randomCardPaths(amount) {
    const selected = new Set();
    while (selected.size < Math.min(amount, totalCards)) {
      selected.add(randomIndex(totalCards));
    }
    return [...selected].map(cardPath);
  }

  function buildBackground(container) {
    const amount = matchMedia('(max-width: 640px)').matches ? 7 : 12;
    const paths = randomCardPaths(amount);
    container.replaceChildren(...paths.map((src) => {
      const card = document.createElement('div');
      card.className = 'fc';
      const image = document.createElement('img');
      image.src = src;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      card.append(image);
      return card;
    }));
  }

  function init() {
    document.querySelectorAll('.floating-bg').forEach(buildBackground);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
