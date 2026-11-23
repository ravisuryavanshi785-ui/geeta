import * as THREE from 'three';
import type { StageMood } from './types';

export interface StageEnvironment {
  groundHeightAt: (x: number, z: number) => number;
  applyMood: (mood: StageMood, delta: number) => void;
  updateParticles: (elapsed: number, characterX: number, characterZ: number) => void;
  dispose: () => void;
}

function createGroundTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#243a2a';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 650; i++) {
      const x = (i * 73) % 256;
      const y = (i * 137) % 256;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y, 6 + (i % 5), 6 + (i % 4));
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _targetBg = new THREE.Color();
const _targetGround = new THREE.Color();
const _targetKey = new THREE.Color();
const _targetOrb = new THREE.Color();

export function createStageEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): StageEnvironment {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  scene.background = new THREE.Color(0x16241f);
  scene.fog = new THREE.FogExp2(0x16241f, 0.036);

  // 3-point balanced studio/outdoor lighting rig (<= 1 shadow caster)
  const hemiLight = new THREE.HemisphereLight(0x8ecae6, 0x1b3324, 0.85);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
  keyLight.position.set(5.5, 9, 6);
  keyLight.castShadow = !isSoftwareGl;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 26;
  const d = 7;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d;
  keyLight.shadow.camera.bottom = -d;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
  rimLight.position.set(-5, 4.5, -5);
  scene.add(rimLight);

  // Undulating extended outdoor ground plane (no floating box walls)
  const groundHeightAt = (x: number, z: number): number =>
    Math.sin(x * 0.28) * Math.cos(z * 0.25) * 0.14;

  const groundTex = track(createGroundTexture(renderer));
  const groundGeo = track(new THREE.PlaneGeometry(64, 64, 48, 48));
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, groundHeightAt(vx, vz));
  }
  groundGeo.computeVertexNormals();

  const groundMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b6e4c,
      map: groundTex,
      roughness: 0.9,
      metalness: 0.02,
    })
  );
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Soft contact shadow directly under character
  const shadowTex = track(createContactShadowTexture());
  const contactGeo = track(new THREE.PlaneGeometry(1.55, 1.55));
  contactGeo.rotateX(-Math.PI / 2);
  const contactMat = track(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  const contactShadow = new THREE.Mesh(contactGeo, contactMat);
  scene.add(contactShadow);

  // Natural perimeter tree grove & boulders (InstancedMesh)
  const treeCount = 24;
  const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.25, 2.2, 8));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.92 }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunks.castShadow = !isSoftwareGl;
  trunks.receiveShadow = true;

  const canopyGeo = track(new THREE.DodecahedronGeometry(1.05, 1));
  const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.85 }));
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  canopies.castShadow = !isSoftwareGl;

  const rockGeo = track(new THREE.DodecahedronGeometry(0.48, 0));
  const rockMat = track(new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.88 }));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 14);
  rocks.receiveShadow = true;

  const paletteColor = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.12;
    const radius = 5.8 + (i % 4) * 2.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 1.5;
    const y = groundHeightAt(x, z);
    const s = 0.85 + (i % 5) * 0.14;

    _tmpPos.set(x, y + 1.0 * s, z);
    _tmpQuat.setFromEuler(new THREE.Euler(0, i * 0.8, 0));
    _tmpScale.set(s, s, s);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    trunks.setMatrixAt(i, _tmpMatrix);

    _tmpPos.set(x, y + 2.35 * s, z);
    _tmpScale.set(s * 1.1, s * 1.2, s * 1.1);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    canopies.setMatrixAt(i, _tmpMatrix);

    paletteColor.setHSL(0.36 + (i % 4) * 0.02, 0.45, 0.25 + (i % 3) * 0.05);
    canopies.setColorAt(i, paletteColor);
  }
  trunks.computeBoundingSphere();
  canopies.computeBoundingSphere();
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  scene.add(trunks, canopies);

  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.35;
    const r = 4.2 + (i % 3) * 2.2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = groundHeightAt(x, z);
    const s = 0.7 + (i % 4) * 0.22;
    _tmpPos.set(x, y + 0.15 * s, z);
    _tmpQuat.setFromEuler(new THREE.Euler(i * 0.3, i * 1.1, 0));
    _tmpScale.set(s * 1.2, s * 0.7, s);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    rocks.setMatrixAt(i, _tmpMatrix);
  }
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // Glowing Moon / Sun disc in sky
  const orbGeo = track(new THREE.SphereGeometry(1.15, 20, 16));
  const orbMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfef3c7,
    })
  );
  const skyOrb = new THREE.Mesh(orbGeo, orbMat);
  skyOrb.position.set(-4.5, 6.8, -14);
  scene.add(skyOrb);

  // Instanced Floating Fireflies / Magic Dust
  const particleCount = 36;
  const particleGeo = track(new THREE.SphereGeometry(0.055, 8, 6));
  const particleMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfde047,
    })
  );
  const particles = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);
  particles.frustumCulled = false;
  scene.add(particles);

  const moodConfig: Record<
    StageMood,
    { bg: number; ground: number; key: number; keyInt: number; hemiInt: number; orbColor: number; orbY: number }
  > = {
    forest_day: {
      bg: 0x162b22,
      ground: 0x3b6e4c,
      key: 0xfff3d1,
      keyInt: 1.9,
      hemiInt: 0.9,
      orbColor: 0xfef08a,
      orbY: 7.2,
    },
    moonlit_night: {
      bg: 0x0b1224,
      ground: 0x1e2e42,
      key: 0x93c5fd,
      keyInt: 1.25,
      hemiInt: 0.55,
      orbColor: 0xe0f2fe,
      orbY: 6.4,
    },
    sunset_meadow: {
      bg: 0x2b1922,
      ground: 0x4c5e38,
      key: 0xfdba74,
      keyInt: 2.1,
      hemiInt: 0.85,
      orbColor: 0xfb923c,
      orbY: 4.8,
    },
    kitchen_studio: {
      bg: 0x241d17,
      ground: 0x6b5c4d,
      key: 0xfff7ed,
      keyInt: 2.0,
      hemiInt: 1.0,
      orbColor: 0xfde68a,
      orbY: 8.2,
    },
    cinema_stage: {
      bg: 0x11161d,
      ground: 0x27303f,
      key: 0xe2e8f0,
      keyInt: 1.9,
      hemiInt: 0.8,
      orbColor: 0x39ff14,
      orbY: 7.6,
    },
  };

  const applyMood = (mood: StageMood, delta: number) => {
    const cfg = moodConfig[mood];
    const alpha = 1 - Math.exp(-3.5 * Math.min(0.1, Math.max(0.001, delta)));
    _targetBg.setHex(cfg.bg);
    _targetGround.setHex(cfg.ground);
    _targetKey.setHex(cfg.key);
    _targetOrb.setHex(cfg.orbColor);

    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(_targetBg, alpha);
    }
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.lerp(_targetBg, alpha);
    }
    groundMat.color.lerp(_targetGround, alpha);
    keyLight.color.lerp(_targetKey, alpha);
    keyLight.intensity = THREE.MathUtils.lerp(keyLight.intensity, cfg.keyInt, alpha);
    hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, cfg.hemiInt, alpha);
    orbMat.color.lerp(_targetOrb, alpha);
    skyOrb.position.y = THREE.MathUtils.lerp(skyOrb.position.y, cfg.orbY, alpha);
  };

  const updateParticles = (elapsed: number, characterX: number, characterZ: number) => {
    contactShadow.position.set(characterX, groundHeightAt(characterX, characterZ) + 0.025, characterZ);

    for (let i = 0; i < particleCount; i++) {
      const baseAngle = (i / particleCount) * Math.PI * 2;
      const radius = 1.6 + (i % 5) * 0.95;
      const px = Math.cos(baseAngle + elapsed * (0.2 + (i % 3) * 0.08)) * radius;
      const pz = Math.sin(baseAngle + elapsed * (0.18 + (i % 4) * 0.06)) * radius;
      const py = 0.65 + (i % 6) * 0.35 + Math.sin(elapsed * 2.2 + i) * 0.25;
      const pulse = 0.65 + 0.45 * Math.sin(elapsed * 3.2 + i * 1.4);

      _tmpPos.set(px, py, pz);
      _tmpQuat.identity();
      _tmpScale.setScalar(pulse);
      _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
      particles.setMatrixAt(i, _tmpMatrix);
    }
    particles.instanceMatrix.needsUpdate = true;
  };

  return {
    groundHeightAt,
    applyMood,
    updateParticles,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
