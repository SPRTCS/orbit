import type { BookmarkNode, SpaceSuggestion } from "@ardia/import";
import { planArcImport } from "../../lib/pinnedFolders";
import { isIncognitoProfile, newId } from "../../store/model";

type Layout = { parent: string | null; items: (string | number)[] };

export function arcPinnedFolders(profileId: string, space: SpaceSuggestion): SpaceSuggestion {
  if (isIncognitoProfile(profileId) || !space.pinned.some((n) => n.type === "folder")) return space;
  const urls: string[] = [];
  const links: BookmarkNode[] = [];
  const folders: { id: string; name: string; parent: string | null }[] = [];
  const layout: Layout[] = [];
  const walk = (nodes: BookmarkNode[], parent: string | null) => {
    const items: (string | number)[] = [];
    for (const n of nodes) {
      if (n.type === "folder") {
        const id = newId("pf");
        folders.push({ id, name: n.title || "Folder", parent });
        items.push(`f:${id}`);
        walk(n.children ?? [], id);
      } else if (n.url) {
        items.push(urls.length);
        urls.push(n.url);
        links.push(n);
      }
    }
    layout.push({ parent, items });
  };
  walk(space.pinned, null);
  planArcImport(profileId, { urls, layout }, folders);
  return { ...space, pinned: links };
}
