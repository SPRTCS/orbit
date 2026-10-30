import { requireOptionalNativeModule } from "expo-modules-core";

export type ImageInfo = { width: number; height: number; bytes: number; thumbnail?: string };

const Capture = requireOptionalNativeModule<{
  prepareFolder(): Promise<string>;
  imageInfo(path: string, thumbnailWidth: number, maxAspect: number): Promise<ImageInfo | null>;
  copyImage(path: string): Promise<boolean>;
  downloadsFolder(): string;
  saveCopy(from: string, to: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
}>("OrbitCapture");

export const captureNativeAvailable = () => !!Capture;

export const prepareCaptureFolder = (): Promise<string | null> => Capture?.prepareFolder() ?? Promise.resolve(null);

export const capturedImageInfo = (path: string, thumbnailWidth: number, maxAspect: number): Promise<ImageInfo | null> =>
  Capture?.imageInfo(path, thumbnailWidth, maxAspect) ?? Promise.resolve(null);

export const copyCapturedImage = (path: string): Promise<boolean> => Capture?.copyImage(path) ?? Promise.resolve(false);

export const downloadsFolder = (): string | null => Capture?.downloadsFolder() ?? null;

export const saveCapturedCopy = (from: string, to: string): Promise<boolean> => Capture?.saveCopy(from, to) ?? Promise.resolve(false);

export const removeCapturedFile = (path: string): Promise<void> => Capture?.removeFile(path) ?? Promise.resolve();
