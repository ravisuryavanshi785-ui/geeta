import * as THREE from 'three';

function applyTextureDefaults(
  canvas: HTMLCanvasElement,
  renderer?: THREE.WebGLRenderer,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (renderer) {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  } else {
    tex.anisotropy = 4;
  }
  tex.needsUpdate = true;
  return tex;
}

export function createFabricTexture(
  baseHex: string,
  weaveHex: string,
  repeat = 4,
  renderer?: THREE.WebGLRenderer
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = weaveHex;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 256; i += 6) {
      ctx.globalAlpha = i % 12 === 0 ? 0.16 : 0.08;
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
    }

    // Subtle micro-grain for tactile sharpness
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < 900; i++) {
      const x = (i * 53) % 256;
      const y = (i * 97) % 256;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return applyTextureDefaults(canvas, renderer, repeat, repeat);
}

export function createFurTexture(
  baseHex: string,
  highlightHex: string,
  renderer?: THREE.WebGLRenderer
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 1200; i++) {
      const x = (i * 67) % 256;
      const y = (i * 113) % 256;
      ctx.strokeStyle = i % 3 === 0 ? highlightHex : 'rgba(0,0,0,0.16)';
      ctx.globalAlpha = i % 3 === 0 ? 0.24 : 0.14;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ((i % 5) - 2), y + 9);
      ctx.stroke();
    }
  }
  return applyTextureDefaults(canvas, renderer, 2, 2);
}

export function createBrushedMetalTexture(
  baseHex: string,
  renderer?: THREE.WebGLRenderer
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    for (let y = 0; y < 256; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, y, 256, 1);
    }
  }
  return applyTextureDefaults(canvas, renderer, 2, 2);
}

export function createEyeIrisTexture(
  irisHex: string,
  renderer?: THREE.WebGLRenderer
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 256);

    const cx = 128;
    const cy = 128;

    // Outer limbal ring
    const irisGrad = ctx.createRadialGradient(cx, cy, 24, cx, cy, 88);
    irisGrad.addColorStop(0, irisHex);
    irisGrad.addColorStop(0.75, irisHex);
    irisGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 88, 0, Math.PI * 2);
    ctx.fill();

    // Radial iris striations for lifelike detail
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    for (let a = 0; a < 36; a++) {
      const ang = (a / 36) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 38, cy + Math.sin(ang) * 38);
      ctx.lineTo(cx + Math.cos(ang) * 80, cy + Math.sin(ang) * 80);
      ctx.stroke();
    }

    // Crisp pupil
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.fill();

    // Primary & secondary specular catchlights
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 22, cy - 24, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx + 22, cy + 20, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  tex.needsUpdate = true;
  return tex;
}

export function createCinemaScreenTexture(renderer?: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const bg = ctx.createLinearGradient(0, 0, 512, 256);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.5, '#1e1b4b');
    bg.addColorStop(1, '#090d16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);

    // Subtle film reel grid & spotlights
    const glow = ctx.createRadialGradient(256, 128, 10, 256, 128, 220);
    glow.addColorStop(0, 'rgba(57, 255, 20, 0.25)');
    glow.addColorStop(0.5, 'rgba(56, 189, 248, 0.14)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    for (let x = 32; x < 512; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.45)';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 488, 232);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  tex.needsUpdate = true;
  return tex;
}
