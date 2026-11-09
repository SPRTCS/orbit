import WebKit

@Observable
final class ContentBlocker {
  static let identifier = "orbit-trackers-2"

  static let blockedDomains: [String] = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com", "googletagservices.com",
    "googletagmanager.com", "adnxs.com", "adsrvr.org", "amazon-adsystem.com", "criteo.com", "criteo.net", "taboola.com",
    "outbrain.com", "zemanta.com", "scorecardresearch.com", "quantserve.com", "quantcount.com", "rubiconproject.com",
    "pubmatic.com", "openx.net", "casalemedia.com", "indexww.com", "moatads.com", "adform.net", "bidswitch.net",
    "smartadserver.com", "advertising.com", "adcolony.com", "applovin.com", "mopub.com", "zedo.com", "yieldmo.com",
    "sharethrough.com", "teads.tv", "3lift.com", "triplelift.com", "lijit.com", "sovrn.com", "media.net",
    "contextweb.com", "gumgum.com", "rlcdn.com", "bluekai.com", "krxd.net", "exelator.com", "demdex.net", "omtrdc.net",
    "2o7.net", "everesttech.net", "agkn.com", "mathtag.com", "turn.com", "tapad.com", "crwdcntrl.net",
    "adsymptotic.com", "hotjar.com", "mouseflow.com", "fullstory.com", "crazyegg.com", "luckyorange.com",
    "inspectlet.com", "clarity.ms", "mixpanel.com", "segment.io", "amplitude.com", "heapanalytics.com", "chartbeat.com",
    "chartbeat.net", "parsely.com", "nr-data.net", "adroll.com", "bat.bing.com", "ads.linkedin.com",
    "px.ads.linkedin.com", "snap.licdn.com", "analytics.twitter.com", "ads-twitter.com", "analytics.tiktok.com",
    "ads.tiktok.com", "sc-static.net", "tr.snapchat.com", "ct.pinterest.com", "mc.yandex.ru", "revcontent.com",
    "mgid.com", "popads.net", "propellerads.com", "adsterra.com", "exoclick.com", "juicyads.com", "trafficjunky.net",
    "onetag-sys.com", "id5-sync.com", "liveintent.com", "liadm.com", "adsafeprotected.com", "doubleverify.com",
    "flashtalking.com", "serving-sys.com", "innovid.com", "spotxchange.com", "spotx.tv", "springserve.com", "fwmrm.net",
    "smaato.net", "inmobi.com", "vungle.com", "unityads.unity3d.com", "appsflyer.com", "adjust.com", "kochava.com",
    "ioam.de", "emetriq.de", "adition.com", "yieldlab.net", "plista.com", "ligatus.com", "smartclip.net", "nuggad.net",
    "meetrics.net", "theadex.com",
  ]

  static let blockedPaths: [String] = ["facebook\\.com/tr[/?]"]

  static func urlFilter(forDomain domain: String) -> String {
    "^https?://([^/:]+\\.)?" + NSRegularExpression.escapedPattern(for: domain) + "[/:]"
  }

  static func rulesJSON(domains: [String] = blockedDomains, paths: [String] = blockedPaths) -> String {
    let filters = domains.map(urlFilter(forDomain:)) + paths.map { "^https?://([^/:]+\\.)?" + $0 }
    let rules: [[String: Any]] = filters.map {
      ["trigger": ["url-filter": $0, "load-type": ["third-party"]], "action": ["type": "block"]]
    }
    let data = (try? JSONSerialization.data(withJSONObject: rules)) ?? Data("[]".utf8)
    return String(decoding: data, as: UTF8.self)
  }

  private(set) var ruleList: WKContentRuleList?
  @ObservationIgnored var onReady: (() -> Void)?

  func load() {
    guard ruleList == nil else { return }
    Task { [weak self] in
      guard let store = WKContentRuleListStore.default() else { return }
      var list = try? await store.contentRuleList(forIdentifier: Self.identifier)
      if list == nil {
        list = try? await store.compileContentRuleList(
          forIdentifier: Self.identifier, encodedContentRuleList: Self.rulesJSON())
      }
      guard let self, let list else { return }
      self.ruleList = list
      self.onReady?()
    }
  }

  func apply(to controller: WKUserContentController, enabled: Bool) {
    guard let ruleList else { return }
    controller.remove(ruleList)
    if enabled { controller.add(ruleList) }
  }
}
