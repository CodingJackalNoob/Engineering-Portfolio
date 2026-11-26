/**
 * Small Astro-native interaction patterns adapted to this site's CSS tokens.
 * Visual references: React Bits Tilted Card, Kokonut UI Magnet Button, and
 * Watermelon UI's image-first editorial sections. No library source is copied.
 */

const supportsHoverTilt = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function prepareTiltCards() {
  if (!supportsHoverTilt.matches || reducedMotion.matches) return;

  document.querySelectorAll<HTMLElement>('[data-tilt-card]:not([data-tilt-ready])').forEach((card) => {
    card.dataset.tiltReady = 'true';
    card.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const rotateX = (0.5 - y) * 5;
      const rotateY = (x - 0.5) * 5;
      card.style.setProperty('--tilt-x', `${rotateX.toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${rotateY.toFixed(2)}deg`);
      card.style.setProperty('--image-x', `${((x - 0.5) * -4).toFixed(1)}px`);
      card.style.setProperty('--image-y', `${((y - 0.5) * -4).toFixed(1)}px`);
      card.dataset.tiltActive = 'true';
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
      card.style.setProperty('--image-x', '0px');
      card.style.setProperty('--image-y', '0px');
      delete card.dataset.tiltActive;
    });
  });
}

function prepareMagneticButtons() {
  if (!supportsHoverTilt.matches || reducedMotion.matches) return;

  document.querySelectorAll<HTMLElement>('[data-magnetic]:not([data-magnetic-ready])').forEach((button) => {
    button.dataset.magneticReady = 'true';
    button.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = button.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      button.style.setProperty('--magnetic-x', `${(x * 6).toFixed(1)}px`);
      button.style.setProperty('--magnetic-y', `${(y * 6).toFixed(1)}px`);
    });
    button.addEventListener('pointerleave', () => {
      button.style.setProperty('--magnetic-x', '0px');
      button.style.setProperty('--magnetic-y', '0px');
    });
  });
}

let lightboxIndex = 0;
let lightboxTriggers: HTMLElement[] = [];

function showLightboxImage(dialog: HTMLDialogElement, index: number) {
  const image = dialog.querySelector<HTMLImageElement>('[data-lightbox-image]');
  const caption = dialog.querySelector<HTMLElement>('[data-lightbox-caption]');
  const count = dialog.querySelector<HTMLElement>('[data-lightbox-count]');
  const previous = dialog.querySelector<HTMLButtonElement>('[data-lightbox-previous]');
  const next = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]');
  if (!image || !lightboxTriggers.length) return;
  lightboxIndex = (index + lightboxTriggers.length) % lightboxTriggers.length;
  const trigger = lightboxTriggers[lightboxIndex];
  const source = trigger.dataset.imageSrc;
  if (!source) return;
  image.src = source;
  image.alt = trigger.dataset.imageAlt ?? '';
  if (caption) caption.textContent = trigger.dataset.imageCaption ?? '';
  if (count) count.textContent = `${lightboxIndex + 1} / ${lightboxTriggers.length}`;
  if (previous) previous.disabled = lightboxTriggers.length < 2;
  if (next) next.disabled = lightboxTriggers.length < 2;
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const dialog = document.querySelector<HTMLDialogElement>('[data-image-lightbox]');
  if (!dialog) return;
  const trigger = event.target.closest<HTMLElement>('[data-gallery-open]');
  if (trigger) {
    lightboxTriggers = [...document.querySelectorAll<HTMLElement>('[data-gallery-open]')];
    showLightboxImage(dialog, lightboxTriggers.indexOf(trigger));
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (event.target.closest('[data-lightbox-close]') && dialog.open) dialog.close();
  if (event.target.closest('[data-lightbox-previous]')) showLightboxImage(dialog, lightboxIndex - 1);
  if (event.target.closest('[data-lightbox-next]')) showLightboxImage(dialog, lightboxIndex + 1);
});

document.addEventListener('click', (event) => {
  const dialog = document.querySelector<HTMLDialogElement>('[data-image-lightbox]');
  if (dialog && event.target === dialog) dialog.close();
});

document.addEventListener('keydown', (event) => {
  const dialog = document.querySelector<HTMLDialogElement>('[data-image-lightbox]');
  if (!dialog?.open || lightboxTriggers.length < 2) return;
  if (event.key === 'ArrowLeft') showLightboxImage(dialog, lightboxIndex - 1);
  if (event.key === 'ArrowRight') showLightboxImage(dialog, lightboxIndex + 1);
});

function prepareAboutMotion() {
  const marquee = document.querySelector<HTMLElement>('.photo-marquee');
  const track = document.querySelector<HTMLElement>('#photo-track');
  if (!marquee || !track || marquee.dataset.motionReady) return;
  marquee.dataset.motionReady = 'true';
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(([entry]) => {
    track.classList.toggle('is-outside', !entry.isIntersecting);
  });
  observer.observe(marquee);
}

function initializeInteractions() {
  prepareTiltCards();
  prepareMagneticButtons();
  prepareAboutMotion();
}

initializeInteractions();
document.addEventListener('astro:page-load', initializeInteractions);
