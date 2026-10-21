/** The computer and browser a capture or benchmark ran on. */
export interface DeviceInfo {
  name: string;
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  hardwareConcurrency: number | null;
  /** GB, as the browser reports it (Chrome rounds and caps it at 8). */
  deviceMemory: number | null;
}

interface UAData {
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<{ platform?: string; platformVersion?: string; fullVersionList?: { brand: string; version: string }[] }>;
}

/**
 * Browser, OS and hardware details for a capture or benchmark. Uses the
 * User-Agent Client Hints API where the browser has it (Chrome, Edge), else
 * the user agent string.
 *
 * @param name a free-text device name (e.g. "MacBook Air M2, lab bench")
 */
export async function deviceInfo(name = ''): Promise<DeviceInfo> {
  const nav = globalThis.navigator as Navigator & { userAgentData?: UAData; deviceMemory?: number };
  const ua = nav?.userAgent ?? '';
  let browser = '', browserVersion = '', os = '', osVersion = '';
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['platformVersion', 'fullVersionList']);
    const brand = hints?.fullVersionList?.find(b => !/not.?a.?brand|chromium/i.test(b.brand)) ?? hints?.fullVersionList?.find(b => /chromium/i.test(b.brand));
    if (brand) { browser = brand.brand; browserVersion = brand.version; }
    os = hints?.platform ?? nav.userAgentData?.platform ?? '';
    osVersion = hints?.platformVersion ?? '';
  } catch { /* fall back to the user agent string */ }
  if (!browser) {
    const m = /(Edg|Chrome|Firefox|Version)\/([\d.]+)/.exec(ua);
    browser = m ? ({ Edg: 'Microsoft Edge', Chrome: 'Google Chrome', Firefox: 'Firefox', Version: 'Safari' } as Record<string, string>)[m[1]] : 'unknown';
    browserVersion = m?.[2] ?? '';
  }
  if (!os) os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown';
  return {
    name, userAgent: ua, browser, browserVersion, os, osVersion,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    deviceMemory: nav?.deviceMemory ?? null,
  };
}
