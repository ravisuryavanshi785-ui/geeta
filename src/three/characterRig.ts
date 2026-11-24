import * as THREE from 'three';
import {
  createBrushedMetalTexture,
  createEyeIrisTexture,
  createFabricTexture,
  createFurTexture,
} from './proceduralTextures';
import type { ResolvedCharacter, SceneChoreography } from './types';

export interface CharacterRig {
  archetype: ResolvedCharacter;
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightKneePivot: THREE.Group;
  tailPivot: THREE.Group | null;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  mouthMesh: THREE.Mesh;
  companionPivot: THREE.Group;
  companionLeftWing: THREE.Mesh;
  companionRightWing: THREE.Mesh;
  posX: number;
  posZ: number;
  yaw: number;
  dispose: () => void;
}

function makeLatheTorso(
  bottomR: number,
  waistR: number,
  chestR: number,
  shoulderR: number,
  height: number
): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(bottomR, 0.03),
    new THREE.Vector2(waistR, height * 0.28),
    new THREE.Vector2(chestR, height * 0.68),
    new THREE.Vector2(shoulderR, height * 0.94),
    new THREE.Vector2(shoulderR * 0.48, height),
    new THREE.Vector2(0.01, height),
  ];
  return new THREE.LatheGeometry(pts, 28);
}

function makeLapelGeometry(side: -1 | 1): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(side * 0.14, 0.04);
  shape.lineTo(side * 0.19, 0.34);
  shape.lineTo(side * 0.05, 0.38);
  shape.lineTo(0, 0.12);
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 3,
  });
}

function makeSculptedBoot(
  soleMat: THREE.Material,
  upperMat: THREE.Material,
  accentMat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T
): THREE.Group {
  const boot = new THREE.Group();

  // Gripped rubber outsole
  const soleGeo = trackGeo(new THREE.BoxGeometry(0.21, 0.055, 0.34));
  const sole = new THREE.Mesh(soleGeo, soleMat);
  sole.position.set(0, 0.028, 0.05);
  sole.castShadow = true;
  sole.receiveShadow = true;
  boot.add(sole);

  // Midsole trim stripe
  const midGeo = trackGeo(new THREE.BoxGeometry(0.215, 0.022, 0.345));
  const mid = new THREE.Mesh(midGeo, accentMat);
  mid.position.set(0, 0.062, 0.05);
  boot.add(mid);

  // Rounded sculpted toe box
  const toeGeo = trackGeo(new THREE.SphereGeometry(0.102, 18, 14));
  const toe = new THREE.Mesh(toeGeo, upperMat);
  toe.scale.set(0.96, 0.72, 1.38);
  toe.position.set(0, 0.105, 0.085);
  toe.castShadow = true;
  boot.add(toe);

  // Ankle cuff
  const ankleGeo = trackGeo(new THREE.CylinderGeometry(0.095, 0.102, 0.13, 18));
  const ankle = new THREE.Mesh(ankleGeo, upperMat);
  ankle.position.set(0, 0.13, -0.02);
  ankle.castShadow = true;
  boot.add(ankle);

  return boot;
}

