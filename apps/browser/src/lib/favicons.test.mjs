import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { resolveFavicon, useFavicons } = await import("./favicons.ts");
const { DEFAULT_PROFILE_ID } = await import("../store/settings.ts");
const { engineProfile } = await import("../store/model.ts");

const calendar = "data:image/png;base64,calendar";
const news = "data:image/png;base64,news";

function seed() {
  useFavicons.setState({
    profiles: {
      [engineProfile(DEFAULT_PROFILE_ID)]: {
        pages: { "about:blank": calendar, "https://news.example/": news },
        srcs: { "https://news.example/favicon.ico": news },
        appearances: { "about:blank": [calendar, calendar] },
      },
    },
    themes: {},
  });
}

test("a tab on about:blank never shows an icon some other page left under that address", () => {
  seed();
  assert.equal(resolveFavicon("about:blank", null, DEFAULT_PROFILE_ID), null);
  assert.equal(resolveFavicon("about:blank#layout-edit", undefined, DEFAULT_PROFILE_ID), null);
});

test("a tab passing through about:blank keeps the icon of the page it is loading", () => {
  seed();
  assert.equal(resolveFavicon("about:blank", "https://news.example/favicon.ico", DEFAULT_PROFILE_ID)?.uri, news);
});

test("web pages still resolve their own icon", () => {
  seed();
  assert.equal(resolveFavicon("https://news.example/", null, DEFAULT_PROFILE_ID)?.uri, news);
});
