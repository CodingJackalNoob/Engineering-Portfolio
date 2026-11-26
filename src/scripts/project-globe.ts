type GlobeProject = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  technologies: string[];
  image: string;
  imageAlt: string;
  categories: string[];
  location: { latitude: number; longitude: number } | null;
  href: string;
};

type Point = { x: number; y: number; z: number };

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function initGlobe(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-globe-canvas]');
  const stage = root.querySelector<HTMLElement>('.globe-stage');
  const pinLayer = root.querySelector<HTMLElement>('[data-globe-pin-layer]');
  const projects = JSON.parse(root.dataset.projects ?? '[]') as GlobeProject[];
  const locatedProjects = projects.filter((project) => project.location &&
    Number.isFinite(project.location.latitude) && Math.abs(project.location.latitude) <= 90 &&
    Number.isFinite(project.location.longitude) && Math.abs(project.location.longitude) <= 180);
  if (!canvas || !stage || !pinLayer) return;
  const context = canvas.getContext('2d');
  if (!context) {
    root.classList.add('globe-unavailable');
    return;
  }

  const readout = root.querySelector<HTMLElement>('[data-globe-readout]');
  const postcard = root.querySelector<HTMLElement>('[data-globe-postcard]');
  const cardImage = root.querySelector<HTMLElement>('[data-globe-card-image]');
  const cardCategory = root.querySelector<HTMLElement>('[data-globe-card-category]');
  const cardTitle = root.querySelector<HTMLElement>('[data-globe-card-title]');
  const cardDescription = root.querySelector<HTMLElement>('[data-globe-card-description]');
  const cardTags = root.querySelector<HTMLElement>('[data-globe-card-tags]');
  const cardLink = root.querySelector<HTMLAnchorElement>('[data-globe-card-link]');
  const projectIndex = root.querySelector<HTMLElement>('[data-globe-project-index]');
  const note = root.querySelector<HTMLElement>('[data-globe-note]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const markers = new Map<string, HTMLButtonElement>();
  let width = 0;
  let height = 0;
  let radius = 0;
  let rotation = -0.38;
  let tilt = -0.16;
  let pointerRotation = 0;
  let targetPointerRotation = 0;
  let targetPointerTilt = -0.16;
  let pointerDown = false;
  let lastX = 0;
  let lastY = 0;
  let selectedId = '';
  let hoverId = '';
  let postcardHovered = false;
  let activeFilter = 'all';
  let frame = 0;
  let lastTime = 0;
  let inView = true;

  const projectCartesian = (x: number, y: number, z: number, spin = rotation, lean = tilt): Point => {
    const x1 = x * Math.cos(spin) + z * Math.sin(spin);
    const z1 = -x * Math.sin(spin) + z * Math.cos(spin);
    const y1 = y * Math.cos(lean) - z1 * Math.sin(lean);
    const z2 = y * Math.sin(lean) + z1 * Math.cos(lean);
    return { x: x1, y: y1, z: z2 };
  };

  const projectPoint = (latitude: number, longitude: number, spin = rotation, lean = tilt): Point => {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    return projectCartesian(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), spin, lean);
  };

  const drawCurve = (points: Point[], alpha: number, color: string, lineWidth: number, dash: number[] = []) => {
    context.save();
    context.strokeStyle = color;
    context.globalAlpha = alpha;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.beginPath();
    let drawing = false;
    for (const point of points) {
      if (point.z > 0.015) {
        const x = width / 2 + point.x * radius;
        const y = height / 2 - point.y * radius;
        if (!drawing) context.moveTo(x, y); else context.lineTo(x, y);
        drawing = true;
      } else drawing = false;
    }
    context.stroke();
    context.restore();
  };

  const resize = () => {
    const box = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    radius = Math.min(width, height) * 0.385;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const updatePins = () => {
    for (const project of locatedProjects) {
      const button = markers.get(project.id);
      if (!button || !project.location) continue;
      const point = projectPoint(project.location.latitude, project.location.longitude);
      const visible = point.z > -0.12 && (activeFilter === 'all' || project.categories.includes(activeFilter));
      button.hidden = !visible;
      if (visible) {
        button.style.left = `${width / 2 + point.x * radius}px`;
        button.style.top = `${height / 2 - point.y * radius}px`;
        button.style.zIndex = String(Math.round((point.z + 1) * 10));
        button.classList.toggle('is-backside', point.z <= 0.015);
      }
    }
  };

  const draw = (time: number) => {
    if (!context) return;
    if (!inView || document.hidden) { frame = 0; return; }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    if (!pointerDown) {
      if (!reducedMotion.matches) rotation += dt * 0.075;
      const ease = 1 - Math.exp(-dt * 7);
      const nextPointerRotation = pointerRotation + (targetPointerRotation - pointerRotation) * ease;
      rotation += nextPointerRotation - pointerRotation;
      pointerRotation = nextPointerRotation;
      tilt += (targetPointerTilt - tilt) * ease;
    }
    context.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const glow = context.createRadialGradient(cx - radius * .23, cy - radius * .36, radius * .06, cx, cy, radius * 1.15);
    glow.addColorStop(0, 'rgba(33,49,78,.97)');
    glow.addColorStop(.66, 'rgba(15,31,49,.99)');
    glow.addColorStop(1, 'rgba(5,12,22,.98)');
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.fillStyle = glow;
    context.fill();
    context.clip();

    // Latitude and longitude curves are projected from a sphere, with the far side hidden.
    for (let latitude = -75; latitude <= 75; latitude += 15) {
      const points: Point[] = [];
      for (let longitude = 0; longitude <= 360; longitude += 3) points.push(projectPoint(latitude, longitude));
      drawCurve(points, latitude === 0 ? .25 : .13, latitude === 0 ? '#65bebb' : '#7890a6', .7);
    }
    for (let longitude = 0; longitude < 180; longitude += 15) {
      const points: Point[] = [];
      for (let latitude = -90; latitude <= 90; latitude += 3) points.push(projectPoint(latitude, longitude));
      drawCurve(points, longitude === 0 ? .2 : .12, longitude === 0 ? '#65bebb' : '#7890a6', .7);
    }

    context.restore();
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.strokeStyle = 'rgba(144,170,192,.28)';
    context.lineWidth = 1;
    context.stroke();
    context.restore();

    // Elliptical engineering orbits use the same projected 3D coordinates.
    const orbitTime = reducedMotion.matches ? 0 : time * .000025;
    for (const [index, color] of [[0, '#e27c4c'], [1, '#54bbb4']] as const) {
      const orbit: Point[] = [];
      const angle = index ? -.85 + orbitTime : .5 - orbitTime * .7;
      for (let step = 0; step <= 360; step += 3) {
        const t = step * Math.PI / 180;
        const major = Math.cos(t) * 1.12;
        const minor = Math.sin(t) * .34;
        const x = major * Math.cos(angle) - minor * Math.sin(angle);
        const y = major * Math.sin(angle) + minor * Math.cos(angle);
        const z = Math.sin(t) * .44 * (index ? -1 : 1);
        orbit.push(projectCartesian(x, y, z));
      }
      drawCurve(orbit, .43, color, 1.1);
    }

    // Coordinate sparks remain attached to the rotating sphere.
    const sparks = [[25, 68], [-38, -50], [54, 130], [-16, 176], [8, -125], [-62, 84]];
    for (let i = 0; i < sparks.length; i += 1) {
      const point = projectPoint(sparks[i][0], sparks[i][1]);
      if (point.z <= 0) continue;
      const x = cx + point.x * radius;
      const y = cy - point.y * radius;
      const pulse = reducedMotion.matches ? 1 : .7 + Math.sin(time * .002 + i * 1.7) * .25;
      context.beginPath();
      context.arc(x, y, 1.5 + pulse, 0, TAU);
      context.fillStyle = i % 3 === 0 ? '#e88356' : '#65c4be';
      context.shadowColor = context.fillStyle;
      context.shadowBlur = 9;
      context.fill();
    }
    context.shadowBlur = 0;

    for (const project of locatedProjects) {
      if (!project.location || (activeFilter !== 'all' && !project.categories.includes(activeFilter))) continue;
      const point = projectPoint(project.location.latitude, project.location.longitude);
      if (point.z <= .015) continue;
      const x = cx + point.x * radius;
      const y = cy - point.y * radius;
      const active = project.id === selectedId || project.id === hoverId;
      const pulse = reducedMotion.matches ? 1 : .78 + Math.sin(time * .003) * .15;
      context.beginPath(); context.arc(x, y, active ? 10 : 7 * pulse, 0, TAU);
      context.strokeStyle = 'rgba(244,105,92,.67)'; context.lineWidth = 1; context.stroke();
      context.beginPath(); context.arc(x, y, active ? 4 : 3, 0, TAU); context.fillStyle = '#f47567'; context.fill();
    }
    updatePins();
    frame = requestAnimationFrame(draw);
  };

  const closePostcard = () => { selectedId = ''; if (postcard) postcard.hidden = true; };
  const showProject = (project: GlobeProject, lock = false) => {
    if (!postcard || !cardTitle || !cardCategory || !cardDescription || !cardTags || !cardLink || !cardImage) return;
    hoverId = lock ? '' : project.id;
    if (lock) selectedId = project.id;
    cardCategory.textContent = `${project.category}${project.location ? ` · ${project.location.latitude.toFixed(2)}°, ${project.location.longitude.toFixed(2)}°` : ' · LOCATION NOT SET'}`;
    cardTitle.textContent = project.title;
    cardDescription.textContent = project.description;
    cardTags.replaceChildren(...project.technologies.slice(0, 4).map((technology) => {
      const tag = document.createElement('span'); tag.textContent = technology; return tag;
    }));
    cardLink.href = project.href;
    cardLink.hidden = !project.href;
    cardImage.replaceChildren();
    if (project.image) {
      const image = document.createElement('img'); image.src = project.image; image.alt = project.imageAlt; image.loading = 'lazy';
      cardImage.append(image); cardImage.hidden = false;
    } else cardImage.hidden = true;
    postcard.hidden = false;
  };

  const makeProjectIndex = () => {
    if (!projectIndex) return;
    projectIndex.replaceChildren();
    const visibleProjects = projects.filter((project) => activeFilter === 'all' || project.categories.includes(activeFilter));
    for (const project of visibleProjects) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'globe-project-chip';
      button.textContent = project.title;
      button.setAttribute('aria-label', `${project.title}${project.location ? '' : ', location not configured'}`);
      button.addEventListener('click', () => showProject(project, true));
      projectIndex.append(button);
    }
  };

  for (const project of locatedProjects) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'globe-pin'; button.title = project.title;
    button.setAttribute('aria-label', `Show project: ${project.title}`);
    button.innerHTML = '<span></span>';
    button.addEventListener('pointerenter', () => showProject(project));
    button.addEventListener('pointerleave', () => {
      window.setTimeout(() => {
        if (hoverId === project.id && !selectedId && !postcardHovered) {
          hoverId = '';
          if (postcard) postcard.hidden = true;
        }
      }, 160);
    });
    button.addEventListener('focus', () => showProject(project));
    button.addEventListener('blur', () => {
      if (!selectedId && !postcardHovered) { hoverId = ''; if (postcard) postcard.hidden = true; }
    });
    button.addEventListener('click', () => showProject(project, true));
    markers.set(project.id, button); pinLayer.append(button);
  }

  postcard?.addEventListener('pointerenter', () => { postcardHovered = true; });
  postcard?.addEventListener('pointerleave', () => {
    postcardHovered = false;
    if (!selectedId) { hoverId = ''; postcard.hidden = true; }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-globe-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.globeFilter ?? 'all';
      root.querySelectorAll('[data-globe-filter]').forEach((filter) => filter.setAttribute('aria-pressed', String(filter === button)));
      if (selectedId && !projects.find((project) => project.id === selectedId)?.categories.includes(activeFilter) && activeFilter !== 'all') closePostcard();
      makeProjectIndex(); updatePins();
    });
  });
  root.querySelector('[data-globe-close]')?.addEventListener('click', closePostcard);

  stage.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button, a, article')) return;
    pointerDown = true; lastX = event.clientX; lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
    if (readout) readout.textContent = 'ROTATING FIELD';
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointerDown) {
      const bounds = stage.getBoundingClientRect();
      targetPointerRotation = ((event.clientX - bounds.left) / bounds.width - .5) * .22;
      targetPointerTilt = -.16 + ((event.clientY - bounds.top) / bounds.height - .5) * .18;
      return;
    }
    rotation += (event.clientX - lastX) * .008;
    tilt = clamp(tilt + (event.clientY - lastY) * .006, -1.05, 1.05);
    lastX = event.clientX; lastY = event.clientY;
  });
  const releasePointer = () => {
    pointerDown = false;
    targetPointerRotation = 0;
    targetPointerTilt = -.16;
    if (readout) readout.textContent = 'DRAG TO EXPLORE';
  };
  stage.addEventListener('pointerup', releasePointer);
  stage.addEventListener('pointercancel', releasePointer);
  stage.addEventListener('pointerleave', releasePointer);

  if (note && !locatedProjects.length && projects.length) {
    note.textContent = 'Project previews are ready. Add confirmed coordinates in the project config to place pins on the globe.';
  }
  makeProjectIndex();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) { cancelAnimationFrame(frame); frame = 0; }
    else if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  });
  visibilityObserver.observe(root);
  const handleVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else if (inView && !frame) frame = requestAnimationFrame(draw);
  };
  document.addEventListener('visibilitychange', handleVisibility);
  resize();
  frame = requestAnimationFrame(draw);
  document.addEventListener('astro:before-swap', () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
  }, { once: true });
}

document.querySelectorAll<HTMLElement>('[data-project-globe]:not([data-ready])').forEach((root) => {
  root.dataset.ready = 'true';
  initGlobe(root);
});
