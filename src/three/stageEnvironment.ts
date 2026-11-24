import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createCinemaScreenTexture } from './proceduralTextures';
import type { StageMood } from './types';

export interface StageEnvironment {
  groundHeightAt: (x: number, z: number) => number;
  applyMood: (mood: StageMood, delta: number) => void;
  updateParticles: (elapsed: number, characterX: number, characterZ: number) => void;
  dispose: () => void;
}

function createGroundTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#2c4433';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1800; i++) {
      const x = (i * 73) % 512;
      const y = (i * 137) % 512;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y, 4 + (i % 5), 4 + (i % 4));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 512; g += 64) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(512, g);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
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
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    grad.addColorStop(0.58, 'rgba(0, 0, 0, 0.25)');
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
const _targetRim = new THREE.Color();
const _targetOrb = new THREE.Color();
const _targetParticle = new THREE.Color();

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

  scene.background = new THREE.Color(0x11161d);
  scene.fog = new THREE.FogExp2(0x11161d, 0.032);

  // 3-Point Studio Lighting Rig + Softbox Area Highlight on GPU
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.15);
  keyLight.position.set(4.8, 8.5, 5.5);
  keyLight.castShadow = !isSoftwareGl;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 24;
  const d = 5.5;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d;
  keyLight.shadow.camera.bottom = -d;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.018;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.05);
  rimLight.position.set(-4.5, 4.2, -4.5);
  scene.add(rimLight);

  if (!isSoftwareGl) {
    RectAreaLightUniformsLib.init();
    const softbox = new THREE.RectAreaLight(0xffffff, 2.2, 4.0, 2.2);
    softbox.position.set(-3.2, 3.6, 3.8);
    softbox.lookAt(0, 1.1, 0);
    scene.add(softbox);
  }

  let currentMood: StageMood = 'cinema_stage';
  const isOutdoorMood = (m: StageMood) =>
    m === 'forest_day' || m === 'moonlit_night' || m === 'sunset_meadow';

  const groundHeightAt = (x: number, z: number): number =>
    isOutdoorMood(currentMood) ? Math.sin(x * 0.28) * Math.cos(z * 0.25) * 0.13 : 0;

  // Extended Stage Ground Plane (flat for indoor studio sets, subtle terrain undulation outdoors)
  const groundTex = track(createGroundTexture(renderer));
  const groundGeo = track(new THREE.PlaneGeometry(68, 68, 48, 48));
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.attributes.position;
  const baseHeights = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    baseHeights[i] = Math.sin(vx * 0.28) * Math.cos(vz * 0.25) * 0.13;
  }

  const groundMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x26303d,
      map: groundTex,
      roughness: 0.72,
      metalness: 0.12,
    })
  );
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Soft contact shadow directly under character
  const shadowTex = track(createContactShadowTexture());
  const contactGeo = track(new THREE.PlaneGeometry(1.5, 1.5));
  contactGeo.rotateX(-Math.PI / 2);
  const contactMat = track(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
    })
  );
  const contactShadow = new THREE.Mesh(contactGeo, contactMat);
  scene.add(contactShadow);

  // -------------------------------------------------------
  // SET 1: OUTDOOR STORY / KIDS STORY GROUP (Trees, Rocks, Sky Orb)
  // -------------------------------------------------------
  const outdoorGroup = new THREE.Group();
  scene.add(outdoorGroup);

  const treeCount = 24;
  const trunkGeo = track(new THREE.CylinderGeometry(0.15, 0.25, 2.2, 10));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.9 }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunks.castShadow = !isSoftwareGl;
  trunks.receiveShadow = true;

  const canopyGeo = track(new THREE.ConeGeometry(1.15, 2.1, 10));
  const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.82 }));
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  canopies.castShadow = !isSoftwareGl;

  const rockGeo = track(new THREE.DodecahedronGeometry(0.46, 0));
  const rockMat = track(new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.85 }));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 14);
  rocks.receiveShadow = true;

  const paletteColor = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.12;
    const radius = 5.8 + (i % 4) * 2.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 1.5;
    const y = baseHeights[i % baseHeights.length] * 0.5;
    const s = 0.85 + (i % 5) * 0.15;

    _tmpPos.set(x, y + 1.0 * s, z);
    _tmpQuat.setFromEuler(new THREE.Euler(0, i * 0.8, 0));
    _tmpScale.set(s, s, s);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    trunks.setMatrixAt(i, _tmpMatrix);

    _tmpPos.set(x, y + 2.55 * s, z);
    _tmpScale.set(s * 1.15, s * 1.25, s * 1.15);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    canopies.setMatrixAt(i, _tmpMatrix);

    paletteColor.setHSL(0.36 + (i % 4) * 0.02, 0.45, 0.24 + (i % 3) * 0.05);
    canopies.setColorAt(i, paletteColor);
  }
  trunks.computeBoundingSphere();
  canopies.computeBoundingSphere();
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  outdoorGroup.add(trunks, canopies);

  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.35;
    const r = 4.2 + (i % 3) * 2.2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const s = 0.7 + (i % 4) * 0.22;
    _tmpPos.set(x, 0.16 * s, z);
    _tmpQuat.setFromEuler(new THREE.Euler(i * 0.3, i * 1.1, 0));
    _tmpScale.set(s * 1.2, s * 0.7, s);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    rocks.setMatrixAt(i, _tmpMatrix);
  }
  rocks.computeBoundingSphere();
  outdoorGroup.add(rocks);

  const orbGeo = track(new THREE.SphereGeometry(1.2, 24, 18));
  const orbMat = track(new THREE.MeshBasicMaterial({ color: 0xfef3c7 }));
  const skyOrb = new THREE.Mesh(orbGeo, orbMat);
  skyOrb.position.set(-4.5, 6.6, -14);
  outdoorGroup.add(skyOrb);

  // -------------------------------------------------------
  // SET 2: CINEMA / REVIEW / ROAST STAGE GROUP
  // -------------------------------------------------------
  const cinemaGroup = new THREE.Group();
  scene.add(cinemaGroup);

  const stageMat = track(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.25, metalness: 0.6 }));
  const stageNeonMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x39ff14,
      emissive: 0x39ff14,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    })
  );
  const podiumDisc = new THREE.Mesh(trackGeo(), stageMat);
  function trackGeo(): THREE.CylinderGeometry {
    return track(new THREE.CylinderGeometry(2.35, 2.55, 0.08, 40));
  }
  podiumDisc.position.set(0, 0.04, 0.2);
  podiumDisc.receiveShadow = true;
  cinemaGroup.add(podiumDisc);

  const podiumRing = new THREE.Mesh(track(new THREE.TorusGeometry(2.45, 0.032, 12, 48)), stageNeonMat);
  podiumRing.rotation.x = Math.PI / 2;
  podiumRing.position.set(0, 0.08, 0.2);
  cinemaGroup.add(podiumRing);

  // Giant Curved Cinema Backdrop Screen
  const screenTex = track(createCinemaScreenTexture(renderer));
  const screenBack = new THREE.Mesh(track(new THREE.BoxGeometry(6.8, 3.6, 0.16)), stageMat);
  screenBack.position.set(0, 2.35, -3.2);
  screenBack.castShadow = true;
  cinemaGroup.add(screenBack);

  const screenFace = new THREE.Mesh(
    track(new THREE.PlaneGeometry(6.4, 3.2)),
    track(
      new THREE.MeshBasicMaterial({
        map: screenTex,
      })
    )
  );
  screenFace.position.set(0, 2.35, -3.11);
  cinemaGroup.add(screenFace);

  // Twin Studio Truss Pillars
  [-3.8, 3.8].forEach((px) => {
    const pillar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.11, 0.14, 4.4, 12)), stageMat);
    pillar.position.set(px, 2.2, -2.4);
    pillar.castShadow = true;
    cinemaGroup.add(pillar);

    const lamp = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.18, 0.24, 0.35, 14)),
      track(
        new THREE.MeshStandardMaterial({
          color: 0xfef08a,
          emissive: 0xf59e0b,
          emissiveIntensity: 1.4,
        })
      )
    );
    lamp.position.set(px * 0.92, 4.1, -2.2);
    lamp.rotation.z = px > 0 ? 0.55 : -0.55;
    lamp.rotation.x = 0.45;
    cinemaGroup.add(lamp);
  });

  // -------------------------------------------------------
  // SET 3: STREAMER / REACTION STUDIO GROUP
  // -------------------------------------------------------
  const streamerGroup = new THREE.Group();
  scene.add(streamerGroup);

  const ringLight = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.75, 0.055, 16, 48)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x39ff14,
        emissive: 0x39ff14,
        emissiveIntensity: 1.6,
        roughness: 0.15,
      })
    )
  );
  ringLight.position.set(0, 1.85, -2.35);
  streamerGroup.add(ringLight);

  const cyanRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(2.15, 0.04, 14, 48)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x22d3ee,
        emissiveIntensity: 1.4,
      })
    )
  );
  cyanRing.position.set(0, 1.85, -2.6);
  streamerGroup.add(cyanRing);

  // Acoustic Side Panels
  [-2.6, 2.6].forEach((x) => {
    const panel = new THREE.Mesh(track(new THREE.BoxGeometry(1.3, 3.2, 0.14)), stageMat);
    panel.position.set(x, 1.65, -2.2);
    panel.rotation.y = x > 0 ? -0.35 : 0.35;
    panel.castShadow = true;
    streamerGroup.add(panel);
  });

  // -------------------------------------------------------
  // SET 4: KITCHEN STUDIO GROUP (Chef Island + Copper Pot)
  // -------------------------------------------------------
  const kitchenGroup = new THREE.Group();
  scene.add(kitchenGroup);

  const woodCounterMat = track(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.65 }));
  const marbleTopMat = track(
    new THREE.MeshPhysicalMaterial({ color: 0xf1f5f9, roughness: 0.18, clearcoat: 0.7 })
  );
  const copperMat = track(
    new THREE.MeshPhysicalMaterial({ color: 0xd97706, roughness: 0.22, metalness: 0.88, clearcoat: 0.5 })
  );

  const islandBase = new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 0.92, 1.1)), woodCounterMat);
  islandBase.position.set(-1.65, 0.46, -1.35);
  islandBase.castShadow = true;
  islandBase.receiveShadow = true;
  kitchenGroup.add(islandBase);

  const marbleTop = new THREE.Mesh(track(new THREE.BoxGeometry(2.55, 0.09, 1.22)), marbleTopMat);
  marbleTop.position.set(-1.65, 0.96, -1.35);
  marbleTop.castShadow = true;
  marbleTop.receiveShadow = true;
  kitchenGroup.add(marbleTop);

  const copperPot = new THREE.Mesh(track(new THREE.CylinderGeometry(0.24, 0.22, 0.26, 22)), copperMat);
  copperPot.position.set(-1.35, 1.13, -1.28);
  copperPot.castShadow = true;
  kitchenGroup.add(copperPot);

  const cuttingBoard = new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.04, 0.38)), woodCounterMat);
  cuttingBoard.position.set(-2.1, 1.02, -1.28);
  kitchenGroup.add(cuttingBoard);

  // Floating Atmospheric Particles
  const particleCount = 36;
  const particleGeo = track(new THREE.SphereGeometry(0.05, 8, 6));
  const particleMat = track(new THREE.MeshBasicMaterial({ color: 0xfde047 }));
  const particles = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);
  particles.frustumCulled = false;
  scene.add(particles);

  const moodConfig: Record<
    StageMood,
    {
      bg: number;
      ground: number;
      key: number;
      rim: number;
      keyInt: number;
      hemiInt: number;
      orbColor: number;
      orbY: number;
      particleColor: number;
    }
  > = {
    forest_day: {
      bg: 0x162b22,
      ground: 0x3b6e4c,
      key: 0xfff3d1,
      rim: 0x60a5fa,
      keyInt: 2.1,
      hemiInt: 0.92,
      orbColor: 0xfef08a,
      orbY: 7.0,
      particleColor: 0xfde047,
    },
    moonlit_night: {
      bg: 0x0b1224,
      ground: 0x1e2e42,
      key: 0x93c5fd,
      rim: 0x38bdf8,
      keyInt: 1.45,
      hemiInt: 0.6,
      orbColor: 0xe0f2fe,
      orbY: 6.4,
      particleColor: 0xfde047,
    },
    sunset_meadow: {
      bg: 0x2b1922,
      ground: 0x4c5e38,
      key: 0xfdba74,
      rim: 0xfb7185,
      keyInt: 2.2,
      hemiInt: 0.88,
      orbColor: 0xfb923c,
      orbY: 4.8,
      particleColor: 0xfed7aa,
    },
    kitchen_studio: {
      bg: 0x211914,
      ground: 0x574c43,
      key: 0xfff7ed,
      rim: 0xfbbf24,
      keyInt: 2.15,
      hemiInt: 1.0,
      orbColor: 0xfde68a,
      orbY: 8.2,
      particleColor: 0xfef3c7,
    },
    cinema_stage: {
      bg: 0x0f141c,
      ground: 0x1f2836,
      key: 0xf8fafc,
      rim: 0x39ff14,
      keyInt: 2.1,
      hemiInt: 0.82,
      orbColor: 0x39ff14,
      orbY: 7.6,
      particleColor: 0x39ff14,
    },
    streamer_studio: {
      bg: 0x0d111a,
      ground: 0x192130,
      key: 0xf1f5f9,
      rim: 0x22d3ee,
      keyInt: 2.05,
      hemiInt: 0.85,
      orbColor: 0x22d3ee,
      orbY: 7.6,
      particleColor: 0x22d3ee,
    },
  };

  let groundFlatState = false;
  const syncGroundGeometry = (outdoor: boolean) => {
    if (groundFlatState === !outdoor) return;
    groundFlatState = !outdoor;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, outdoor ? baseHeights[i] : 0);
    }
    posAttr.needsUpdate = true;
    groundGeo.computeVertexNormals();
  };

  const applyMood = (mood: StageMood, delta: number) => {
    currentMood = mood;
    const outdoor = isOutdoorMood(mood);
    outdoorGroup.visible = outdoor;
    cinemaGroup.visible = mood === 'cinema_stage';
    streamerGroup.visible = mood === 'streamer_studio';
    kitchenGroup.visible = mood === 'kitchen_studio';
    syncGroundGeometry(outdoor);

    const cfg = moodConfig[mood];
    const alpha = 1 - Math.exp(-3.8 * Math.min(0.1, Math.max(0.001, delta)));
    _targetBg.setHex(cfg.bg);
    _targetGround.setHex(cfg.ground);
    _targetKey.setHex(cfg.key);
    _targetRim.setHex(cfg.rim);
    _targetOrb.setHex(cfg.orbColor);
    _targetParticle.setHex(cfg.particleColor);

    if (scene.background instanceof THREE.Color) scene.background.lerp(_targetBg, alpha);
    if (scene.fog instanceof THREE.FogExp2) scene.fog.color.lerp(_targetBg, alpha);
    groundMat.color.lerp(_targetGround, alpha);
    keyLight.color.lerp(_targetKey, alpha);
    rimLight.color.lerp(_targetRim, alpha);
    keyLight.intensity = THREE.MathUtils.lerp(keyLight.intensity, cfg.keyInt, alpha);
    hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, cfg.hemiInt, alpha);
    orbMat.color.lerp(_targetOrb, alpha);
    particleMat.color.lerp(_targetParticle, alpha);
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
      const pulse = 0.6 + 0.45 * Math.sin(elapsed * 3.2 + i * 1.4);

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
