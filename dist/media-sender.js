import { readFile, unlink } from "node:fs/promises";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const HOME_DIR = homedir();
const ALBUM_MAX = 10;

const MEDIA_EXTS = new Set([
  "mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "opus", "wma",
  "mp4", "mkv", "webm", "mov", "avi",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg",
]);

/**
 * Extract media URLs and local file paths from text.
 */
export function extractMediaUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"']+\.([a-zA-Z0-9]+)(?:\?[^\s<>"']*)?(?=[\s<>"']|$)/g;
  const localRegex = /(?:^|[\s(]|~\/|\$HOME\/)(\/[^\s:"')]+)\.([a-zA-Z0-9]+)(?=[\s:"')]|$)/gm;
  const seen = new Set();
  const results = [];

  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const ext = match[1].toLowerCase();
    if (MEDIA_EXTS.has(ext)) {
      let url = match[0].replace(/[.,;:!?]+$/, "");
      if (!seen.has(url)) {
        seen.add(url);
        results.push({ url, ext, isLocal: false });
      }
    }
  }

  while ((match = localRegex.exec(text)) !== null) {
    const ext = match[2].toLowerCase();
    if (!MEDIA_EXTS.has(ext)) continue;
    let filePath = match[1] + "." + ext;
    if (filePath.startsWith("~")) {
      filePath = path.join(HOME_DIR, filePath.slice(1));
    }
    filePath = filePath.replace(/[.,;:!?]+$/, "");
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    try {
      const st = statSync(filePath);
      if (st.isFile() && st.size > 0) {
        results.push({ url: filePath, ext, isLocal: true, size: st.size });
      }
    } catch {}
  }

  return results;
}

async function probeUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    const isMedia = /^(audio|video|image)\//.test(contentType);
    return { url, contentType, isMedia };
  } catch {
    return null;
  }
}

async function downloadToTemp(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const contentDisposition = response.headers.get("content-disposition") || "";
  const urlExt = path.extname(new URL(url).pathname).toLowerCase() || ".bin";
  const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
  const fileName = fileNameMatch ? fileNameMatch[1] : `download${urlExt}`;
  const ext = path.extname(fileName).toLowerCase() || urlExt;
  const tempPath = path.join(tmpdir(), `telepi_media_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  const writer = createWriteStream(tempPath);
  await new Promise((resolve, reject) => {
    response.body.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return { tempPath, ext, fileName };
}

function classifyMedia(contentType, ext) {
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("image/")) return "image";
  if (["mp3","wav","ogg","flac","aac","m4a","opus"].includes(ext)) return "audio";
  if (["mp4","mkv","webm","mov","avi"].includes(ext)) return "video";
  if (["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)) return "image";
  return "document";
}

function extToContentType(ext) {
  const map = {
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
    aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Ensure a media item has a resolved source (local path or downloaded temp path).
 * Returns { source, fileName, ext }.
 */
async function resolveSource(item) {
  if (item.isLocal) {
    return { source: item.url, fileName: path.basename(item.url), ext: item.ext, isTemp: false };
  }
  const { tempPath, ext, fileName } = await downloadToTemp(item.url);
  return { source: tempPath, fileName, ext, isTemp: true };
}

/**
 * Get or download the source for a media item.
 * For local files: read into Buffer immediately (needed for media groups).
 * For remote: download first, then read.
 */
async function resolveInputFile(item) {
  if (item.isLocal) {
    const buffer = await readFile(item.url);
    return { source: buffer, filename: path.basename(item.url) };
  }
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = path.basename(new URL(item.url).pathname) || "download";
  return { source: buffer, filename: fileName };
}

/**
 * Send a single audio file to Telegram.
 */
async function sendAudio(api, target, item) {
  const { source, fileName, isTemp } = await resolveSource(item);
  try {
    await api.sendAudio(target.chatId, { source, filename: fileName }, {
      ...(target.messageThreadId !== undefined ? { message_thread_id: target.messageThreadId } : {}),
    });
  } finally {
    if (isTemp) unlink(source).catch(() => {});
  }
}

/**
 * Send a media group (album) of photos and/or videos.
 * Max 10 items. Mixed photo+video is supported by Telegram API.
 */
async function sendMediaGroup(api, target, groupItems) {
  const media = [];
  for (const item of groupItems) {
    const inputFile = await resolveInputFile(item);
    const mediaType = classifyMedia(item.contentType || extToContentType(item.ext), item.ext);

    if (mediaType === "image") {
      media.push({
        type: "photo",
        media: inputFile.source,
        filename: inputFile.filename,
      });
    } else if (mediaType === "video") {
      media.push({
        type: "video",
        media: inputFile.source,
        filename: inputFile.filename,
      });
    }
  }

  if (media.length === 0) return;
  // Chunk into albums of max ALBUM_MAX
  for (let i = 0; i < media.length; i += ALBUM_MAX) {
    const chunk = media.slice(i, i + ALBUM_MAX);
    try {
      await api.sendMediaGroup(target.chatId, chunk, {
        ...(target.messageThreadId !== undefined ? { message_thread_id: target.messageThreadId } : {}),
      });
    } catch (err) {
      console.error("Failed to send media group:", err);
      // Fallback: send individually
      for (const m of chunk) {
        try {
          if (m.type === "photo") {
            await api.sendPhoto(target.chatId, m.media, {
              ...(target.messageThreadId !== undefined ? { message_thread_id: target.messageThreadId } : {}),
            });
          } else {
            await api.sendVideo(target.chatId, m.media, {
              ...(target.messageThreadId !== undefined ? { message_thread_id: target.messageThreadId } : {}),
            });
          }
        } catch (e2) {
          console.error("Failed to send individual media:", e2);
        }
      }
    }
  }
}

/**
 * Main entry: check final response text for media, send everything automatically.
 * Returns the media items found (for logging).
 */
export async function maybeSendMedia(ctx, target, finalText, responseMessageId, bot) {
  const items = extractMediaUrls(finalText);
  if (items.length === 0) return [];

  const api = ctx?.api || bot.api;

  // Separate local vs remote, probe remote
  const remoteItems = items.filter(i => !i.isLocal);
  const localItems = items.filter(i => i.isLocal);

  const localProbed = localItems.map(i => ({
    url: i.url, ext: i.ext, isLocal: true,
    contentType: extToContentType(i.ext), isMedia: true, size: i.size,
  }));

  const remoteProbed = (await Promise.all(remoteItems.map(u => probeUrl(u.url))))
    .filter(Boolean)
    .filter(p => p.isMedia);

  const allItems = [...localProbed, ...remoteProbed];

  // Separate into album-capable (photo/video) and audio
  const albumItems = allItems.filter(i => {
    const t = classifyMedia(i.contentType || extToContentType(i.ext), i.ext);
    return t === "image" || t === "video";
  });
  const audioItems = allItems.filter(i => {
    const t = classifyMedia(i.contentType || extToContentType(i.ext), i.ext);
    return t === "audio";
  });

  // Send albums
  if (albumItems.length > 0) {
    await sendMediaGroup(api, target, albumItems);
  }

  // Send audio one by one
  for (const item of audioItems) {
    try {
      await sendAudio(api, target, item);
    } catch (err) {
      console.error("Failed to send audio:", err);
    }
  }

  return allItems;
}
