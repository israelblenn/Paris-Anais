const INTERACTIVE =
  'a, button, input, select, textarea, label, [role="button"], .site-nav li, .bg-item, .scroll-track, .bgm';

function spawnFlower(x, y) {
  const flower = document.createElement('img');
  flower.className = 'flower-pop';
  flower.src = 'assets/flower.png';
  flower.alt = '';
  flower.style.left = `${x}px`;
  flower.style.top = `${y}px`;
  const driftDir = Math.random() < 0.5 ? -1 : 1;
  const drift = 5 + Math.floor(Math.random() * 6);
  flower.style.setProperty('--spin', `${Math.floor(Math.random() * 360)}deg`);
  flower.style.setProperty('--spin-dir', Math.random() < 0.5 ? '-1' : '1');
  flower.style.setProperty('--drift-apex-x', `${driftDir * drift}px`);
  document.body.appendChild(flower);
  flower.addEventListener('animationend', () => flower.remove(), { once: true });
}

document.addEventListener('click', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest(INTERACTIVE)) return;
  spawnFlower(event.clientX, event.clientY);
});
