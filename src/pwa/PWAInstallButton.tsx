import React, { useState } from 'react';
import { usePWAInstall } from './usePWAInstall';

interface PWAInstallButtonProps {
  onOpenAndroidModal?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ onOpenAndroidModal }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="px-3.5 py-2 rounded-xl bg-[#39FF14] text-black text-xs font-bold hover:brightness-95 transition-all whitespace-nowrap shrink-0 cursor-pointer min-h-[38px]"
      >
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="px-3.5 py-2 rounded-xl bg-[#1A261E] border border-[#39FF14]/50 text-[#39FF14] text-xs font-semibold hover:bg-[#39FF14]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[38px]"
        >
          Install App
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="max-w-sm w-full rounded-2xl bg-[#121714] border border-white/12 p-5 flex flex-col gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari.<br />
                2. Tap <strong>Add to Home Screen</strong> to install RS Movie Spot.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="min-h-[40px] w-full rounded-xl bg-[#39FF14] text-black text-xs font-bold cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback when viewed inside an embedded preview iframe before opening directly in Chrome
  if (onOpenAndroidModal) {
    return (
      <button
        type="button"
        onClick={onOpenAndroidModal}
        className="px-3.5 py-2 rounded-xl bg-[#39FF14] text-black text-xs font-bold hover:brightness-95 transition-all whitespace-nowrap shrink-0 cursor-pointer min-h-[38px]"
      >
        Install App
      </button>
    );
  }

  return null;
};
