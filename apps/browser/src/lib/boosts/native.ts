import { requireOptionalNativeModule } from "expo-modules-core";

type Published = { path: string; changed: boolean };

const Boosts = requireOptionalNativeModule<{
  publish(folder: string, files: Record<string, string>): Promise<Published>;
  remove(folder: string): Promise<void>;
  folders(): Promise<string[]>;
  exportFile(name: string, contents: string): Promise<boolean>;
  importFile(): Promise<string | null>;
  pasteboardText(): string | null;
}>("OrbitBoosts");

export const boostsNativeAvailable = () => !!Boosts;

const missing = () => Promise.reject(new Error("This build of Orbit can't apply boosts yet. Update Orbit."));

export const publishBoostsFolder = (folder: string, files: Record<string, string>): Promise<Published> =>
  Boosts ? Boosts.publish(folder, files) : missing();

export const removeBoostsFolder = (folder: string): Promise<void> => Boosts?.remove(folder) ?? Promise.resolve();

export const boostsFolders = (): Promise<string[]> => Boosts?.folders() ?? Promise.resolve([]);

export const saveBoostFile = (name: string, contents: string): Promise<boolean> => (Boosts ? Boosts.exportFile(name, contents) : missing());

export const openBoostFile = (): Promise<string | null> => (Boosts ? Boosts.importFile() : missing());

export const pasteboardText = (): string | null => Boosts?.pasteboardText() ?? null;