export function buildCharacterRig(
  archetype: ResolvedCharacter,
  renderer?: THREE.WebGLRenderer
): CharacterRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    disposables.push(t);
    return t;
  };

  const palettes: Record<
    ResolvedCharacter,
    {
      coatHex: string;
      coatWeave: string;
      secondaryHex: string;
      accent: number;
      trim: number;
      skin: number;
      hair: number;
      irisHex: string;
      metal: number;
      isFur?: boolean;
      isMetal?: boolean;
    }
  > = {
    critic: {
      coatHex: '#1e293b',
      coatWeave: '#334155',
      secondaryHex: '#f1f5f9',
      accent: 0xe11d48,
      trim: 0x0f172a,
      skin: 0xe8b490,
      hair: 0x18181b,
      irisHex: '#3b82f6',
      metal: 0xfbbf24,
    },
    streamer: {
      coatHex: '#18181b',
      coatWeave: '#27272a',
      secondaryHex: '#39ff14',
      accent: 0x39ff14,
      trim: 0x111827,
      skin: 0xebb995,
      hair: 0x1f2937,
      irisHex: '#10b981',
      metal: 0xe2e8f0,
    },
    hero: {
      coatHex: '#1d4ed8',
      coatWeave: '#1e40af',
      secondaryHex: '#334155',
      accent: 0xf59e0b,
      trim: 0x292524,
      skin: 0xe5b18c,
      hair: 0x271911,
      irisHex: '#2563eb',
      metal: 0xf59e0b,
    },
    fox: {
      coatHex: '#ea580c',
      coatWeave: '#fdba74',
      secondaryHex: '#fff7ed',
      accent: 0xdc2626,
      trim: 0x3b2316,
      skin: 0xfdba74,
      hair: 0xc2410c,
      irisHex: '#16a34a',
      metal: 0xfbbf24,
      isFur: true,
    },
    chef: {
      coatHex: '#f8fafc',
      coatWeave: '#cbd5e1',
      secondaryHex: '#1e293b',
      accent: 0xdc2626,
      trim: 0x0f172a,
      skin: 0xe8b490,
      hair: 0x3f2e21,
      irisHex: '#92400e',
      metal: 0xe2e8f0,
    },
    robot: {
      coatHex: '#334155',
      coatWeave: '#64748b',
      secondaryHex: '#94a3b8',
      accent: 0x06b6d4,
      trim: 0x0f172a,
      skin: 0x475569,
      hair: 0x1e293b,
      irisHex: '#06b6d4',
      metal: 0xcbd5e1,
      isMetal: true,
    },
  };

  const pal = palettes[archetype];
  const isRobot = Boolean(pal.isMetal);
  const isFox = Boolean(pal.isFur);

  const primaryTex = trackTex(
    isRobot
      ? createBrushedMetalTexture(pal.coatHex, renderer)
      : isFox
      ? createFurTexture(pal.coatHex, pal.coatWeave, renderer)
      : createFabricTexture(pal.coatHex, pal.coatWeave, 4, renderer)
  );
  const secondaryTex = trackTex(createFabricTexture(pal.secondaryHex, '#94a3b8', 3, renderer));
  const irisTex = trackTex(createEyeIrisTexture(pal.irisHex, renderer));

  const primaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: primaryTex,
      roughness: isRobot ? 0.24 : 0.78,
      metalness: isRobot ? 0.85 : 0.04,
      sheen: isRobot ? 0 : 0.45,
      sheenRoughness: 0.65,
      clearcoat: isRobot ? 0.8 : 0.0,
    })
  );

  const secondaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: secondaryTex,
      roughness: isRobot ? 0.35 : 0.72,
      metalness: isRobot ? 0.65 : 0.05,
      sheen: isRobot ? 0 : 0.3,
    })
  );

  const pantsMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: archetype === 'chef' ? 0x1e293b : archetype === 'fox' ? 0xc2410c : pal.trim,
      roughness: isRobot ? 0.3 : 0.78,
      metalness: isRobot ? 0.75 : 0.05,
      sheen: isRobot ? 0 : 0.25,
    })
  );

  const skinMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: pal.skin,
      roughness: isRobot ? 0.28 : 0.56,
      metalness: isRobot ? 0.75 : 0.02,
      clearcoat: isRobot ? 0.6 : 0.08,
      clearcoatRoughness: 0.55,
    })
  );

  const hairMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: pal.hair,
      roughness: 0.68,
      metalness: 0.08,
    })
  );

  const accentMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: pal.accent,
      roughness: isRobot || archetype === 'streamer' ? 0.22 : 0.5,
      metalness: isRobot ? 0.5 : 0.12,
      emissive: isRobot || archetype === 'streamer' ? pal.accent : 0x000000,
      emissiveIntensity: isRobot ? 0.75 : archetype === 'streamer' ? 0.45 : 0,
      clearcoat: 0.4,
    })
  );

  const leatherMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x1c1917,
      roughness: 0.36,
      metalness: 0.12,
      clearcoat: 0.35,
    })
  );

  const metalMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: pal.metal,
      roughness: 0.18,
      metalness: 0.94,
      clearcoat: 0.6,
    })
  );

  const eyeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: irisTex,
      roughness: 0.06,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      emissive: isRobot ? pal.accent : 0x000000,
      emissiveIntensity: isRobot ? 0.55 : 0,
    })
  );

  const mouthMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: isRobot ? pal.accent : 0x451a1a,
      roughness: 0.35,
      emissive: isRobot ? pal.accent : 0x000000,
      emissiveIntensity: isRobot ? 0.8 : 0,
    })
  );

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  // Sculpted 2-segment articulated Legs (Hip -> Thigh -> Knee -> Shin -> Multi-Part Boot)
  // Hip at y = 0.74, thigh = 0.32, knee at y = -0.32, shin = 0.30, boot height = 0.12 => ground y = 0.0!
  const makeLeg = (side: -1 | 1): { hipPivot: THREE.Group; kneePivot: THREE.Group } => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * 0.175, 0.74, 0);

    const thighGeo = trackGeo(new THREE.CylinderGeometry(0.118, 0.096, 0.34, 18));
    const thigh = new THREE.Mesh(thighGeo, pantsMat);
    thigh.position.y = -0.16;
    thigh.castShadow = true;
    thigh.receiveShadow = true;
    hipPivot.add(thigh);

    const kneeCapGeo = trackGeo(new THREE.SphereGeometry(0.096, 14, 12));
    const kneeCap = new THREE.Mesh(kneeCapGeo, isRobot ? metalMat : pantsMat);
    kneeCap.position.y = -0.32;
    kneeCap.castShadow = true;
    hipPivot.add(kneeCap);

    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -0.32, 0);
    hipPivot.add(kneePivot);

    const shinGeo = trackGeo(new THREE.CylinderGeometry(0.094, 0.078, 0.3, 18));
    const shin = new THREE.Mesh(shinGeo, pantsMat);
    shin.position.y = -0.15;
    shin.castShadow = true;
    shin.receiveShadow = true;
    kneePivot.add(shin);

    const boot = makeSculptedBoot(
      leatherMat,
      archetype === 'fox' ? leatherMat : archetype === 'streamer' ? secondaryMat : leatherMat,
      archetype === 'streamer' ? accentMat : metalMat,
      trackGeo
    );
    boot.position.set(0, -0.42, 0);
    kneePivot.add(boot);

    return { hipPivot, kneePivot };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);
  bodyPivot.add(leftLeg.hipPivot, rightLeg.hipPivot);

  // Sculpted Anatomical Torso (LatheGeometry + Jacket Lapels + Collar + Belt + Pockets)
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.74, 0);
  bodyPivot.add(torsoPivot);

  const torsoGeo = trackGeo(makeLatheTorso(0.28, 0.255, 0.34, 0.36, 0.72));
  const torsoMesh = new THREE.Mesh(torsoGeo, primaryMat);
  torsoMesh.scale.set(1.06, 1.0, 0.82);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torsoPivot.add(torsoMesh);

  // Inner shirt / chest plate
  const chestGeo = trackGeo(new THREE.SphereGeometry(0.22, 20, 16));
  const chestMesh = new THREE.Mesh(chestGeo, secondaryMat);
  chestMesh.position.set(0, 0.45, 0.16);
  chestMesh.scale.set(0.84, 1.15, 0.52);
  chestMesh.castShadow = true;
  torsoPivot.add(chestMesh);

  // Tailored Lapels / Jacket Collar / Tie for Critic, Hero, Streamer, Chef
  if (archetype === 'critic' || archetype === 'hero' || archetype === 'streamer') {
    [-1, 1].forEach((side) => {
      const lapelGeo = trackGeo(makeLapelGeometry(side as -1 | 1));
      const lapel = new THREE.Mesh(lapelGeo, primaryMat);
      lapel.position.set(side * 0.02, 0.34, 0.25);
      lapel.rotation.y = side * -0.18;
      lapel.castShadow = true;
      torsoPivot.add(lapel);
    });
  }

  if (archetype === 'critic') {
    // Sleek tie + pocket square
    const tieGeo = trackGeo(new THREE.ConeGeometry(0.055, 0.34, 4));
    const tie = new THREE.Mesh(tieGeo, accentMat);
    tie.rotation.z = Math.PI;
    tie.rotation.y = Math.PI / 4;
    tie.scale.set(1, 1, 0.35);
    tie.position.set(0, 0.46, 0.28);
    torsoPivot.add(tie);
  } else if (archetype === 'chef') {
    // Double-breasted chef buttons + neckerchief
    for (let row = 0; row < 3; row++) {
      [-1, 1].forEach((side) => {
        const btn = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 12)), metalMat);
        btn.rotation.x = Math.PI / 2;
        btn.position.set(side * 0.09, 0.28 + row * 0.13, 0.285);
        torsoPivot.add(btn);
      });
    }
    const apronGeo = trackGeo(new THREE.CylinderGeometry(0.285, 0.31, 0.36, 20, 1, false, -Math.PI * 0.45, Math.PI * 0.9));
    const apron = new THREE.Mesh(apronGeo, secondaryMat);
    apron.position.set(0, 0.14, 0.02);
    apron.scale.set(1.04, 1, 0.85);
    torsoPivot.add(apron);
  } else if (archetype === 'robot') {
    // Glowing Arc Core on chest
    const coreRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.1, 0.022, 12, 24)), metalMat);
    coreRing.position.set(0, 0.48, 0.28);
    torsoPivot.add(coreRing);

    const coreGlow = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 20)), accentMat);
    coreGlow.rotation.x = Math.PI / 2;
    coreGlow.position.set(0, 0.48, 0.28);
    torsoPivot.add(coreGlow);
  }

  // Sculpted Leather Belt + Beveled Metallic Buckle
  const beltGeo = trackGeo(new THREE.CylinderGeometry(0.275, 0.285, 0.085, 24));
  const belt = new THREE.Mesh(beltGeo, leatherMat);
  belt.scale.set(1.06, 1, 0.84);
  belt.position.y = 0.16;
  belt.castShadow = true;
  torsoPivot.add(belt);

  const buckleGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.085, 0.05));
  const buckle = new THREE.Mesh(buckleGeo, metalMat);
  buckle.position.set(0, 0.16, 0.245);
  torsoPivot.add(buckle);

  // Scarf / Collar wrap
  const collarGeo = trackGeo(new THREE.TorusGeometry(0.19, 0.062, 14, 28));
  const collar = new THREE.Mesh(
    collarGeo,
    archetype === 'fox' || archetype === 'hero' || archetype === 'chef' ? accentMat : primaryMat
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.72;
  collar.castShadow = true;
  torsoPivot.add(collar);

  if (archetype === 'fox' || archetype === 'hero') {
    const scarfCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.12, 0.7, 0.16),
      new THREE.Vector3(0.18, 0.54, 0.24),
      new THREE.Vector3(0.24, 0.36, 0.2),
    ]);
    const scarfDrape = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(scarfCurve, 12, 0.048, 10, false)), accentMat);
    scarfDrape.castShadow = true;
    torsoPivot.add(scarfDrape);
  }

  // Multi-curve fluffy Fox tail
  let tailPivot: THREE.Group | null = null;
  if (archetype === 'fox') {
    tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.16, -0.22);
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.12, -0.24),
      new THREE.Vector3(0, 0.34, -0.44),
      new THREE.Vector3(0, 0.46, -0.52),
    ]);
    const tailBody = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(tailCurve, 16, 0.115, 14, false)), primaryMat);
    tailBody.castShadow = true;
    tailPivot.add(tailBody);

    const tailTip = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.125, 14, 12)), secondaryMat);
    tailTip.position.set(0, 0.47, -0.53);
    tailPivot.add(tailTip);
    torsoPivot.add(tailPivot);
  }

  // Sculpted 2-segment articulated Arms (Shoulder -> Upper Arm -> Elbow -> Forearm -> Palm + Thumb + Category Prop)
  const makeArm = (side: -1 | 1): { shoulderPivot: THREE.Group; elbowPivot: THREE.Group } => {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(side * 0.4, 0.64, 0);

    // Shoulder / Pauldron
    const shoulderGeo = trackGeo(new THREE.SphereGeometry(0.115, 16, 14));
    const shoulder = new THREE.Mesh(shoulderGeo, isRobot || archetype === 'hero' ? metalMat : primaryMat);
    shoulder.scale.set(1.12, 0.95, 1.0);
    shoulder.castShadow = true;
    shoulderPivot.add(shoulder);

    const upperArmGeo = trackGeo(new THREE.CylinderGeometry(0.088, 0.075, 0.28, 16));
    const upperArm = new THREE.Mesh(upperArmGeo, primaryMat);
    upperArm.position.y = -0.14;
    upperArm.castShadow = true;
    shoulderPivot.add(upperArm);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, -0.28, 0);
    shoulderPivot.add(elbowPivot);

    const elbowSphere = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.074, 12, 10)), isRobot ? metalMat : primaryMat);
    elbowPivot.add(elbowSphere);

    const forearmGeo = trackGeo(new THREE.CylinderGeometry(0.074, 0.062, 0.26, 16));
    const forearm = new THREE.Mesh(forearmGeo, archetype === 'hero' ? leatherMat : primaryMat);
    forearm.position.y = -0.13;
    forearm.castShadow = true;
    elbowPivot.add(forearm);

    // Cuff + Sculpted Hand + Thumb
    const cuff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.04, 14)), secondaryMat);
    cuff.position.y = -0.25;
    elbowPivot.add(cuff);

    const palm = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.078, 14, 12)), skinMat);
    palm.scale.set(0.92, 1.12, 0.72);
    palm.position.y = -0.31;
    palm.castShadow = true;
    elbowPivot.add(palm);

    const thumb = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.022, 0.045, 4, 8)), skinMat);
    thumb.position.set(-side * 0.055, -0.29, 0.045);
    thumb.rotation.z = side * 0.5;
    elbowPivot.add(thumb);

    // Signature Handheld Props per Category!
    if (archetype === 'critic' && side === 1) {
      // Studio Condenser Microphone
      const micGrip = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.026, 0.02, 0.24, 14)), leatherMat);
      micGrip.position.set(0, -0.32, 0.09);
      micGrip.rotation.x = Math.PI / 3;
      elbowPivot.add(micGrip);

      const micRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.036, 0.008, 8, 18)), accentMat);
      micRing.position.set(0, -0.26, 0.19);
      micRing.rotation.x = -Math.PI / 6;
      elbowPivot.add(micRing);

      const micHead = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.055, 16, 14)), metalMat);
      micHead.position.set(0, -0.23, 0.22);
      micHead.castShadow = true;
      elbowPivot.add(micHead);
    } else if (archetype === 'chef' && side === 1) {
      // Wooden Ladle / Spatula
      const handle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 10)), hairMat);
      handle.position.set(0, -0.32, 0.16);
      handle.rotation.x = Math.PI / 2.4;
      elbowPivot.add(handle);

      const scoop = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.068, 14, 10)), metalMat);
      scoop.scale.set(1.0, 0.42, 1.35);
      scoop.position.set(0, -0.28, 0.34);
      elbowPivot.add(scoop);
    } else if (archetype === 'chef' && side === -1) {
      // Stainless Steel Frying Pan
      const panHandle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10)), leatherMat);
      panHandle.position.set(0, -0.31, 0.12);
      panHandle.rotation.x = Math.PI / 2;
      elbowPivot.add(panHandle);

      const panBody = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.17, 0.14, 0.06, 22)), metalMat);
      panBody.position.set(0, -0.31, 0.36);
      panBody.castShadow = true;
      elbowPivot.add(panBody);
    } else if (archetype === 'streamer' && side === 1) {
      // Glowing Smartphone
      const phone = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 0.18, 0.018)), leatherMat);
      phone.position.set(0, -0.32, 0.1);
      phone.rotation.x = -Math.PI / 5;
      elbowPivot.add(phone);

      const screen = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.092, 0.155)), accentMat);
      screen.position.set(0, -0.32, 0.112);
      screen.rotation.x = -Math.PI / 5;
      elbowPivot.add(screen);
    } else if (archetype === 'hero' && side === 1) {
      // Glowing Brass Explorer Lantern
      const cage = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 8)), metalMat);
      cage.position.set(0, -0.44, 0.06);
      elbowPivot.add(cage);

      const lanternGlowMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xfef08a,
          emissive: 0xf59e0b,
          emissiveIntensity: 1.9,
        })
      );
      const flame = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.055, 12, 10)), lanternGlowMat);
      flame.position.set(0, -0.44, 0.06);
      elbowPivot.add(flame);
    }

    return { shoulderPivot, elbowPivot };
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  torsoPivot.add(leftArm.shoulderPivot, rightArm.shoulderPivot);

  // Sculpted Head + Neck + Facial Structure + Iris Eyes + Mouth + Category Headgear
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.78, 0);
  torsoPivot.add(headPivot);

  const neck = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 16)), skinMat);
  neck.position.y = 0.05;
  headPivot.add(neck);

  const headGeo = isRobot
    ? trackGeo(new THREE.CylinderGeometry(0.32, 0.28, 0.48, 8))
    : trackGeo(new THREE.SphereGeometry(0.34, 28, 22));
  const headMesh = new THREE.Mesh(headGeo, isFox ? primaryMat : skinMat);
  headMesh.position.y = 0.33;
  if (!isRobot) {
    headMesh.scale.set(1.0, 1.04, 0.96);
  } else {
    headMesh.rotation.y = Math.PI / 8;
  }
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headPivot.add(headMesh);

  // Subtle sculpted nose & cheeks for non-robot humanoid/fox
  if (!isRobot && !isFox) {
    const nose = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.036, 0.09, 10)), skinMat);
    nose.rotation.x = Math.PI / 2.2;
    nose.position.set(0, 0.31, 0.33);
    headPivot.add(nose);

    [-1, 1].forEach((side) => {
      const ear = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.06, 12, 10)), skinMat);
      ear.scale.set(0.48, 1.0, 0.75);
      ear.position.set(side * 0.33, 0.32, -0.02);
      headPivot.add(ear);
    });
  }

  // Category Headgear & Facial Details
  if (archetype === 'fox') {
    const snout = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.145, 0.26, 16)), secondaryMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.25, 0.34);
    headPivot.add(snout);

    const nose = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.052, 12, 10)), leatherMat);
    nose.position.set(0, 0.27, 0.47);
    headPivot.add(nose);

    [-1, 1].forEach((side) => {
      const outerEar = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.125, 0.32, 14)), primaryMat);
      outerEar.position.set(side * 0.22, 0.65, -0.02);
      outerEar.rotation.z = -side * 0.3;
      outerEar.castShadow = true;
      headPivot.add(outerEar);

      const innerEarMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.75 }));
      const innerEar = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.075, 0.22, 10)), innerEarMat);
      innerEar.position.set(side * 0.22, 0.63, 0.03);
      innerEar.rotation.z = -side * 0.3;
      headPivot.add(innerEar);
    });
  } else if (archetype === 'chef') {
    // Sculpted LatheGeometry Chef Toque Hat + Mustache
    const toquePts = [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.29, 0.14),
      new THREE.Vector2(0.35, 0.24),
      new THREE.Vector2(0.32, 0.42),
      new THREE.Vector2(0.18, 0.48),
      new THREE.Vector2(0.01, 0.49),
    ];
    const toque = new THREE.Mesh(trackGeo(new THREE.LatheGeometry(toquePts, 24)), primaryMat);
    toque.position.y = 0.56;
    toque.castShadow = true;
    headPivot.add(toque);

    // Classic curled mustache
    [-1, 1].forEach((side) => {
      const stache = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.028, 0.08, 6, 10)), hairMat);
      stache.rotation.z = side * (Math.PI / 2.2);
      stache.position.set(side * 0.065, 0.24, 0.33);
      headPivot.add(stache);
    });
  } else if (archetype === 'critic') {
    // Styled side-part hair + Sleek Metallic Glasses
    const hairCrown = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.355, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.56)),
      hairMat
    );
    hairCrown.position.set(0, 0.35, -0.02);
    hairCrown.rotation.x = -0.26;
    hairCrown.castShadow = true;
    headPivot.add(hairCrown);

    const hairSwoop = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.09, 0.24, 8, 12)), hairMat);
    hairSwoop.rotation.z = Math.PI / 2.6;
    hairSwoop.position.set(0.05, 0.62, 0.18);
    headPivot.add(hairSwoop);

    // Designer Glasses
    [-1, 1].forEach((side) => {
      const rim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.085, 0.012, 10, 22)), metalMat);
      rim.position.set(side * 0.125, 0.37, 0.32);
      headPivot.add(rim);
    });
    const bridge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.09, 0.014, 0.016)), metalMat);
    bridge.position.set(0, 0.38, 0.325);
    headPivot.add(bridge);
  } else if (archetype === 'streamer') {
    // Hair + Sculpted Over-Ear RGB Studio Headphones
    const hairCrown = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.355, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.58)),
      hairMat
    );
    hairCrown.position.set(0, 0.35, -0.02);
    hairCrown.rotation.x = -0.22;
    headPivot.add(hairCrown);

    const headbandCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.35, 0.34, 0),
      new THREE.Vector3(-0.28, 0.68, 0),
      new THREE.Vector3(0, 0.76, 0),
      new THREE.Vector3(0.28, 0.68, 0),
      new THREE.Vector3(0.35, 0.34, 0),
    ]);
    const band = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(headbandCurve, 22, 0.038, 12, false)), leatherMat);
    band.castShadow = true;
    headPivot.add(band);

    [-1, 1].forEach((side) => {
      const cup = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 20)), leatherMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.35, 0.34, 0);
      cup.castShadow = true;
      headPivot.add(cup);

      const ledRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.082, 0.012, 10, 22)), accentMat);
      ledRing.rotation.y = Math.PI / 2;
      ledRing.position.set(side * 0.395, 0.34, 0);
      headPivot.add(ledRing);
    });
  } else if (archetype === 'hero') {
    const hairCrown = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.355, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.6)),
      hairMat
    );
    hairCrown.position.set(0, 0.35, -0.02);
    hairCrown.rotation.x = -0.25;
    headPivot.add(hairCrown);

    // Adventurer headband
    const headband = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.34, 0.026, 10, 28)), accentMat);
    headband.rotation.x = Math.PI / 2.2;
    headband.position.set(0, 0.48, 0.01);
    headPivot.add(headband);
  } else if (archetype === 'robot') {
    const visorGlass = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.5, 0.18, 0.08)),
      trackMat(
        new THREE.MeshPhysicalMaterial({
          color: 0x090d16,
          roughness: 0.08,
          metalness: 0.2,
          clearcoat: 1.0,
        })
      )
    );
    visorGlass.position.set(0, 0.36, 0.26);
    headPivot.add(visorGlass);

    const antennaStem = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.026, 0.24, 10)), metalMat);
    antennaStem.position.set(0, 0.68, 0);
    headPivot.add(antennaStem);

    const antennaTip = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.06, 14, 12)), accentMat);
    antennaTip.position.set(0, 0.81, 0);
    headPivot.add(antennaTip);
  }

  // Lifelike Expressive Eyes (Iris texture mapped to front face + clearcoat) + Brows + Mouth
  const makeEye = (side: -1 | 1): THREE.Mesh => {
    const eyeGeo = trackGeo(new THREE.SphereGeometry(0.078, 18, 16));
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    // Rotate sphere so UV center (u=0.5, v=0.5) faces +Z camera!
    eye.rotation.y = -Math.PI / 2;
    eye.position.set(side * 0.125, 0.37, isRobot ? 0.29 : 0.295);
    eye.scale.set(0.65, 1.12, 1.0);
    headPivot.add(eye);
    return eye;
  };
  const leftEye = makeEye(-1);
  const rightEye = makeEye(1);

  const makeBrow = (side: -1 | 1): THREE.Mesh => {
    const brow = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.016, 0.095, 4, 8)), hairMat);
    brow.rotation.z = Math.PI / 2;
    brow.position.set(side * 0.125, 0.475, isRobot ? 0.31 : 0.32);
    headPivot.add(brow);
    return brow;
  };
  const leftBrow = makeBrow(-1);
  const rightBrow = makeBrow(1);

  const mouthGeo = trackGeo(new THREE.CapsuleGeometry(0.02, 0.075, 4, 8));
  mouthGeo.rotateZ(Math.PI / 2);
  const mouthMesh = new THREE.Mesh(mouthGeo, mouthMat);
  mouthMesh.position.set(0, 0.19, isRobot ? 0.3 : 0.315);
  headPivot.add(mouthMesh);

  // Companion Glowing Firefly / Star Sprite
  const companionPivot = new THREE.Group();
  companionPivot.position.set(0.85, 1.55, 0.2);
  const compMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffb703,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    })
  );
  const wingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.72,
      roughness: 0.12,
      side: THREE.DoubleSide,
    })
  );
  const compBody = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.1, 14, 12)), compMat);
  companionPivot.add(compBody);

  const wingGeo = trackGeo(new THREE.PlaneGeometry(0.22, 0.1));
  const companionLeftWing = new THREE.Mesh(wingGeo, wingMat);
  companionLeftWing.position.set(-0.13, 0.05, 0);
  const companionRightWing = new THREE.Mesh(wingGeo, wingMat);
  companionRightWing.position.set(0.13, 0.05, 0);
  companionPivot.add(companionLeftWing, companionRightWing);
  root.add(companionPivot);

  return {
    archetype,
    root,
    bodyPivot,
    torsoPivot,
    headPivot,
    leftArmPivot: leftArm.shoulderPivot,
    rightArmPivot: rightArm.shoulderPivot,
    leftElbowPivot: leftArm.elbowPivot,
    rightElbowPivot: rightArm.elbowPivot,
    leftLegPivot: leftLeg.hipPivot,
    rightLegPivot: rightLeg.hipPivot,
    leftKneePivot: leftLeg.kneePivot,
    rightKneePivot: rightLeg.kneePivot,
    tailPivot,
    leftEye,
    rightEye,
    leftBrow,
    rightBrow,
    mouthMesh,
    companionPivot,
    companionLeftWing,
    companionRightWing,
    posX: -1.1,
    posZ: 0.4,
    yaw: 0.12,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function animateCharacterRig(
  rig: CharacterRig,
  choreo: SceneChoreography,
  elapsed: number,
  sceneProgress: number,
  delta: number,
  groundHeightAt: (x: number, z: number) => number
): void {
  const dt = Math.min(0.1, Math.max(0.001, delta));
  const t = THREE.MathUtils.clamp(sceneProgress, 0, 1);

  const targetX = THREE.MathUtils.lerp(choreo.startX, choreo.endX, t);
  const targetZ = THREE.MathUtils.lerp(choreo.startZ, choreo.endZ, t);

  rig.posX = THREE.MathUtils.damp(rig.posX, targetX, 4.8, dt);
  rig.posZ = THREE.MathUtils.damp(rig.posZ, targetZ, 4.8, dt);

  // Face direction of movement when walking/running early in scene, then turn cleanly toward camera
  let targetYaw = Math.sin(elapsed * 0.85) * 0.16;
  if ((choreo.action === 'walk' || choreo.action === 'run') && t < 0.78) {
    targetYaw = choreo.facingAngle;
  } else if (choreo.action === 'point') {
    targetYaw = 0.22;
  } else if (choreo.action === 'roast') {
    targetYaw = -0.18 + Math.sin(elapsed * 1.4) * 0.18;
  } else if (choreo.action === 'celebrate') {
    targetYaw = t > 0.35 && t < 0.65 ? (t - 0.35) * Math.PI * 6.6 : Math.sin(elapsed * 1.1) * 0.16;
  }
  rig.yaw = THREE.MathUtils.damp(rig.yaw, targetYaw, 5.5, dt);

  const groundY = groundHeightAt(rig.posX, rig.posZ);
  rig.root.position.set(rig.posX, groundY, rig.posZ);
  rig.root.rotation.y = rig.yaw;

  // Natural blinking
  const blinkCycle = elapsed % 3.5;
  const eyeScaleY = blinkCycle > 3.36 ? 0.1 : 1.12;
  rig.leftEye.scale.y = THREE.MathUtils.damp(rig.leftEye.scale.y, eyeScaleY, 26, dt);
  rig.rightEye.scale.y = THREE.MathUtils.damp(rig.rightEye.scale.y, eyeScaleY, 26, dt);

  // NOTE on arm Z axes:
  // Left shoulder (x = -0.4): negative Z rotates arm OUTWARD (-X) and UPWARD.
  // Right shoulder (x = +0.4): positive Z rotates arm OUTWARD (+X) and UPWARD.
  let legL_X = 0;
  let legR_X = 0;
  let kneeL_X = 0;
  let kneeR_X = 0;
  let armL_X = 0;
  let armR_X = 0;
  let armL_Z = -0.16;
  let armR_Z = 0.16;
  let elbowL_X = -0.25;
  let elbowR_X = -0.28;
  let bodyY = 0;
  let bodyScaleY = 1.0;
  let bodyScaleXZ = 1.0;
  let torsoTiltX = 0;
  let torsoTwistY = 0;
  let torsoTiltZ = 0;
  let headTiltX = 0;
  let headTiltY = 0;
  let browTilt = 0;
  let mouthScaleX = 1.0;
  let mouthScaleY = 0.7;

  switch (choreo.action) {
    case 'walk':
    case 'run': {
      const isRun = choreo.action === 'run';
      const speed = isRun ? 10.5 : 6.2;
      const amp = isRun ? 0.76 : 0.48;
      const s = Math.sin(elapsed * speed);
      legL_X = s * amp;
      legR_X = -s * amp;
      kneeL_X = Math.max(0, -s) * (isRun ? 1.1 : 0.65);
      kneeR_X = Math.max(0, s) * (isRun ? 1.1 : 0.65);
      armL_X = -s * amp * 0.85;
      armR_X = s * amp * 0.85;
      armL_Z = -0.18;
      armR_Z = 0.18;
      elbowL_X = isRun ? -1.15 : -0.42;
      elbowR_X = isRun ? -1.15 : -0.42;
      bodyY = Math.abs(s) * (isRun ? 0.13 : 0.05);
      torsoTiltX = isRun ? 0.18 : 0.06;
      torsoTwistY = -s * (isRun ? 0.18 : 0.09);
      headTiltY = Math.sin(elapsed * 2.2) * 0.1;
      mouthScaleY = 0.75 + Math.abs(Math.sin(elapsed * 5.0)) * 0.35;
      break;
    }
    case 'jump':
    case 'celebrate': {
      const jumpPhase = Math.abs(Math.sin(elapsed * 4.5));
      bodyY = jumpPhase * 0.48;
      // Subtle squash at bottom, stretch at apex
      bodyScaleY = jumpPhase < 0.15 ? 0.92 : 1.0 + jumpPhase * 0.07;
      bodyScaleXZ = 1 / Math.sqrt(bodyScaleY);
      kneeL_X = jumpPhase < 0.2 ? 0.42 : 0.15;
      kneeR_X = jumpPhase < 0.2 ? 0.42 : 0.15;
      legL_X = Math.sin(elapsed * 4.5) * 0.22;
      legR_X = -Math.sin(elapsed * 4.5) * 0.22;
      armL_Z = -2.35 - Math.sin(elapsed * 8.4) * 0.24;
      armR_Z = 2.35 + Math.sin(elapsed * 8.4) * 0.24;
      armL_X = -0.25;
      armR_X = -0.25;
      elbowL_X = -0.25;
      elbowR_X = -0.25;
      headTiltX = -0.14;
      headTiltY = Math.sin(elapsed * 3.2) * 0.2;
      browTilt = 0.18;
      mouthScaleX = 1.45;
      mouthScaleY = 1.5;
      break;
    }
    case 'dance': {
      const beat = Math.sin(elapsed * 7.2);
      const bounce = Math.abs(Math.sin(elapsed * 7.2));
      bodyY = bounce * 0.12;
      bodyScaleY = 0.95 + bounce * 0.08;
      bodyScaleXZ = 1 / Math.sqrt(bodyScaleY);
      torsoTiltZ = beat * 0.14;
      torsoTwistY = beat * 0.28;
      legL_X = beat * 0.34;
      legR_X = -beat * 0.34;
      kneeL_X = Math.max(0, beat) * 0.55;
      kneeR_X = Math.max(0, -beat) * 0.55;
      armL_Z = -0.85 - bounce * 0.55;
      armR_Z = 0.85 + bounce * 0.55;
      armL_X = -0.65 + beat * 0.35;
      armR_X = -0.65 - beat * 0.35;
      elbowL_X = -1.05;
      elbowR_X = -1.05;
      headTiltY = -beat * 0.2;
      headTiltX = Math.sin(elapsed * 14.4) * 0.08;
      browTilt = 0.15;
      mouthScaleX = 1.4;
      mouthScaleY = 1.25;
      break;
    }
    case 'wave': {
      // Friendly wave right hand high outward while left rests comfortably
      armR_Z = 2.45 + Math.sin(elapsed * 9.5) * 0.32;
      armR_X = -0.35;
      elbowR_X = -0.35 + Math.cos(elapsed * 9.5) * 0.22;
      armL_Z = -0.22;
      armL_X = -0.15 + Math.sin(elapsed * 2.5) * 0.06;
      elbowL_X = -0.45;
      torsoTiltZ = -0.06;
      headTiltY = Math.sin(elapsed * 2.4) * 0.14;
      headTiltX = -0.06;
      bodyY = Math.abs(Math.sin(elapsed * 4.5)) * 0.03;
      browTilt = 0.14;
      mouthScaleX = 1.35;
      mouthScaleY = 0.9 + Math.abs(Math.sin(elapsed * 9.0)) * 0.55;
      break;
    }
    case 'point': {
      // Confident step-in + emphatic pointing arm forward
      torsoTwistY = -0.25;
      torsoTiltX = 0.08;
      armR_X = -1.38 + Math.sin(elapsed * 6.0) * 0.12;
      armR_Z = 0.14;
      elbowR_X = -0.12;
      armL_Z = -0.32;
      armL_X = -0.28;
      elbowL_X = -0.95;
      legL_X = 0.16;
      legR_X = -0.16;
      kneeR_X = 0.18;
      headTiltY = 0.2;
      browTilt = 0.15;
      mouthScaleX = 1.2;
      mouthScaleY = 0.65 + Math.abs(Math.sin(elapsed * 10.5)) * 0.75;
      break;
    }
    case 'sad': {
      torsoTiltX = 0.24;
      headTiltX = 0.34 + Math.sin(elapsed * 1.8) * 0.05;
      headTiltY = Math.sin(elapsed * 1.1) * 0.14;
      armL_Z = -0.12;
      armR_Z = 0.12;
      armL_X = 0.15;
      armR_X = 0.15;
      elbowL_X = -0.35;
      elbowR_X = -0.35;
      browTilt = -0.32;
      mouthScaleX = 0.85;
      mouthScaleY = 0.42;
      bodyY = Math.sin(elapsed * 2.0) * 0.015;
      break;
    }
    case 'cook': {
      // Pan-toss + energetic wooden-spoon stir
      const stir = Math.sin(elapsed * 7.8);
      armR_X = -0.78 + stir * 0.28;
      armR_Z = 0.22 + Math.cos(elapsed * 7.8) * 0.16;
      elbowR_X = -0.85;
      armL_X = -0.68 + Math.sin(elapsed * 3.9) * 0.22;
      armL_Z = -0.22;
      elbowL_X = -0.95 + Math.max(0, Math.sin(elapsed * 3.9)) * 0.25;
      torsoTiltX = 0.09;
      torsoTwistY = stir * 0.1;
      headTiltX = 0.12 + Math.sin(elapsed * 3.0) * 0.06;
      bodyY = Math.abs(stir) * 0.025;
      mouthScaleX = 1.18;
      mouthScaleY = 0.7 + Math.abs(Math.sin(elapsed * 8.0)) * 0.55;
      break;
    }
    case 'roast': {
      torsoTiltZ = Math.sin(elapsed * 4.5) * 0.1;
      torsoTwistY = Math.sin(elapsed * 3.2) * 0.18;
      torsoTiltX = -0.06;
      armR_X = -1.1 + Math.sin(elapsed * 6.5) * 0.26;
      armR_Z = 0.28;
      elbowR_X = -0.45;
      armL_X = -0.42;
      armL_Z = -0.32;
      elbowL_X = -1.15;
      headTiltY = Math.sin(elapsed * 3.5) * 0.22;
      browTilt = -0.22;
      mouthScaleX = 1.38;
      mouthScaleY = 0.8 + Math.abs(Math.sin(elapsed * 11)) * 0.9;
      bodyY = Math.abs(Math.sin(elapsed * 4.5)) * 0.04;
      break;
    }
    case 'shock': {
      const hop = Math.abs(Math.sin(elapsed * 5.0));
      torsoTiltX = -0.14;
      bodyY = hop * 0.08;
      bodyScaleY = 1.0 + hop * 0.05;
      bodyScaleXZ = 1 / Math.sqrt(bodyScaleY);
      armL_X = -0.88;
      armR_X = -0.88;
      armL_Z = -0.58;
      armR_Z = 0.58;
      elbowL_X = -1.25;
      elbowR_X = -1.25;
      headTiltX = -0.15;
      browTilt = 0.28;
      mouthScaleX = 1.15;
      mouthScaleY = 1.95;
      break;
    }
    case 'talk':
    default: {
      armL_X = -0.48 + Math.sin(elapsed * 4.5) * 0.28;
      armR_X = -0.62 + Math.cos(elapsed * 5.2) * 0.32;
      armL_Z = -0.32 - Math.sin(elapsed * 3.1) * 0.12;
      armR_Z = 0.32 + Math.cos(elapsed * 3.4) * 0.12;
      elbowL_X = -0.65 + Math.sin(elapsed * 4.0) * 0.25;
      elbowR_X = -0.85 + Math.cos(elapsed * 4.6) * 0.25;
      torsoTwistY = Math.sin(elapsed * 2.2) * 0.1;
      headTiltX = Math.sin(elapsed * 4.8) * 0.09;
      headTiltY = Math.sin(elapsed * 2.1) * 0.16;
      bodyY = Math.sin(elapsed * 3.0) * 0.025;
      mouthScaleX = 1.15;
      mouthScaleY = 0.55 + Math.abs(Math.sin(elapsed * 10.5)) * 0.85;
      break;
    }
  }

  rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, legL_X, 12, dt);
  rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, legR_X, 12, dt);
  rig.leftKneePivot.rotation.x = THREE.MathUtils.damp(rig.leftKneePivot.rotation.x, kneeL_X, 12, dt);
  rig.rightKneePivot.rotation.x = THREE.MathUtils.damp(rig.rightKneePivot.rotation.x, kneeR_X, 12, dt);

  rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, armL_X, 11, dt);
  rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, armR_X, 11, dt);
  rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, armL_Z, 11, dt);
  rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, armR_Z, 11, dt);
  rig.leftElbowPivot.rotation.x = THREE.MathUtils.damp(rig.leftElbowPivot.rotation.x, elbowL_X, 12, dt);
  rig.rightElbowPivot.rotation.x = THREE.MathUtils.damp(rig.rightElbowPivot.rotation.x, elbowR_X, 12, dt);

  rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, bodyY, 12, dt);
  rig.bodyPivot.scale.y = THREE.MathUtils.damp(rig.bodyPivot.scale.y, bodyScaleY, 14, dt);
  rig.bodyPivot.scale.x = THREE.MathUtils.damp(rig.bodyPivot.scale.x, bodyScaleXZ, 14, dt);
  rig.bodyPivot.scale.z = THREE.MathUtils.damp(rig.bodyPivot.scale.z, bodyScaleXZ, 14, dt);

  rig.torsoPivot.rotation.x = THREE.MathUtils.damp(rig.torsoPivot.rotation.x, torsoTiltX, 9, dt);
  rig.torsoPivot.rotation.y = THREE.MathUtils.damp(rig.torsoPivot.rotation.y, torsoTwistY, 9, dt);
  rig.torsoPivot.rotation.z = THREE.MathUtils.damp(rig.torsoPivot.rotation.z, torsoTiltZ, 9, dt);
  rig.headPivot.rotation.x = THREE.MathUtils.damp(rig.headPivot.rotation.x, headTiltX, 10, dt);
  rig.headPivot.rotation.y = THREE.MathUtils.damp(rig.headPivot.rotation.y, headTiltY, 10, dt);

  rig.leftBrow.rotation.z = THREE.MathUtils.damp(rig.leftBrow.rotation.z, Math.PI / 2 + browTilt, 12, dt);
  rig.rightBrow.rotation.z = THREE.MathUtils.damp(rig.rightBrow.rotation.z, Math.PI / 2 - browTilt, 12, dt);

  rig.mouthMesh.scale.x = THREE.MathUtils.damp(rig.mouthMesh.scale.x, mouthScaleX, 18, dt);
  rig.mouthMesh.scale.y = THREE.MathUtils.damp(rig.mouthMesh.scale.y, mouthScaleY, 18, dt);

  if (rig.tailPivot) {
    rig.tailPivot.rotation.y = Math.sin(elapsed * 6.5) * 0.38;
  }

  rig.companionPivot.visible = choreo.showCompanion;
  if (choreo.showCompanion) {
    rig.companionPivot.position.set(
      Math.cos(elapsed * 1.9) * 0.92,
      1.78 + Math.sin(elapsed * 3.1) * 0.22,
      Math.sin(elapsed * 1.9) * 0.62
    );
    rig.companionLeftWing.rotation.y = Math.sin(elapsed * 26) * 0.65;
    rig.companionRightWing.rotation.y = -Math.sin(elapsed * 26) * 0.65;
  }
}
