import fs from 'node:fs';
import sharp from 'sharp';

function escapeSvg(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function stripDecorativeEmojis(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function renderWatermarkPng(outputFile: string, isShorts: boolean): Promise<void> {
  const w = isShorts ? 310 : 280;
  const h = 58;
  const fontSize = isShorts ? 24 : 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="28" ry="28" fill="rgba(0,0,0,0.53)" stroke="rgba(57,255,20,0.6)" stroke-width="2.5"/>
    <text x="${w / 2}" y="${Math.round(h * 0.66)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#FFFFFF">@RSMovieSpot</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
}

export async function renderSubscribeEndCardPng(outputFile: string, isShorts: boolean): Promise<void> {
  const w = isShorts ? 430 : 380;
  const h = 76;
  const fontSize = isShorts ? 28 : 25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="36" ry="36" fill="#E50914"/>
    <text x="${w / 2}" y="${Math.round(h * 0.64)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#FFFFFF">SUBSCRIBE FOR MORE!</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
}

export async function renderStatBadgePng(
  badgeText: string,
  videoWidth: number,
  isShorts: boolean,
  outputFile: string
): Promise<boolean> {
  const clean = badgeText.trim().toUpperCase();
  if (!clean) return false;

  const fontSize = isShorts ? 36 : 32;
  const approxTextW = Math.min(videoWidth - 140, clean.length * (fontSize * 0.62));
  let w = Math.max(160, Math.round(approxTextW + 64));
  if (w % 2 !== 0) w += 1;
  const h = isShorts ? 74 : 66;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="20" ry="20" fill="#FFD600" stroke="#FFFFFF" stroke-width="3"/>
    <text x="${w / 2}" y="${Math.round(h * 0.66)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#000000">${escapeSvg(clean)}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return fs.existsSync(outputFile);
}

function wrapTextLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) {
        continue;
      }
    } else {
      current = next;
    }
  }
  if (current) {
    if (lines.length >= maxLines) {
      lines[maxLines - 1] = `${lines[maxLines - 1]} ${current}`.slice(0, maxCharsPerLine + 4);
    } else {
      lines.push(current);
    }
  }
  return lines.slice(0, maxLines);
}

