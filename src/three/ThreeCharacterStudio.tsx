import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ContentMode, VideoSlab } from '../types/video';
import { animateCharacterRig, buildCharacterRig, type CharacterRig } from './characterRig';
import { createStageEnvironment, type StageEnvironment } from './stageEnvironment';
import {
  ACTION_OPTIONS,
  analyzeSceneChoreography,
  DEFAULT_DEMO_SLABS,
  resolveCharacterArchetype,
  type CharacterAction,
  type CharacterArchetype,
  type SceneChoreography,
} from './types';

export interface ThreeCharacterStudioHandle {
  captureScenesForExport: (
    overrideSlabs?: VideoSlab[],
    onProgress?: (sceneIdx: number, total: number) => void
  ) => Promise<Array<{ sceneIndex: number; file: File }>>;
}

interface ThreeCharacterStudioProps {
  slabs: VideoSlab[] | null;
  contentMode: ContentMode;
  topic: string;
  characterBible?: string;
  isShorts: boolean;
  hidden?: boolean;
  onAttachCapturedClips?: (clips: Array<{ sceneIndex: number; file: File }>) => void;
}

const CHARACTER_OPTIONS: Array<{ value: CharacterArchetype; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'critic', label: 'Critic' },
  { value: 'streamer', label: 'Reactor' },
  { value: 'hero', label: 'Hero' },
  { value: 'fox', label: 'Fox' },
  { value: 'chef', label: 'Chef' },
  { value: 'robot', label: 'Robot' },
];

const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3(0, 1.05, 0);

