import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const rules = await import("./rules.ts");
const { useBrowser } = await import("../../store/browser.ts");
const { planFlights } = await import("./flights.ts");
const store = await import("./store.ts");
const shell = await import("@ardia/shell");

const S = () => useBrowser.getState();
S().hydrate({
  profiles: {
    default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
    work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
  },
  profileOrder: ["default", "work"],
  windows: {},
  tabs: {},
});

const rule = (id, match, pattern, destination, extra = {}) => ({ id, enabled: true, match, pattern, fromApp: null, destination, ...extra });
const work = { kind: "space", spaceId: "work" };
const little = { kind: "little" };
const current = { kind: "current" };
const every = () => true;

test("domain rules match the domain and its subdomains, never look-alikes", () => {
  assert.equal(rules.patternMatches("domain", "github.com", "https://github.com/a"), true);
  assert.equal(rules.patternMatches("domain", "github.com", "https://gist.github.com/x"), true);
  assert.equal(rules.patternMatches("domain", "github.com", "https://GitHub.com./x"), true);
  assert.equal(rules.patternMatches("domain", "github.com", "https://notgithub.com/"), false);
  assert.equal(rules.patternMatches("domain", "github.com", "https://github.com.evil.io/"), false);
  assert.equal(rules.patternMatches("domain", "github.com", "https://evil.io/?u=github.com"), false);
  assert.equal(rules.patternMatches("domain", "github.com", "https://user:pw@github.com:8443/"), true);
  assert.equal(rules.patternMatches("domain", "github.com", "mailto:me@github.com"), false);
});

test("contains is case-insensitive; globs match the whole URL with or without the scheme", () => {
  assert.equal(rules.patternMatches("contains", "/Pull/", "https://github.com/o/r/pull/3"), true);
  assert.equal(rules.patternMatches("contains", "zoom", "https://example.com"), false);
  assert.equal(rules.patternMatches("glob", "*.atlassian.net/browse/*", "https://acme.atlassian.net/browse/OR-1"), true);
  assert.equal(rules.patternMatches("glob", "https://*.atlassian.net/*", "https://acme.atlassian.net/wiki"), true);
  assert.equal(rules.patternMatches("glob", "*.atlassian.net/browse/*", "https://acme.atlassian.net/wiki"), false);
  assert.equal(rules.patternMatches("glob", "docs.google.com/*", "https://docs.google.com/d/1"), true);
  assert.equal(rules.patternMatches("glob", "a.b(c)+?", "a.b(c)+?"), true);
  assert.equal(rules.patternMatches("glob", "a.b", "axb"), false);
});

test("patterns are normalized: domains from URLs, www and wildcards stripped, junk refused", () => {
  assert.equal(rules.normalizePattern("domain", "https://www.GitHub.com/orbit"), "github.com");
  assert.equal(rules.normalizePattern("domain", "*.figma.com"), "figma.com");
  assert.equal(rules.normalizePattern("domain", "bücher.de"), "xn--bcher-kva.de");
  assert.equal(rules.normalizePattern("domain", "exa mple.com"), null);
  assert.equal(rules.normalizePattern("contains", "   "), null);
  assert.equal(rules.normalizePattern("glob", " *.x.com/* "), "*.x.com/*");
  assert.equal(rules.normalizeBundleId(" com.tinyspeck.slackmacgap "), "com.tinyspeck.slackmacgap");
  assert.equal(rules.normalizeBundleId("not a bundle"), null);
});

test("first enabled match wins; from-app narrows a rule; disabled and deleted-space rules are skipped", () => {
  const list = [
    rule("off", "domain", "github.com", little, { enabled: false }),
    rule("slack", "domain", "github.com", little, { fromApp: "com.tinyspeck.slackmacgap" }),
    rule("gone", "domain", "github.com", { kind: "space", spaceId: "deleted" }),
    rule("gh", "domain", "github.com", work),
    rule("all", "glob", "*", current),
  ];
  const exists = (id) => id === "work";
  assert.equal(rules.matchingRule(list, "https://github.com/x", null, exists)?.id, "gh");
  assert.equal(rules.matchingRule(list, "https://github.com/x", "com.tinyspeck.slackmacgap", exists)?.id, "slack");
  assert.equal(rules.matchingRule(list, "https://github.com/x", "com.apple.mail", exists)?.id, "gh");
  assert.equal(rules.matchingRule(list, "https://example.com", null, exists)?.id, "all");
});

test("unmatched links take the fallback, or the default place when it's unset or its space is gone", () => {
  const config = { rules: [rule("gh", "domain", "github.com", work)], fallback: little };
  assert.deepEqual(rules.clearance(config, "https://example.com", null, every), { destination: little, ruleId: null });
  assert.deepEqual(rules.clearance(config, "https://github.com", null, every), { destination: work, ruleId: "gh" });
  assert.deepEqual(rules.clearance({ ...config, fallback: null }, "https://example.com", null, every), { destination: null, ruleId: null });
  assert.deepEqual(rules.clearance({ ...config, fallback: work }, "https://example.com", null, () => false), { destination: null, ruleId: null });
});

