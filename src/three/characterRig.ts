import * as THREE from 'three';
import type { ResolvedCharacter, SceneChoreography } from './types';

export interface CharacterRig {
  archetype: ResolvedCharacter;
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  tailPivot: THREE.Group | null;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  companionPivot: THREE.Group;
  companionLeftWing: THREE.Mesh;
  companionRightWing: THREE.Mesh;
  posX: number;
  posZ: number;
  yaw: number;
  dispose: () => void;
}

function makeCapsuleLimb(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const geom = new THREE.CapsuleGeometry(radius, Math.max(0.05, length - radius * 2), 6, 12);
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCharacterRig(archetype: ResolvedCharacter): CharacterRig {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const palette = {
    fox: {
      primary: 0xf47b25,
      secondary: 0xfff3e0,
      accent: 0xd93025,
      trim: 0x3b2316,
      metal: 0xffc857,
      roughPrimary: 0.72,
    },
    hero: {
      primary: 0x2563eb,
      secondary: 0xf1c29b,
      accent: 0x39ff14,
      trim: 0x1e293b,
      metal: 0xe2e8f0,
      roughPrimary: 0.65,
    },
    robot: {
      primary: 0x475569,
      secondary: 0x94a3b8,
      accent: 0x22d3ee,
      trim: 0x0f172a,
      metal: 0x38bdf8,
      roughPrimary: 0.28,
    },
    chef: {
      primary: 0xf8fafc,
      secondary: 0xf1c29b,
      accent: 0xe11d48,
      trim: 0x1e293b,
      metal: 0xd1d5db,
      roughPrimary: 0.82,
    },
  }[archetype];

  const isRobot = archetype === 'robot';
  const primaryMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.primary,
      roughness: palette.roughPrimary,
      metalness: isRobot ? 0.82 : 0.06,
    })
  );
  const secondaryMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.secondary,
      roughness: isRobot ? 0.35 : 0.68,
      metalness: isRobot ? 0.7 : 0.04,
    })
  );
  const accentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.accent,
      roughness: isRobot ? 0.25 : 0.55,
      metalness: isRobot ? 0.5 : 0.08,
      emissive: isRobot ? palette.accent : 0x000000,
      emissiveIntensity: isRobot ? 0.45 : 0,
    })
  );
  const trimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.trim,
      roughness: 0.42,
      metalness: 0.15,
    })
  );
  const metalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.metal,
      roughness: 0.2,
      metalness: 0.9,
    })
  );
  const eyeWhiteMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.1,
      clearcoat: 0.9,
    })
  );
  const pupilMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: isRobot ? 0x22d3ee : 0x111827,
      roughness: 0.08,
      clearcoat: 1.0,
      emissive: isRobot ? 0x22d3ee : 0x000000,
      emissiveIntensity: isRobot ? 1.2 : 0,
    })
  );

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  // Legs pivoted at hip y = 0.62 so feet sit cleanly on y = 0
  const makeLeg = (side: -1 | 1): THREE.Group => {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.19, 0.62, 0);

    const legMesh = makeCapsuleLimb(0.11, 0.48, trimMat);
    trackGeo(legMesh.geometry);
    legMesh.position.y = -0.26;
    legPivot.add(legMesh);

    const shoeGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.16, 0.34));
    const shoe = new THREE.Mesh(shoeGeo, archetype === 'fox' ? trimMat : accentMat);
    shoe.position.set(0, -0.54, 0.05);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    legPivot.add(shoe);

    return legPivot;
  };

  const leftLegPivot = makeLeg(-1);
  const rightLegPivot = makeLeg(1);
  bodyPivot.add(leftLegPivot, rightLegPivot);

  // Torso group
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.62, 0);
  bodyPivot.add(torsoPivot);

  const torsoGeo = trackGeo(new THREE.CapsuleGeometry(0.32, 0.42, 8, 16));
  const torsoMesh = new THREE.Mesh(torsoGeo, primaryMat);
  torsoMesh.position.y = 0.42;
  torsoMesh.scale.set(1.05, 1.0, 0.88);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torsoPivot.add(torsoMesh);

  // Belly / chest accent plate
  const chestGeo = trackGeo(new THREE.SphereGeometry(0.26, 16, 12));
  const chestMesh = new THREE.Mesh(chestGeo, secondaryMat);
  chestMesh.position.set(0, 0.42, 0.14);
  chestMesh.scale.set(0.88, 1.15, 0.55);
  chestMesh.castShadow = true;
  torsoPivot.add(chestMesh);

  // Belt + metallic buckle
  const beltGeo = trackGeo(new THREE.CylinderGeometry(0.33, 0.34, 0.1, 18));
  const belt = new THREE.Mesh(beltGeo, trimMat);
  belt.position.y = 0.16;
  belt.castShadow = true;
  torsoPivot.add(belt);

  const buckleGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.1, 0.08));
  const buckle = new THREE.Mesh(buckleGeo, metalMat);
  buckle.position.set(0, 0.16, 0.32);
  torsoPivot.add(buckle);

  // Collar / Scarf accent
  const collarGeo = trackGeo(new THREE.TorusGeometry(0.24, 0.075, 10, 20));
  const collar = new THREE.Mesh(collarGeo, accentMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.74;
  collar.castShadow = true;
  torsoPivot.add(collar);

  if (archetype === 'fox' || archetype === 'hero') {
    const scarfTailGeo = trackGeo(new THREE.BoxGeometry(0.13, 0.34, 0.06));
    const scarfTail = new THREE.Mesh(scarfTailGeo, accentMat);
    scarfTail.position.set(0.16, 0.58, 0.24);
    scarfTail.rotation.z = -0.25;
    scarfTail.rotation.x = -0.2;
    scarfTail.castShadow = true;
    torsoPivot.add(scarfTail);
  }

  // Optional fluffy tail for Fox
  let tailPivot: THREE.Group | null = null;
  if (archetype === 'fox') {
    tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.2, -0.26);
    const tailMainGeo = trackGeo(new THREE.CapsuleGeometry(0.13, 0.48, 6, 12));
    const tailMain = new THREE.Mesh(tailMainGeo, primaryMat);
    tailMain.rotation.x = -1.05;
    tailMain.position.set(0, 0.14, -0.24);
    tailMain.castShadow = true;
    tailPivot.add(tailMain);

    const tailTipGeo = trackGeo(new THREE.SphereGeometry(0.14, 12, 10));
    const tailTip = new THREE.Mesh(tailTipGeo, secondaryMat);
    tailTip.position.set(0, 0.28, -0.5);
    tailPivot.add(tailTip);
    torsoPivot.add(tailPivot);
  }

  // Arms pivoted at shoulder y = 0.68
  const makeArm = (side: -1 | 1): THREE.Group => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.41, 0.68, 0);

    const shoulderGeo = trackGeo(new THREE.SphereGeometry(0.12, 12, 10));
    const shoulder = new THREE.Mesh(shoulderGeo, isRobot ? metalMat : primaryMat);
    shoulder.castShadow = true;
    armPivot.add(shoulder);

    const armMesh = makeCapsuleLimb(0.095, 0.46, primaryMat);
    trackGeo(armMesh.geometry);
    armMesh.position.y = -0.22;
    armPivot.add(armMesh);

    const handGeo = trackGeo(new THREE.SphereGeometry(0.105, 12, 10));
    const hand = new THREE.Mesh(handGeo, secondaryMat);
    hand.position.y = -0.46;
    hand.castShadow = true;
    armPivot.add(hand);

    if (archetype === 'chef' && side === 1) {
      const handleGeo = trackGeo(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 8));
      const handle = new THREE.Mesh(handleGeo, metalMat);
      handle.position.set(0, -0.46, 0.18);
      handle.rotation.x = Math.PI / 2.3;
      armPivot.add(handle);
      const spoonGeo = trackGeo(new THREE.SphereGeometry(0.075, 10, 8));
      const spoon = new THREE.Mesh(spoonGeo, metalMat);
      spoon.scale.set(1, 0.45, 1.3);
      spoon.position.set(0, -0.42, 0.38);
      armPivot.add(spoon);
    }

    return armPivot;
  };

  const leftArmPivot = makeArm(-1);
  const rightArmPivot = makeArm(1);
  torsoPivot.add(leftArmPivot, rightArmPivot);

  // Head pivoted at neck y = 0.84
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.84, 0);
  torsoPivot.add(headPivot);

  const headGeo = isRobot
    ? trackGeo(new THREE.BoxGeometry(0.68, 0.56, 0.58))
    : trackGeo(new THREE.SphereGeometry(0.38, 22, 18));
  const headMat = archetype === 'fox' || isRobot ? primaryMat : secondaryMat;
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.position.y = 0.32;
  if (!isRobot) headMesh.scale.set(1.06, 0.96, 1.0);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headPivot.add(headMesh);

  if (archetype === 'fox') {
    const snoutGeo = trackGeo(new THREE.ConeGeometry(0.16, 0.28, 12));
    const snout = new THREE.Mesh(snoutGeo, secondaryMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.24, 0.38);
    headPivot.add(snout);

    const noseGeo = trackGeo(new THREE.SphereGeometry(0.055, 10, 8));
    const nose = new THREE.Mesh(noseGeo, trimMat);
    nose.position.set(0, 0.26, 0.52);
    headPivot.add(nose);

    [-1, 1].forEach((side) => {
      const earGeo = trackGeo(new THREE.ConeGeometry(0.13, 0.32, 10));
      const ear = new THREE.Mesh(earGeo, primaryMat);
      ear.position.set(side * 0.24, 0.68, 0);
      ear.rotation.z = -side * 0.28;
      ear.castShadow = true;
      headPivot.add(ear);
    });
  } else if (archetype === 'chef') {
    const brimGeo = trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.14, 18));
    const brim = new THREE.Mesh(brimGeo, primaryMat);
    brim.position.y = 0.66;
    headPivot.add(brim);

    const puffGeo = trackGeo(new THREE.SphereGeometry(0.34, 16, 12));
    const puff = new THREE.Mesh(puffGeo, primaryMat);
    puff.position.y = 0.88;
    puff.scale.set(1.1, 0.85, 1.1);
    headPivot.add(puff);
  } else if (archetype === 'hero') {
    const hairGeo = trackGeo(new THREE.SphereGeometry(0.4, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62));
    const hair = new THREE.Mesh(hairGeo, trimMat);
    hair.position.set(0, 0.34, -0.02);
    hair.rotation.x = -0.25;
    headPivot.add(hair);
  } else if (archetype === 'robot') {
    const visorGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.22, 0.08));
    const visor = new THREE.Mesh(visorGeo, trimMat);
    visor.position.set(0, 0.34, 0.28);
    headPivot.add(visor);

    const stemGeo = trackGeo(new THREE.CylinderGeometry(0.02, 0.025, 0.24, 8));
    const stem = new THREE.Mesh(stemGeo, metalMat);
    stem.position.set(0, 0.72, 0);
    headPivot.add(stem);

    const bulbGeo = trackGeo(new THREE.SphereGeometry(0.065, 10, 8));
    const bulb = new THREE.Mesh(bulbGeo, accentMat);
    bulb.position.set(0, 0.85, 0);
    headPivot.add(bulb);
  }

  // Expressive Eyes + Eyebrows
  const makeEye = (side: -1 | 1): THREE.Mesh => {
    const eyeGroup = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.075, 12, 10)), eyeWhiteMat);
    eyeGroup.position.set(side * 0.145, 0.35, isRobot ? 0.31 : 0.33);
    eyeGroup.scale.set(1, 1.15, 0.65);

    const pupil = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.048, 10, 8)), pupilMat);
    pupil.position.set(0, 0, 0.048);
    eyeGroup.add(pupil);

    headPivot.add(eyeGroup);
    return eyeGroup;
  };
  const leftEye = makeEye(-1);
  const rightEye = makeEye(1);

  const makeBrow = (side: -1 | 1): THREE.Mesh => {
    const brow = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.032, 0.04)), trimMat);
    brow.position.set(side * 0.145, 0.46, isRobot ? 0.32 : 0.35);
    headPivot.add(brow);
    return brow;
  };
  const leftBrow = makeBrow(-1);
  const rightBrow = makeBrow(1);

  // Cute Glowing Companion (Firefly / Starlight Buddy)
  const companionPivot = new THREE.Group();
  companionPivot.position.set(0.85, 1.45, 0.2);
  const compMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffb703,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    })
  );
  const wingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.65,
      roughness: 0.15,
      side: THREE.DoubleSide,
    })
  );
  const compBody = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.11, 12, 10)), compMat);
  companionPivot.add(compBody);

  const wingGeo = trackGeo(new THREE.PlaneGeometry(0.22, 0.1));
  const companionLeftWing = new THREE.Mesh(wingGeo, wingMat);
  companionLeftWing.position.set(-0.14, 0.06, 0);
  const companionRightWing = new THREE.Mesh(wingGeo, wingMat);
  companionRightWing.position.set(0.14, 0.06, 0);
  companionPivot.add(companionLeftWing, companionRightWing);
  root.add(companionPivot);

  return {
    archetype,
    root,
    bodyPivot,
    torsoPivot,
    headPivot,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    tailPivot,
    leftEye,
    rightEye,
    leftBrow,
    rightBrow,
    companionPivot,
    companionLeftWing,
    companionRightWing,
    posX: -1.2,
    posZ: 0.5,
    yaw: 0.15,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
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

  rig.posX = THREE.MathUtils.damp(rig.posX, targetX, 4.5, dt);
  rig.posZ = THREE.MathUtils.damp(rig.posZ, targetZ, 4.5, dt);

  // Face direction of travel during walk/run, or camera during talk/celebrate/sad
  let targetYaw = choreo.facingAngle;
  if (
    choreo.action === 'talk' ||
    choreo.action === 'sad' ||
    choreo.action === 'celebrate' ||
    choreo.action === 'cook' ||
    choreo.action === 'heroic'
  ) {
    targetYaw = Math.sin(elapsed * 0.7) * 0.18;
  }
  rig.yaw = THREE.MathUtils.damp(rig.yaw, targetYaw, 5.0, dt);

  const groundY = groundHeightAt(rig.posX, rig.posZ);
  rig.root.position.set(rig.posX, groundY, rig.posZ);
  rig.root.rotation.y = rig.yaw;

  // Periodic natural blink
  const blinkCycle = elapsed % 3.6;
  const eyeScaleY = blinkCycle > 3.45 ? 0.12 : 1.15;
  rig.leftEye.scale.y = THREE.MathUtils.damp(rig.leftEye.scale.y, eyeScaleY, 24, dt);
  rig.rightEye.scale.y = THREE.MathUtils.damp(rig.rightEye.scale.y, eyeScaleY, 24, dt);

  let legSwing = 0;
  let armL_X = 0;
  let armR_X = 0;
  let armL_Z = 0.14;
  let armR_Z = -0.14;
  let bodyY = 0;
  let torsoTiltX = 0;
  let headTiltX = 0;
  let headTiltY = 0;
  let browTilt = 0;

  switch (choreo.action) {
    case 'walk':
    case 'run': {
      const speed = choreo.action === 'run' ? 10.5 : 6.2;
      const amp = choreo.action === 'run' ? 0.78 : 0.48;
      legSwing = Math.sin(elapsed * speed) * amp;
      armL_X = -legSwing * 0.85;
      armR_X = legSwing * 0.85;
      bodyY = Math.abs(Math.sin(elapsed * speed)) * (choreo.action === 'run' ? 0.12 : 0.055);
      torsoTiltX = choreo.action === 'run' ? 0.16 : 0.06;
      headTiltY = Math.sin(elapsed * 2.2) * 0.12;
      break;
    }
    case 'jump':
    case 'celebrate': {
      const jumpPhase = Math.abs(Math.sin(elapsed * 4.2));
      bodyY = jumpPhase * 0.48;
      legSwing = Math.sin(elapsed * 4.2) * 0.22;
      armL_Z = 2.4 + Math.sin(elapsed * 8.4) * 0.25;
      armR_Z = -2.4 - Math.sin(elapsed * 8.4) * 0.25;
      armL_X = -0.35;
      armR_X = -0.35;
      headTiltX = -0.12;
      headTiltY = Math.sin(elapsed * 3.0) * 0.2;
      browTilt = 0.14;
      break;
    }
    case 'sad': {
      torsoTiltX = 0.22;
      headTiltX = 0.3 + Math.sin(elapsed * 1.8) * 0.05;
      headTiltY = Math.sin(elapsed * 1.1) * 0.14;
      armL_Z = 0.06;
      armR_Z = -0.06;
      armL_X = 0.15;
      armR_X = 0.15;
      browTilt = -0.28;
      bodyY = Math.sin(elapsed * 2.0) * 0.015;
      break;
    }
    case 'cook': {
      armR_X = -0.9 + Math.sin(elapsed * 7.5) * 0.35;
      armR_Z = -0.25 + Math.cos(elapsed * 7.5) * 0.2;
      armL_X = -0.55;
      torsoTiltX = 0.08;
      headTiltX = 0.1 + Math.sin(elapsed * 3.0) * 0.06;
      bodyY = Math.sin(elapsed * 7.5) * 0.02;
      break;
    }
    case 'heroic': {
      torsoTiltX = -0.06;
      armL_Z = 0.35;
      armR_Z = -0.35;
      armL_X = -0.3 + Math.sin(elapsed * 3.2) * 0.15;
      armR_X = -0.75 + Math.cos(elapsed * 2.8) * 0.2;
      headTiltY = Math.sin(elapsed * 1.8) * 0.16;
      browTilt = 0.18;
      break;
    }
    case 'talk':
    default: {
      armL_X = -0.55 + Math.sin(elapsed * 4.5) * 0.32;
      armR_X = -0.65 + Math.cos(elapsed * 5.2) * 0.36;
      armL_Z = 0.32 + Math.sin(elapsed * 3.1) * 0.14;
      armR_Z = -0.32 - Math.cos(elapsed * 3.4) * 0.14;
      headTiltX = Math.sin(elapsed * 4.8) * 0.1;
      headTiltY = Math.sin(elapsed * 2.1) * 0.16;
      bodyY = Math.sin(elapsed * 3.0) * 0.025;
      break;
    }
  }

  rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, legSwing, 12, dt);
  rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, -legSwing, 12, dt);

  rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, armL_X, 10, dt);
  rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, armR_X, 10, dt);
  rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, armL_Z, 10, dt);
  rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, armR_Z, 10, dt);

  rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, bodyY, 12, dt);
  rig.torsoPivot.rotation.x = THREE.MathUtils.damp(rig.torsoPivot.rotation.x, torsoTiltX, 8, dt);
  rig.headPivot.rotation.x = THREE.MathUtils.damp(rig.headPivot.rotation.x, headTiltX, 9, dt);
  rig.headPivot.rotation.y = THREE.MathUtils.damp(rig.headPivot.rotation.y, headTiltY, 9, dt);

  rig.leftBrow.rotation.z = THREE.MathUtils.damp(rig.leftBrow.rotation.z, browTilt, 10, dt);
  rig.rightBrow.rotation.z = THREE.MathUtils.damp(rig.rightBrow.rotation.z, -browTilt, 10, dt);

  if (rig.tailPivot) {
    rig.tailPivot.rotation.y = Math.sin(elapsed * 6.5) * 0.35;
  }

  // Companion firefly sprite animation
  rig.companionPivot.visible = choreo.showCompanion;
  if (choreo.showCompanion) {
    rig.companionPivot.position.set(
      Math.cos(elapsed * 1.9) * 0.95,
      1.65 + Math.sin(elapsed * 3.1) * 0.22,
      Math.sin(elapsed * 1.9) * 0.65
    );
    rig.companionLeftWing.rotation.y = Math.sin(elapsed * 26) * 0.65;
    rig.companionRightWing.rotation.y = -Math.sin(elapsed * 26) * 0.65;
  }
}