export const ThreeCharacterStudio = forwardRef<ThreeCharacterStudioHandle, ThreeCharacterStudioProps>(
  (
    {
      slabs,
      contentMode,
      topic,
      characterBible = '',
      isShorts,
      hidden = false,
      onAttachCapturedClips,
    },
    ref
  ) => {
    const activeSlabs = useMemo(
      () => (slabs && slabs.length > 0 ? slabs : DEFAULT_DEMO_SLABS),
      [slabs]
    );

    const [selectedArchetype, setSelectedArchetype] = useState<CharacterArchetype>('auto');
    const [actionOverrides, setActionOverrides] = useState<Record<number, CharacterAction | undefined>>({});
    const resolvedArchetype = useMemo(
      () => resolveCharacterArchetype(selectedArchetype, contentMode, topic, characterBible),
      [selectedArchetype, contentMode, topic, characterBible]
    );

    const choreographies = useMemo(
      () =>
        activeSlabs.map((slab, idx) =>
          analyzeSceneChoreography(
            slab,
            idx,
            activeSlabs.length,
            contentMode,
            topic,
            actionOverrides[idx]
          )
        ),
      [activeSlabs, contentMode, topic, actionOverrides]
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
    const isSoftwareGlRef = useRef<boolean>(false);

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

    // Swap 3D character archetype seamlessly when category or selector changes
    useEffect(() => {
      const scene = sceneRef.current;
      const renderer = rendererRef.current ?? undefined;
      if (!scene || rigArchetypeRef.current === resolvedArchetype) return;
      const prev = rigRef.current;
      const next = buildCharacterRig(resolvedArchetype, renderer);
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

    // Resize canvas when toggling Shorts (9:16) / YouTube (16:9) or visibility
    useEffect(() => {
      if (hidden || stateRef.current.isRecording) return;
      const mount = mountRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!mount || !camera || !renderer) return;
      const w = mount.clientWidth || (isShorts ? 360 : 540);
      const h = mount.clientHeight || (isShorts ? 520 : 310);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(isSoftwareGlRef.current ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
    }, [isShorts, hidden]);

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
      isSoftwareGlRef.current = isSoftwareGl;

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
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
      scene.environmentIntensity = 1.15;
      roomEnv.dispose();
      pmremGenerator.dispose();

      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
      camera.position.set(0, 1.9, 4.9);
      cameraRef.current = camera;

      const stageEnv = createStageEnvironment(scene, renderer, isSoftwareGl);
      envRef.current = stageEnv;

      const initialRig = buildCharacterRig(resolvedArchetype, renderer);
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

          const targetDur = st.isRecording ? 2.4 : Math.max(1, choreo.durationSec);
          const progress = Math.min(1, st.sceneElapsed / targetDur);
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

          // Crisp camera framing per action/scene
          const cx = rigRef.current.posX;
          const cz = rigRef.current.posZ;
          switch (choreo.camera) {
            case 'closeup':
              _camTargetPos.set(cx + 0.45, 1.52, cz + 2.45);
              _camTargetLook.set(cx, 1.25, cz);
              break;
            case 'dramatic':
              _camTargetPos.set(cx - 1.35, 1.15, cz + 3.05);
              _camTargetLook.set(cx, 1.12, cz);
              break;
            case 'orbit':
              _camTargetPos.set(
                cx + Math.sin(elapsed * 0.72) * 3.3,
                1.95,
                cz + Math.cos(elapsed * 0.72) * 3.3
              );
              _camTargetLook.set(cx, 1.05, cz);
              break;
            case 'follow':
              _camTargetPos.set(cx * 0.75 + 0.7, 1.8, cz + 3.65);
              _camTargetLook.set(cx, 1.05, cz);
              break;
            case 'wide':
            default:
              _camTargetPos.set(0, 2.05, 4.9);
              _camTargetLook.set(cx * 0.45, 1.05, cz * 0.35);
              break;
          }

          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 4.5, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 4.5, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 4.5, delta);
          _camCurrentLook.x = THREE.MathUtils.damp(_camCurrentLook.x, _camTargetLook.x, 5.4, delta);
          _camCurrentLook.y = THREE.MathUtils.damp(_camCurrentLook.y, _camTargetLook.y, 5.4, delta);
          _camCurrentLook.z = THREE.MathUtils.damp(_camCurrentLook.z, _camTargetLook.z, 5.4, delta);
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
        if (!mount || disposed || stateRef.current.isRecording) return;
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (w <= 0 || h <= 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };

      const ro = new ResizeObserver(handleResize);
      ro.observe(mount);
      window.addEventListener('resize', handleResize);
      tick();

      return () => {
        disposed = true;
        ro.disconnect();
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

    const captureScenesForExport = async (
      overrideSlabs?: VideoSlab[],
      onProgress?: (sceneIdx: number, total: number) => void
    ): Promise<Array<{ sceneIndex: number; file: File }>> => {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const canvas = renderer?.domElement;
      if (!renderer || !camera || !canvas) {
        throw new Error('3D stage is not ready yet.');
      }
      if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
        throw new Error('3D video capture is not supported in this browser.');
      }

      const mimeType =
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
          MediaRecorder.isTypeSupported(m)
        ) || '';
      if (!mimeType) {
        throw new Error('No WebM video codec supported in this browser.');
      }

      const targetSlabs = overrideSlabs && overrideSlabs.length > 0 ? overrideSlabs : activeSlabs;
      const targetChoreos = targetSlabs.map((slab, idx) =>
        analyzeSceneChoreography(
          slab,
          idx,
          targetSlabs.length,
          contentMode,
          topic,
          actionOverrides[idx]
        )
      );
      stateRef.current.choreographies = targetChoreos;

      // Render crisp 720p portrait (9:16) or landscape (16:9) frames into canvas buffer
      const exportW = isShorts ? 720 : 1280;
      const exportH = isShorts ? 1280 : 720;

      setIsRecordingClips(true);
      stateRef.current.isRecording = true;
      renderer.setPixelRatio(1);
      renderer.setSize(exportW, exportH, false);
      camera.aspect = exportW / exportH;
      camera.updateProjectionMatrix();

      const captured: Array<{ sceneIndex: number; file: File }> = [];
      try {
        for (let idx = 0; idx < targetSlabs.length; idx++) {
          setActiveSceneIndex(idx);
          stateRef.current.activeSceneIndex = idx;
          stateRef.current.sceneElapsed = 0;
          setRecordStatus(`Recording crisp 3D Scene ${idx + 1} of ${targetSlabs.length}…`);
          onProgress?.(idx, targetSlabs.length);

          // Let the stage/mood settle briefly before recording each scene
          await new Promise((r) => window.setTimeout(r, 120));

          const stream = canvas.captureStream(25);
          const chunks: BlobPart[] = [];
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 4_500_000,
          });
          const recordedBlob = await new Promise<Blob>((resolve, reject) => {
            recorder.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onerror = () => reject(new Error('3D scene capture failed'));
            recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
            recorder.start(150);
            window.setTimeout(() => {
              if (recorder.state !== 'inactive') recorder.stop();
            }, 2400);
          });
          stream.getTracks().forEach((t) => t.stop());

          const file = new File([recordedBlob], `scene_3d_${idx + 1}.webm`, {
            type: 'video/webm',
          });
          captured.push({ sceneIndex: idx, file });
        }
        return captured;
      } finally {
        stateRef.current.isRecording = false;
        setIsRecordingClips(false);
        const mount = mountRef.current;
        const restoreW = mount?.clientWidth || (isShorts ? 360 : 540);
        const restoreH = mount?.clientHeight || (isShorts ? 520 : 310);
        renderer.setPixelRatio(isSoftwareGlRef.current ? 1 : Math.min(window.devicePixelRatio, 2));
        renderer.setSize(restoreW, restoreH, true);
        camera.aspect = restoreW / restoreH;
        camera.updateProjectionMatrix();
      }
    };

    useImperativeHandle(ref, () => ({
      captureScenesForExport,
    }));

    const handleManualAttach = async () => {
      if (!onAttachCapturedClips || isRecordingClips) return;
      try {
        const clips = await captureScenesForExport();
        onAttachCapturedClips(clips);
        setRecordStatus(`Attached ${clips.length} crisp 3D clips to Storyboard.`);
      } catch (err) {
        setRecordStatus(err instanceof Error ? err.message : 'Failed to capture 3D clips.');
      }
    };

    const currentSlab = activeSlabs[activeSceneIndex] ?? activeSlabs[0];
    const currentChoreo = choreographies[activeSceneIndex] ?? choreographies[0];

    return (
      <div
        className={`rounded-2xl bg-[#121714] border border-white/[0.08] overflow-hidden flex flex-col ${
          hidden ? 'fixed -left-[9999px] top-0 w-[360px] opacity-0 pointer-events-none' : ''
        }`}
      >
        {/* Stage Viewport */}
        <div
          className={`relative w-full bg-[#0B0F0D] ${
            isShorts ? 'aspect-[9/14] max-h-[560px]' : 'aspect-video min-h-[300px]'
          } mx-auto`}
        >
          <div ref={mountRef} className="absolute inset-0 w-full h-full" />

          {/* Top-left quiet scene status (no backdrop-blur, zero pulsating dots) */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
            <span className="px-2.5 py-1 rounded-lg bg-[#0B0F0D]/80 text-xs font-medium text-neutral-200 tabular-nums">
              Scene {String(activeSceneIndex + 1).padStart(2, '0')}/
              {String(activeSlabs.length).padStart(2, '0')} · {currentChoreo?.action ?? 'talk'}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#0B0F0D]/80 text-[11px] font-medium text-[#39FF14] capitalize">
              {resolvedArchetype} · 3D Stage
            </span>
          </div>

          {/* Subtitle Overlay synced to active scene */}
          {currentSlab && (
            <div
              className={`absolute left-4 right-4 flex justify-center pointer-events-none transition-all ${
                controlsCollapsed ? 'bottom-12' : 'bottom-44'
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
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-[94%] max-w-[540px] flex flex-col items-center gap-1.5 z-10">
            <button
              type="button"
              onClick={() => setControlsCollapsed((v) => !v)}
              className="px-3 py-1 rounded-lg bg-[#0B0F0D]/90 border border-white/15 text-[11px] font-medium text-neutral-300 hover:text-white cursor-pointer"
            >
              {controlsCollapsed ? '▴ Show 3D Controls' : '▾ Hide Controls'}
            </button>

            {!controlsCollapsed && (
              <div className="w-full rounded-xl bg-[#0E1310]/94 border border-white/12 p-2.5 flex flex-col gap-2">
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

                {/* Row 2: Per-Scene Action Picker */}
                <div className="flex items-center gap-1 overflow-x-auto chip-scroll">
                  <button
                    type="button"
                    onClick={() =>
                      setActionOverrides((prev) => {
                        const next = { ...prev };
                        delete next[activeSceneIndex];
                        return next;
                      })
                    }
                    disabled={isRecordingClips}
                    className={`min-h-[30px] px-2 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      !actionOverrides[activeSceneIndex]
                        ? 'bg-[#1D2721] text-[#39FF14]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Auto Action
                  </button>
                  {ACTION_OPTIONS.map((act) => {
                    const isSelected = currentChoreo?.action === act.value;
                    return (
                      <button
                        key={act.value}
                        type="button"
                        onClick={() => {
                          setActionOverrides((prev) => ({
                            ...prev,
                            [activeSceneIndex]: act.value,
                          }));
                          stateRef.current.sceneElapsed = 0;
                        }}
                        disabled={isRecordingClips}
                        className={`min-h-[30px] px-2 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-[#1D2721] text-[#39FF14] border border-[#39FF14]/40'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {act.label}
                      </button>
                    );
                  })}
                </div>

                {/* Row 3: Character Selector + Capture to Storyboard */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1 overflow-x-auto chip-scroll">
                    {CHARACTER_OPTIONS.map((ch) => (
                      <button
                        key={ch.value}
                        type="button"
                        onClick={() => setSelectedArchetype(ch.value)}
                        disabled={isRecordingClips}
                        className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer ${
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
                      onClick={handleManualAttach}
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
  }
);
ThreeCharacterStudio.displayName = 'ThreeCharacterStudio';
