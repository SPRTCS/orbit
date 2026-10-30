#import "OrbitAirTraffic.h"

BOOL OrbitAirTrafficRoutesLinks(NSString *dataDirectory) {
  NSData *data = dataDirectory ? [NSData dataWithContentsOfFile:[dataDirectory stringByAppendingPathComponent:@"air-traffic.json"]] : nil;
  NSDictionary *saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![saved isKindOfClass:NSDictionary.class] || ![saved[@"version"] isEqual:@1]) return NO;
  if ([saved[@"fallback"] isKindOfClass:NSDictionary.class]) return YES;
  for (NSDictionary *rule in [saved[@"rules"] isKindOfClass:NSArray.class] ? saved[@"rules"] : @[])
    if ([rule isKindOfClass:NSDictionary.class] && ![rule[@"enabled"] isEqual:@NO]) return YES;
  return NO;
}
