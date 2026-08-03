import { rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { env } from "../../config/env";
import { describeError, logger } from "../../lib/logger";

/**
 * Server-side image processing, applied once at upload.
 *
 * Three things happen here, and only one of them is about disk space:
 *
 *   1. Resize. Phone cameras produce 4000px images that no chat bubble or
 *      avatar will ever display at full size. Shrinking at upload saves storage
 *      once and bandwidth on every subsequent view, which matters most to the
 *      people on the worst connections.
 *   2. Re-encode at a fixed quality, so a 12 MB photo becomes a few hundred KB.
 *   3. Strip metadata. This is the one that is not about size: phone photos
 *      routinely carry EXIF GPS coordinates, so an unprocessed upload tells
 *      every viewer where it was taken. sharp drops metadata unless explicitly
 *      asked to keep it, and we never ask.
 *
 * Failure is never fatal. If an image cannot be decoded the original is kept and
 * the upload still succeeds, because refusing a photo is worse than storing a
 * large one.
 */

export type ImageProfile = "message" | "avatar";

interface ProfileSettings {
  maxDimension: number;
  quality: number;
}

function settingsFor(profile: ImageProfile): ProfileSettings {
  return profile === "avatar"
    ? { maxDimension: env.MEDIA_AVATAR_MAX_DIMENSION, quality: env.MEDIA_AVATAR_QUALITY }
    : { maxDimension: env.MEDIA_IMAGE_MAX_DIMENSION, quality: env.MEDIA_IMAGE_QUALITY };
}

/** Extensions worth re-encoding, mapped to the format sharp should emit. */
const REENCODE_AS = new Map<string, "jpeg" | "png" | "webp">([
  ["jpg", "jpeg"],
  ["png", "png"],
  ["webp", "webp"],
  // Apple's default camera format. Poorly supported outside Apple platforms, so
  // it becomes a JPEG when sharp's build can decode it.
  ["heic", "jpeg"],
]);

/**
 * Animated formats are left alone.
 *
 * Resizing an animated GIF requires decoding every frame, and getting it wrong
 * silently flattens the animation to a single frame. Not worth it for the size
 * saved.
 */
const SKIP_EXTENSIONS = new Set(["gif"]);

export interface ProcessedImage {
  /** File name after processing. Differs from the input only for HEIC. */
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  /** False when the original was kept, for any reason. */
  processed: boolean;
}

/**
 * Compresses an image in place, returning its final name and size.
 *
 * sharp cannot write to the file it is reading, so output goes to a sibling
 * temporary file which then replaces the original.
 */
export async function processImage(
  absolutePath: string,
  profile: ImageProfile,
): Promise<ProcessedImage> {
  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).slice(1).toLowerCase();

  const unchanged = async (): Promise<ProcessedImage> => ({
    fileName,
    absolutePath,
    sizeBytes: (await stat(absolutePath)).size,
    processed: false,
  });

  if (SKIP_EXTENSIONS.has(extension)) return unchanged();

  const format = REENCODE_AS.get(extension);
  if (!format) return unchanged();

  const { maxDimension, quality } = settingsFor(profile);

  // HEIC becomes a JPEG, so both the extension and the stored name change.
  const outputExtension = format === "jpeg" ? "jpg" : format;
  const outputFileName = `${path.basename(fileName, path.extname(fileName))}.${outputExtension}`;
  const outputPath = path.join(path.dirname(absolutePath), outputFileName);
  const temporaryPath = `${outputPath}.tmp`;

  try {
    const before = (await stat(absolutePath)).size;

    const pipeline = sharp(absolutePath, { failOn: "error" }).rotate().resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      // Never upscale a small image into a large file.
      withoutEnlargement: true,
    });

    if (format === "jpeg") {
      await pipeline.jpeg({ quality, mozjpeg: true }).toFile(temporaryPath);
    } else if (format === "png") {
      await pipeline.png({ compressionLevel: 9, palette: true }).toFile(temporaryPath);
    } else {
      await pipeline.webp({ quality }).toFile(temporaryPath);
    }

    await rename(temporaryPath, outputPath);

    // Only true for HEIC, where the source file is now a different name.
    if (outputPath !== absolutePath) {
      await unlink(absolutePath).catch(() => undefined);
    }

    const after = (await stat(outputPath)).size;
    logger.info("image processed", {
      profile,
      beforeBytes: before,
      afterBytes: after,
      savedPercent: before > 0 ? Math.round((1 - after / before) * 100) : 0,
    });

    return { fileName: outputFileName, absolutePath: outputPath, sizeBytes: after, processed: true };
  } catch (error) {
    // Most likely an unsupported HEIC build or a corrupt file. Keep the upload.
    await unlink(temporaryPath).catch(() => undefined);
    logger.warn("image could not be processed, keeping the original", {
      fileName,
      ...describeError(error),
    });
    return unchanged();
  }
}

/** Whether this upload is an image this module would try to process. */
export function isProcessableImage(fileName: string): boolean {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return REENCODE_AS.has(extension) && !SKIP_EXTENSIONS.has(extension);
}
