import WebKit

enum NativeVideoFullscreen {
  static var userScript: WKUserScript {
    WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
  }

  static let source = """
    (() => {
      if (document.fullscreenEnabled === true) return;
      const D = Document.prototype;
      const E = Element.prototype;
      let element = null;
      let video = null;
      const area = (v) => {
        const r = v.getBoundingClientRect();
        return r.width * r.height;
      };
      const videoIn = (el) => {
        if (el instanceof HTMLVideoElement) return el;
        const videos = Array.from(el.querySelectorAll ? el.querySelectorAll("video") : []);
        const usable = videos.filter((v) => typeof v.webkitEnterFullscreen === "function");
        usable.sort((a, b) => (a.paused - b.paused) || (area(b) - area(a)));
        return usable[0] || null;
      };
      const announce = (next) => {
        const target = next || element;
        element = next;
        if (!target || !target.isConnected) {
          document.dispatchEvent(new Event("fullscreenchange"));
          document.dispatchEvent(new Event("webkitfullscreenchange"));
          return;
        }
        target.dispatchEvent(new Event("fullscreenchange", { bubbles: true, composed: true }));
        target.dispatchEvent(new Event("webkitfullscreenchange", { bubbles: true, composed: true }));
      };
      function request() {
        const target = this;
        const v = videoIn(target);
        if (!v) return Promise.reject(new TypeError("Fullscreen is not supported for this element"));
        try {
          v.webkitEnterFullscreen();
        } catch (error) {
          return Promise.reject(error);
        }
        video = v;
        const ended = () => {
          v.removeEventListener("webkitendfullscreen", ended);
          if (video !== v) return;
          video = null;
          announce(null);
        };
        v.addEventListener("webkitendfullscreen", ended);
        return new Promise((resolve) => setTimeout(() => {
          if (video === v) announce(target);
          resolve();
        }));
      }
      function exit() {
        const v = video;
        if (!v) return Promise.reject(new TypeError("Not in fullscreen"));
        video = null;
        try {
          v.webkitExitFullscreen();
        } catch (error) {}
        return new Promise((resolve) => setTimeout(() => {
          if (element) announce(null);
          resolve();
        }));
      }
      const getter = (proto, name, get) => {
        try {
          Object.defineProperty(proto, name, { get, configurable: true });
        } catch (error) {}
      };
      const method = (proto, name, value) => {
        try {
          Object.defineProperty(proto, name, { value, configurable: true, writable: true });
        } catch (error) {}
      };
      getter(D, "fullscreenEnabled", () => true);
      getter(D, "webkitFullscreenEnabled", () => true);
      getter(D, "fullscreenElement", () => element);
      getter(D, "webkitFullscreenElement", () => element);
      getter(D, "webkitCurrentFullScreenElement", () => element);
      getter(D, "fullscreen", () => element !== null);
      getter(D, "webkitIsFullScreen", () => element !== null);
      method(E, "requestFullscreen", request);
      method(E, "webkitRequestFullscreen", request);
      method(E, "webkitRequestFullScreen", request);
      method(D, "exitFullscreen", exit);
      method(D, "webkitExitFullscreen", exit);
      method(D, "webkitCancelFullScreen", exit);
    })();
    """
}
