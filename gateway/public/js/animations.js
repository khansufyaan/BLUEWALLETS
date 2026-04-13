/**
 * Blue Console — Animation Utilities
 *
 * Shared animation library for dashboard micro-interactions,
 * particle effects, counter animations, and visual feedback.
 */

// ─── KPI Counter Animation ───────────────────────────────────
export function animateCounter(el, target, opts = {}) {
  const { duration = 1200, prefix = '', suffix = '', decimals = 0 } = opts;
  const start = 0;
  const startTime = performance.now();

  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutExpo(progress);
    const current = start + (target - start) * eased;
    el.textContent = prefix + current.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ─── Animate all KPI cards in a container ────────────────────
export function animateKPIs(container) {
  container.querySelectorAll('[data-animate-to]').forEach((el, i) => {
    const target = parseFloat(el.dataset.animateTo);
    const prefix = el.dataset.animatePrefix || '';
    const suffix = el.dataset.animateSuffix || '';
    const decimals = parseInt(el.dataset.animateDecimals || '0');
    el.textContent = prefix + '0' + suffix;
    setTimeout(() => animateCounter(el, target, { prefix, suffix, decimals, duration: 1200 }), i * 100);
  });
}

// ─── Staggered fade-in for card grids ────────────────────────
export function staggerFadeIn(container, selector = '.card, .kpi-card, .chain-card') {
  const items = container.querySelectorAll(selector);
  items.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setTimeout(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 60);
  });
}

// ─── Particle burst animation (wallet creation) ──────────────
export function particleBurst(x, y, container) {
  const canvas = document.createElement('canvas');
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
  canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50';
  container.style.position = 'relative';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const colors = ['#2563EB', '#3B82F6', '#60A5FA', '#7C3AED', '#10B981', '#F59E0B'];
  const particles = Array.from({ length: 40 }, () => ({
    x, y,
    vx: (Math.random() - 0.5) * 8,
    vy: (Math.random() - 0.5) * 8 - 2,
    r: Math.random() * 4 + 1,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1,
    decay: Math.random() * 0.015 + 0.008,
  }));

  let raf;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= p.decay;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    if (alive) raf = requestAnimationFrame(draw);
    else { cancelAnimationFrame(raf); canvas.remove(); }
  }
  raf = requestAnimationFrame(draw);
}

// ─── Confetti explosion (milestone celebrations) ─────────────
export function confetti(container) {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const colors = ['#2563EB', '#3B82F6', '#60A5FA', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];
  const pieces = Array.from({ length: 100 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * -0.5,
    w: Math.random() * 8 + 4,
    h: Math.random() * 4 + 2,
    vx: (Math.random() - 0.5) * 4,
    vy: Math.random() * 3 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 10,
    life: 1,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.rotV;
      if (frame > 60) p.life -= 0.01;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 300) requestAnimationFrame(draw);
    else canvas.remove();
  }
  requestAnimationFrame(draw);
}

// ─── Transaction signing pipeline animation ──────────────────
export function animatePipeline(container) {
  const steps = container.querySelectorAll('.pipeline-step');
  steps.forEach((step, i) => {
    setTimeout(() => {
      step.classList.add('pipeline-active');
      const dot = step.querySelector('.pipeline-dot');
      if (dot) dot.classList.add('pipeline-dot-pulse');
      if (i > 0) {
        const connector = step.previousElementSibling?.querySelector('.pipeline-connector');
        if (connector) connector.classList.add('pipeline-connector-filled');
      }
    }, i * 600);
  });
}

// ─── HSM heartbeat pulse ─────────────────────────────────────
export function startHeartbeat(el) {
  let scale = 1;
  let growing = false;
  const interval = setInterval(() => {
    if (growing) {
      scale = 1.15;
      el.style.transform = `scale(${scale})`;
      el.style.boxShadow = '0 0 16px rgba(16,185,129,0.4)';
    } else {
      scale = 1;
      el.style.transform = `scale(${scale})`;
      el.style.boxShadow = '0 0 4px rgba(16,185,129,0.2)';
    }
    growing = !growing;
  }, 500);
  return () => clearInterval(interval);
}

// ─── Micro-interactions ──────────────────────────────────────
export function addHoverLift(container, selector = '.card, .kpi-card') {
  container.querySelectorAll(selector).forEach(el => {
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'translateY(-2px)';
      el.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'translateY(0)';
    });
  });
}

export function shakeElement(el) {
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

export function pulseElement(el) {
  el.style.animation = 'pulse-scale 0.6s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

// ─── Login gradient background animation ─────────────────────
export function animateLoginGradient(container) {
  let hue = 220;
  let direction = 1;
  const interval = setInterval(() => {
    hue += 0.2 * direction;
    if (hue > 260 || hue < 210) direction *= -1;
    container.style.backgroundImage = `
      radial-gradient(ellipse at 50% 0%, hsla(${hue}, 80%, 50%, 0.08) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 100%, hsla(${hue + 40}, 70%, 40%, 0.05) 0%, transparent 50%)
    `;
  }, 50);
  return () => clearInterval(interval);
}

// ─── Smooth number transition ────────────────────────────────
export function morphNumber(el, from, to, duration = 800) {
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + (to - from) * eased;
    el.textContent = Math.round(current).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── Typing animation for status text ────────────────────────
export function typeText(el, text, speed = 30) {
  el.textContent = '';
  let i = 0;
  const interval = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) clearInterval(interval);
  }, speed);
  return () => clearInterval(interval);
}
