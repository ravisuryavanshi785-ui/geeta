import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ContentMode, VideoSlab } from '../types/video';
import { animateCharacterRig, buildCharacterRig, type CharacterRig } from './characterRig';
import { createStageEnvironment, type StageEnvironment } from './stageEnvironment';
import {
  analyzeSceneChoreography,
  DEFAULT_DEMO_SLABS,
  resolveCharacterArchetype,
  type CharacterArchetype,
  type SceneChoreography,
} from './types';

interface ThreeCharacterStudioProps {
  slabs: VideoSlab[] | null;
  contentMode: ContentMode;
  topic: string;
  characterBible?: string;
  isShorts: boolean;
  onAttachCapturedClips?: (clips: Array<{ sceneIndex: number; file: File }>) => void;
}

const CHARACTER_OPTIONS: Array<{ value: CharacterArchetype; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'fox', label: 'Fox' },
  { value: 'hero', label: 'Hero' },
  { value: 'robot', label: 'Robot' },
  { value: 'chef', label: 'Chef' },
];

const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3(0, 1.0, 0);

export const ThreeCharacterStudio: React.FC<ThreeCharacterStudioProps> = ({
  slabs,
  contentMode,
  topic,
  characterBible = '',
  isShorts,
  onAttachCapturedClips,
}) => {
  const activeSlabs = useMemo(
    () => (slabs && slabs.length > 0 ? slabs : DEFAULT_DEMO_SLABS),
    [slabs]
  );

  const choreographies = useMemo(
    () =>
      activeSlabs.map((slab, idx) =>
        analyzeSceneChoreography(slab, idx, activeSlabs.length, contentMode, topic)
      ),
    [activeSlabs, contentMode, topic]
  );

  const [selectedArchetype, setSelectedArchetype] = useState<CharacterArchetype>('auto');
  const resolvedArchetype = useMemo(
    () => resolveCharacterArchetype(selectedArchetype, contentMode, topic, characterBible),
    [selectedArchetype, contentMode, topic, characterBible]
  );

  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [isRecordingClips, setIsRecordingClips] = useState(false);
  const [recordStatus, setRecordStatus] = useState('');

  const mountRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<CharacterRig | null>(null);
  const rigArchetypeRef = useRef<Exclude<CharacterArchetype, 'auto'> | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const envRef = useRef<StageEnvironment | null>(null);

  // Mutable loop refs so React UI updates never tear down WebGL
  const stateRef = useRef({
    activeSceneIndex: 0,
    isPlaying: true,
    choreographies,
    sceneElapsed: 0,
    isRecording: false,
  });

  useEffect(() => {
    stateRef.current.choreographies = choreographies;
    if (stateRef.current.activeSceneIndex >= choreographies.length) {
      stateRef.current.activeSceneIndex = 0;
      setActiveSceneIndex(0);
      stateRef.current.sceneElapsed = 0;
    }
  }, [choreographies]);

  useEffect(() => {
    stateRef.current.activeSceneIndex = activeSceneIndex;
    stateRef.current.sceneElapsed = 0;
  }, [activeSceneIndex]);

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
  }, [isPlaying]);

  // Swap 3D character archetype seamlessly when user switches Fox / Hero / Robot / Chef
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || rigArchetypeRef.current === resolvedArchetype) return;
    const prev = rigRef.current;
    const next = buildCharacterRig(resolvedArchetype);
    if (prev) {
      next.posX = prev.posX;
      next.posZ = prev.posZ;
      next.yaw = prev.yaw;
      scene.remove(prev.root);
      prev.dispose();
    }
    scene.add(next.root);
    rigRef.current = next;
    rigArchetypeRef.current = resolvedArchetype;
  }, [resolvedArchetype]);

  // Update camera aspect cleanly when switching Shorts (9:16) / YouTube (16:9)
  useEffect(() => {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!mount || !camera || !renderer) return;
    const w = mount.clientWidth || 360;
    const h = mount.clientHeight || 480;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }, [isShorts]);

  // Mount WebGL once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = mount.clientWidth || 360;
    const height = mount.clientHeight || 480;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 5.4);
    cameraRef.current = camera;

    const stageEnv = createStageEnvironment(scene, renderer, isSoftwareGl);
    envRef.current = stageEnv;

    const initialRig = buildCharacterRig(resolvedArchetype);
    scene.add(initialRig.root);
    rigRef.current = initialRig;
    rigArchetypeRef.current = resolvedArchetype;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const st = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(0.08, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const st = stateRef.current;
      const list = st.choreographies;
      const choreo: SceneChoreography | undefined = list[st.activeSceneIndex] ?? list[0];

      if (choreo && rigRef.current && envRef.current) {
        if (st.isPlaying && !st.isRecording) {
          st.sceneElapsed += delta;
          if (st.sceneElapsed >= choreo.durationSec && list.length > 1) {
            const nextIdx = (st.activeSceneIndex + 1) % list.length;
            st.activeSceneIndex = nextIdx;
            st.sceneElapsed = 0;
            setActiveSceneIndex(nextIdx);
          }
        } else if (st.isRecording) {
          st.sceneElapsed += delta;
        }

        const progress = Math.min(1, st.sceneElapsed / Math.max(1, choreo.durationSec));
        animateCharacterRig(
          rigRef.current,
          choreo,
          elapsed,
          progress,
          delta,
          envRef.current.groundHeightAt
        );
        envRef.current.applyMood(choreo.mood, delta);
        envRef.current.updateParticles(elapsed, rigRef.current.posX, rigRef.current.posZ);

        // Smooth camera blocking per scene preset
        const cx = rigRef.current.posX;
        const cz = rigRef.current.posZ;
        switch (choreo.camera) {
          case 'closeup':
            _camTargetPos.set(cx + 0.55, 1.55, cz + 2.7);
            _camTargetLook.set(cx, 1.15, cz);
            break;
          case 'dramatic':
            _camTargetPos.set(cx - 1.5, 1.05, cz + 3.4);
            _camTargetLook.set(cx, 1.05, cz);
            break;
          case 'orbit':
            _camTargetPos.set(cx + Math.sin(elapsed * 0.7) * 3.6, 2.0, cz + Math.cos(elapsed * 0.7) * 3.6);
            _camTargetLook.set(cx, 0.95, cz);
            break;
          case 'follow':
            _camTargetPos.set(cx * 0.7 + 0.8, 1.9, cz + 4.0);
            _camTargetLook.set(cx, 0.95, cz);
            break;
          case 'wide':
          default:
            _camTargetPos.set(0, 2.25, 5.6);
            _camTargetLook.set(cx * 0.5, 0.95, cz * 0.4);
            break;
        }

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 4.2, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 4.2, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 4.2, delta);
        _camCurrentLook.x = THREE.MathUtils.damp(_camCurrentLook.x, _camTargetLook.x, 5.0, delta);
        _camCurrentLook.y = THREE.MathUtils.damp(_camCurrentLook.y, _camTargetLook.y, 5.0, delta);
        _camCurrentLook.z = THREE.MathUtils.damp(_camCurrentLook.z, _camTargetLook.z, 5.0, delta);
        camera.lookAt(_camCurrentLook);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    const handleResize = () => {
      if (!mount || disposed) return;
      const w = mount.clientWidth || 360;
      const h = mount.clientHeight || 480;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    tick();

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (rigRef.current) {
        rigRef.current.dispose();
        rigRef.current = null;
      }
      if (envRef.current) {
        envRef.current.dispose();
        envRef.current = null;
      }
      envTarget.dispose();
      renderer.dispose();
    };
  }, []);

  const captureAndAttachAllScenes = async () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setRecordStatus('3D clip recording is not supported on this browser.');
      return;
    }
    if (!onAttachCapturedClips || isRecordingClips) return;

    const mimeType =
      ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      ) || '';
    if (!mimeType) {
      setRecordStatus('No WebM video recorder codec available in this browser.');
      return;
    }

    setIsRecordingClips(true);
    stateRef.current.isRecording = true;
    const captured: Array<{ sceneIndex: number; file: File }> = [];

    try {
      for (let idx = 0; idx < activeSlabs.length; idx++) {
        setActiveSceneIndex(idx);
        stateRef.current.activeSceneIndex = idx;
        stateRef.current.sceneElapsed = 0;
        setRecordStatus(`Recording 3D Scene ${idx + 1} of ${activeSlabs.length}…`);

        const stream = canvas.captureStream(25);
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
        const recordedBlob = await new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onerror = () => reject(new Error('Recording failed'));
          recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
          recorder.start(150);
          window.setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
          }, 2600);
        });
        stream.getTracks().forEach((t) => t.stop());

        const file = new File([recordedBlob], `scene_3d_${idx + 1}.webm`, { type: 'video/webm' });
        captured.push({ sceneIndex: idx, file });
      }

      onAttachCapturedClips(captured);
      setRecordStatus(`Attached ${captured.length} animated 3D clips to your scenes.`);
    } catch (err) {
      setRecordStatus(err instanceof Error ? err.message : 'Failed to capture 3D scene clips.');
    } finally {
      stateRef.current.isRecording = false;
      setIsRecordingClips(false);
    }
  };

  const currentSlab = activeSlabs[activeSceneIndex] ?? activeSlabs[0];
  const currentChoreo = choreographies[activeSceneIndex] ?? choreographies[0];

  return (
    <div className="rounded-2xl bg-[#121714] border border-white/[0.08] overflow-hidden flex flex-col">
      {/* Stage Viewport */}
      <div
        className={`relative w-full bg-[#0B0F0D] ${
          isShorts ? 'aspect-[9/14] max-h-[560px]' : 'aspect-video min-h-[300px]'
        } mx-auto`}
      >
        <div ref={mountRef} className="absolute inset-0 w-full h-full" />

        {/* Top-left quiet scene label (unboxed, zero pulsating dots, no backdrop-blur) */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <span className="px-2.5 py-1 rounded-lg bg-[#0B0F0D]/80 text-xs font-medium text-neutral-200 tabular-nums">
            Scene {String(activeSceneIndex + 1).padStart(2, '0')}/{String(activeSlabs.length).padStart(2, '0')} ·{' '}
            {currentChoreo?.action ?? 'talk'}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-[#0B0F0D]/80 text-[11px] font-medium text-[#39FF14]">
            3D Character Stage
          </span>
        </div>

        {/* Subtitle Overlay synced to active scene */}
        {currentSlab && (
          <div
            className={`absolute left-4 right-4 flex justify-center pointer-events-none transition-all ${
              controlsCollapsed ? 'bottom-12' : 'bottom-32'
            }`}
          >
            <div className="max-w-md px-3.5 py-2 rounded-xl bg-[#0B0F0D]/85 border border-white/10 text-center">
              <p className="text-xs sm:text-sm font-medium text-white leading-snug line-clamp-2">
                {currentSlab.voiceover_text}
              </p>
            </div>
          </div>
        )}

        {/* Collapsible Bottom Control Dock inside Viewport */}
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-[94%] max-w-[520px] flex flex-col items-center gap-1.5 z-10">
          <button
            type="button"
            onClick={() => setControlsCollapsed((v) => !v)}
            className="px-3 py-1 rounded-lg bg-[#0B0F0D]/90 border border-white/15 text-[11px] font-medium text-neutral-300 hover:text-white cursor-pointer"
          >
            {controlsCollapsed ? '▴ Show 3D Controls' : '▾ Hide Controls'}
          </button>

          {!controlsCollapsed && (
            <div className="w-full rounded-xl bg-[#0E1310]/92 border border-white/12 p-2.5 flex flex-col gap-2">
              {/* Row 1: Play/Pause + Scene Jump Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto chip-scroll">
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  disabled={isRecordingClips}
                  className="min-h-[34px] px-3 rounded-lg bg-[#39FF14] text-black text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                {activeSlabs.map((s, idx) => (
                  <button
                    key={`${s.id}-${idx}`}
                    type="button"
                    onClick={() => setActiveSceneIndex(idx)}
                    disabled={isRecordingClips}
                    className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                      activeSceneIndex === idx
                        ? 'bg-[#1D2721] text-[#39FF14] border border-[#39FF14]/60'
                        : 'bg-[#151C18] text-neutral-300 border border-white/[0.06] hover:text-white'
                    }`}
                  >
                    S{idx + 1}
                  </button>
                ))}
              </div>

              {/* Row 2: Character Selector + Send 3D Clips to Video */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  {CHARACTER_OPTIONS.map((ch) => (
                    <button
                      key={ch.value}
                      type="button"
                      onClick={() => setSelectedArchetype(ch.value)}
                      disabled={isRecordingClips}
                      className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                        selectedArchetype === ch.value
                          ? 'bg-[#1D2721] text-[#39FF14]'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {ch.label}
                    </button>
                  ))}
                </div>

                {onAttachCapturedClips && (
                  <button
                    type="button"
                    onClick={captureAndAttachAllScenes}
                    disabled={isRecordingClips}
                    className="min-h-[34px] px-3 rounded-lg bg-[#1A261E] border border-[#39FF14]/50 text-[#39FF14] text-[11px] font-semibold whitespace-nowrap cursor-pointer hover:bg-[#39FF14]/15 disabled:opacity-50"
                  >
                    {isRecordingClips ? 'Recording 3D…' : 'Use 3D Scenes in MP4'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {recordStatus && (
        <div className="px-4 py-2.5 border-t border-white/[0.06] text-xs text-[#39FF14]">
          {recordStatus}
        </div>
      )}
    </div>
  );
};