test("the saved file is read defensively and round-trips", () => {
  const config = {
    rules: [rule("a", "domain", "github.com", work), rule("b", "contains", "/pull/", little, { enabled: false, fromApp: "com.apple.mail" })],
    fallback: current,
  };
  assert.deepEqual(rules.readAirTraffic(rules.serializeAirTraffic(config)), config);
  assert.deepEqual(rules.readAirTraffic("{"), rules.EMPTY_AIR_TRAFFIC);
  assert.deepEqual(rules.readAirTraffic(JSON.stringify({ version: 99, rules: config.rules })), rules.EMPTY_AIR_TRAFFIC);
  const messy = JSON.stringify({
    version: 1,
    rules: [rule("a", "domain", "WWW.GitHub.com", work), rule("a", "domain", "dup.com", work), rule("c", "regex", ".*", work), rule("d", "domain", "x.com", { kind: "space" }), { id: "e" }],
    fallback: { kind: "nowhere" },
  });
  assert.deepEqual(rules.readAirTraffic(messy), { rules: [rule("a", "domain", "github.com", work)], fallback: null });
});

test("rules move within bounds", () => {
  const list = ["a", "b", "c"].map((id) => rule(id, "contains", id, current));
  assert.deepEqual(rules.moveRule(list, "c", 0).map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(rules.moveRule(list, "a", 9).map((r) => r.id), ["b", "c", "a"]);
  assert.equal(rules.moveRule(list, "b", 1), list);
  assert.equal(rules.moveRule(list, "zz", 0), list);
});

test("no rules: one flight, exactly what the links did before", () => {
  const routed = { profileId: null, adoptIds: [undefined, undefined] };
  assert.deepEqual(planFlights(rules.EMPTY_AIR_TRAFFIC, ["https://a.com", "https://b.com"], routed), [{ urls: ["https://a.com", "https://b.com"], routed }]);
});

test("links split into flights by destination, in order; Little Orbit gets one window per link", () => {
  const config = { rules: [rule("gh", "domain", "github.com", work), rule("fig", "domain", "figma.com", little)], fallback: null };
  const urls = ["https://github.com/1", "https://github.com/2", "https://figma.com/a", "https://figma.com/b", "https://example.com"];
  const flights = planFlights(config, urls, { profileId: null, adoptIds: urls.map(() => undefined) });
  assert.deepEqual(
    flights.map((f) => [f.urls, f.routed.profileId, f.little]),
    [
      [["https://github.com/1", "https://github.com/2"], "work", false],
      [["https://figma.com/a"], null, true],
      [["https://figma.com/b"], null, true],
      [["https://example.com"], null, undefined],
    ],
  );
});

test("a page native already opened is adopted only when the destination shares its engine profile", () => {
  const config = { rules: [rule("gh", "domain", "github.com", work), rule("cur", "domain", "example.com", current)], fallback: null };
  const parked = { profileId: "default", adoptIds: ["link:0", "link:1"] };
  const flights = planFlights(config, ["https://github.com", "https://example.com"], parked);
  assert.deepEqual(flights[0].routed, { profileId: "work", adoptIds: [undefined] });
  assert.deepEqual(flights[1].routed, { profileId: "default", adoptIds: ["link:1"] });
  const intoWork = planFlights(config, ["https://github.com"], { profileId: "work", adoptIds: ["link:0"] });
  assert.deepEqual(intoWork[0].routed, { profileId: "work", adoptIds: ["link:0"] });
});

test("rules for deleted spaces fall through to the next rule", () => {
  const config = { rules: [rule("gone", "domain", "github.com", { kind: "space", spaceId: "nope" }), rule("gh", "domain", "github.com", little)], fallback: null };
  const [flight] = planFlights(config, ["https://github.com"], { profileId: null, adoptIds: [undefined] });
  assert.equal(flight.little, true);
});

test("the current space is the one in front when the links arrive, even after an earlier flight switches spaces", () => {
  const config = { rules: [rule("gh", "domain", "github.com", work)], fallback: current };
  const flights = planFlights(config, ["https://github.com", "https://example.com"], { profileId: null, adoptIds: [undefined, undefined] }, null, "default");
  assert.deepEqual(flights.map((f) => f.routed.profileId), ["work", "default"]);
});

test("the store saves air-traffic.json and 'Always open in this Space' replaces the site's other plain rule", () => {
  store.resetAirTrafficForTests();
  const id = store.addRule({ match: "domain", pattern: "https://www.github.com/x", fromApp: "", destination: little });
  assert.ok(id);
  assert.equal(store.airTrafficConfig().rules[0].pattern, "github.com");
  assert.equal(store.airTrafficRoutesLinks(), true);
  assert.equal(store.toggleSiteRule("github.com", "work"), "added");
  assert.deepEqual(
    store.airTrafficConfig().rules.map((r) => [r.pattern, r.destination]),
    [["github.com", work]],
  );
  const saved = rules.readAirTraffic(shell.readDocument(store.AIR_TRAFFIC_FILE));
  assert.deepEqual(saved.rules.map((r) => r.pattern), ["github.com"]);
  assert.equal(store.toggleSiteRule("github.com", "work"), "removed");
  assert.equal(store.airTrafficRoutesLinks(), false);
  assert.equal(store.addRule({ match: "domain", pattern: "  ", fromApp: null, destination: work }), null);
  store.setFallback(current);
  assert.equal(store.airTrafficRoutesLinks(), true);
  store.resetAirTrafficForTests();
});

test("site rules come from http(s) pages only", () => {
  assert.equal(rules.siteDomain("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(rules.siteDomain("http://localhost:3000/"), "localhost");
  assert.equal(rules.siteDomain("ardia://newtab"), null);
  assert.equal(rules.siteDomain("file:///Users/x"), null);
});