export async function renderCaptionPng(
  text: string,
  videoWidth: number,
  isShorts: boolean,
  outputFile: string
): Promise<number | null> {
  const cleanText = text.trim();
  if (!cleanText) return null;

  const maxStripHeight = isShorts ? 320 : 240;
  const fontSize = isShorts ? 50 : 42;
  const maxCharsPerLine = isShorts ? 24 : 38;
  const lines = wrapTextLines(cleanText, maxCharsPerLine, 2);
  if (lines.length === 0) return null;

  const lineHeight = Math.round(fontSize * 1.24);
  const longestLine = Math.max(...lines.map((l) => l.length));
  const contentWidth = Math.max(160, Math.min(videoWidth - 140, longestLine * fontSize * 0.58));
  const contentHeight = Math.max(56, lines.length * lineHeight);
  const boxPadX = isShorts ? 30 : 34;
  const boxPadY = isShorts ? 18 : 16;

  let stripHeight = Math.round(contentHeight + boxPadY * 2 + 28);
  stripHeight = Math.max(100, Math.min(maxStripHeight, stripHeight));
  if (stripHeight % 2 !== 0) stripHeight += 1;

  const boxWidth = Math.min(videoWidth - 48, contentWidth + boxPadX * 2);
  const boxHeight = contentHeight + boxPadY * 2;
  const boxLeft = Math.round((videoWidth - boxWidth) / 2);
  const boxTop = Math.max(4, Math.round((stripHeight - boxHeight) / 2));

  const startY = boxTop + boxPadY + fontSize * 0.85;
  const textEls = lines
    .map((line, i) => {
      const y = Math.round(startY + i * lineHeight);
      const esc = escapeSvg(line);
      return `<text x="${videoWidth / 2}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" stroke="#000000" stroke-width="${isShorts ? 10 : 8}" stroke-linejoin="round" paint-order="stroke fill" fill="#FFE135">${esc}</text>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${videoWidth}" height="${stripHeight}">
    <rect x="${boxLeft}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" rx="24" ry="24" fill="rgba(0,0,0,0.67)" stroke="rgba(255,225,53,0.47)" stroke-width="3"/>
    ${textEls}
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return stripHeight;
}

export async function createFallbackCinemaFrame(
  outputFile: string,
  width: number,
  height: number,
  seedOffset: number
): Promise<void> {
  const topColor = seedOffset % 2 === 0 ? '#2A1519' : '#112233';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${topColor}"/>
        <stop offset="100%" stop-color="#0A0D12"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="42%" r="55%">
        <stop offset="0%" stop-color="rgba(255,168,38,0.26)"/>
        <stop offset="55%" stop-color="rgba(255,168,38,0.07)"/>
        <stop offset="100%" stop-color="rgba(255,168,38,0)"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
}

export async function composeSplitFrame(
  file1: string,
  file2: string,
  outputFile: string,
  width: number,
  height: number
): Promise<void> {
  const isPortrait = height > width;
  if (isPortrait) {
    const halfH = Math.floor(height / 2);
    const b1 = await sharp(file1).resize(width, halfH - 3, { fit: 'cover', position: 'north' }).png().toBuffer();
    const b2 = await sharp(file2).resize(width, height - (halfH + 3), { fit: 'cover', position: 'north' }).png().toBuffer();
    const bar = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6"><rect width="${width}" height="6" fill="#FFE135"/></svg>`
    );
    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .composite([
        { input: b1, left: 0, top: 0 },
        { input: b2, left: 0, top: halfH + 3 },
        { input: bar, left: 0, top: halfH - 3 },
      ])
      .png()
      .toFile(outputFile);
  } else {
    const halfW = Math.floor(width / 2);
    const b1 = await sharp(file1).resize(halfW - 3, height, { fit: 'cover', position: 'north' }).png().toBuffer();
    const b2 = await sharp(file2).resize(width - (halfW + 3), height, { fit: 'cover', position: 'north' }).png().toBuffer();
    const bar = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="${height}"><rect width="6" height="${height}" fill="#FFE135"/></svg>`
    );
    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .composite([
        { input: b1, left: 0, top: 0 },
        { input: b2, left: halfW + 3, top: 0 },
        { input: bar, left: halfW - 3, top: 0 },
      ])
      .png()
      .toFile(outputFile);
  }
}

export async function composeStudioFrameFromRealPhoto(
  rawFile: string,
  outputFile: string,
  targetWidth: number,
  targetHeight: number
): Promise<boolean> {
  try {
    const meta = await sharp(rawFile).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (srcW < 100 || srcH < 100) return false;

    const srcAspect = srcW / srcH;
    const targetAspect = targetWidth / Math.max(1, targetHeight);
    if (targetHeight > targetWidth && srcAspect >= 0.5 && srcAspect <= 0.78) {
      await sharp(rawFile)
        .resize(targetWidth, targetHeight, { fit: 'cover', position: 'north' })
        .png()
        .toFile(outputFile);
    } else if (Math.abs(srcAspect - targetAspect) <= 0.16 && srcH >= srcW * 0.75) {
      await sharp(rawFile)
        .resize(targetWidth, targetHeight, { fit: 'cover', position: 'north' })
        .png()
        .toFile(outputFile);
    } else {
      const bgBuf = await sharp(rawFile)
        .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
        .blur(26)
        .modulate({ brightness: 0.68 })
        .png()
        .toBuffer();

      const isTallCanvas = targetHeight > targetWidth * 1.2;
      const maxW = Math.round(targetWidth * (isTallCanvas ? 0.92 : 0.88));
      const maxH = Math.round(targetHeight * (isTallCanvas ? 0.68 : 0.82));
      const fgBuf = await sharp(rawFile)
        .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();

      const fgMeta = await sharp(fgBuf).metadata();
      const fgW = fgMeta.width ?? maxW;
      const fgH = fgMeta.height ?? maxH;
      const left = Math.round((targetWidth - fgW) / 2);
      const minTop = isTallCanvas ? 110 : 28;
      const idealTop = Math.round((targetHeight - fgH) * (isTallCanvas ? 0.36 : 0.32));
      const top = Math.max(0, Math.min(targetHeight - fgH, Math.max(minTop, idealTop)));

      await sharp(bgBuf)
        .composite([{ input: fgBuf, left, top }])
        .png()
        .toFile(outputFile);
    }
    return fs.existsSync(outputFile) && fs.statSync(outputFile).size > 1024;
  } catch {
    return false;
  }
}

export async function isMostlyBlackOrCorrupt(imageFile: string): Promise<boolean> {
  try {
    if (!fs.existsSync(imageFile) || fs.statSync(imageFile).size < 2048) return true;
    const { data, info } = await sharp(imageFile)
      .resize(24, 24, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.width < 16 || info.height < 16) return true;
    let darkCount = 0;
    const totalPixels = info.width * info.height;
    for (let i = 0; i < totalPixels; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      if (lum < 14) darkCount++;
    }
    return darkCount / totalPixels > 0.93;
  } catch {
    return true;
  }
}

export async function renderCoverThumbnailJpg(
  baseImageFile: string,
  headlineText: string,
  isShorts: boolean,
  outputFile: string
): Promise<void> {
  const thumbW = isShorts ? 1080 : 1280;
  const thumbH = isShorts ? 1920 : 720;

  const cleanTitle = (stripDecorativeEmojis(headlineText) || headlineText.trim()).slice(0, 56);
  const fontSize = isShorts ? 68 : 58;
  const lines = wrapTextLines(cleanTitle, isShorts ? 18 : 26, 2);
  const lineHeight = Math.round(fontSize * 1.15);
  const bottomMargin = isShorts ? 105 : 56;
  const firstLineY = thumbH - bottomMargin - (lines.length - 1) * lineHeight;

  const textEls = lines
    .map((line, i) => {
      const y = Math.round(firstLineY + i * lineHeight);
      return `<text x="${thumbW / 2}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" stroke="#000000" stroke-width="12" stroke-linejoin="round" paint-order="stroke fill" fill="#FFE135">${escapeSvg(line)}</text>`;
    })
    .join('');

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${thumbH}">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.92)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${Math.round(thumbH * 0.5)}" width="${thumbW}" height="${Math.round(thumbH * 0.5)}" fill="url(#scrim)"/>
    ${textEls}
  </svg>`;

  await sharp(baseImageFile)
    .resize(thumbW, thumbH, { fit: 'cover', position: 'attention' })
    .composite([{ input: Buffer.from(overlaySvg), left: 0, top: 0 }])
    .jpeg({ quality: 94 })
    .toFile(outputFile);
}

export async function validateDownloadedImageDimensions(filePath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 8192) return false;
    const meta = await sharp(filePath).metadata();
    return (meta.width ?? 0) >= 300 && (meta.height ?? 0) >= 300;
  } catch {
    return false;
  }
}
