export const SHARED_SUFFIXES = [
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "ltd.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "co.kr",
  "or.kr",
  "com.br",
  "net.br",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.mx",
  "co.in",
  "net.in",
  "org.in",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.za",
  "com.ar",
  "co.il",
  "com.my",
  "com.ph",
  "com.vn",
  "co.id",
  "co.th",
  "com.ua",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "herokuapp.com",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
];

const suffixes = new Set(SHARED_SUFFIXES);

export function siteOfHost(given: string): string {
  const host = given.toLowerCase().replace(/\.+$/, "");
  if (!host || host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  return labels.slice(suffixes.has(labels.slice(-2).join(".")) ? -3 : -2).join(".");
}

export function siteOf(url: string): string {
  const host = url.match(/^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i)?.[1];
  return host ? siteOfHost(host) : "";
}

export const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export type PeekLinkConfig = { sites: string[] | null; shift: boolean };
export type PeekLinkAnswer = { url: string; shift: boolean } | { replaced: true } | null;

export const PEEK_SITE_SOURCE = `(suffixes) => (given) => {
  const host = String(given).toLowerCase().replace(/\\.+$/, "");
  if (!host || host.startsWith("[") || /^\\d+(\\.\\d+){3}$/.test(host)) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  return labels.slice(suffixes.includes(labels.slice(-2).join(".")) ? -3 : -2).join(".");
}`;

export function peekLinkScript(config: PeekLinkConfig, signal: string): string {
  return `const config = ${JSON.stringify(config)};
const signal = ${JSON.stringify(signal)};
const siteOf = (${PEEK_SITE_SOURCE})(${JSON.stringify(SHARED_SUFFIXES)});
const isLink = (n) => (n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) && n.hasAttribute("href");
dispatchEvent(new Event(signal));
let done = false;
const finish = (value) => {
  if (done) return;
  done = true;
  removeEventListener("click", onClick, false);
  removeEventListener(signal, onSignal, false);
  post("result", JSON.stringify(value));
};
const onSignal = () => finish({ replaced: true });
const onClick = (e) => {
  if (done || !e.isTrusted || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey) return;
  const link = e.composedPath().find(isLink);
  if (!link || link.hasAttribute("download") || !/^https?:$/.test(link.protocol)) return;
  const shift = e.shiftKey;
  if (shift ? !config.shift : !config.sites || config.sites.includes(siteOf(link.hostname))) return;
  e.preventDefault();
  finish({ url: link.href, shift });
};
addEventListener(signal, onSignal, false);
addEventListener("click", onClick, false);`;
}
