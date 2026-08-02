import { BlockList, isIP } from "node:net";

function configurationError() {
  return new Error("ANALYTICS_EXCLUDED_IPS contains an invalid IP or CIDR.");
}

function normalizeIp(value) {
  const ip = typeof value === "string" ? value.trim() : "";
  return ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
}

function addAddress(blockList, address) {
  const version = isIP(address);
  if (!version) throw configurationError();
  blockList.addAddress(address, version === 6 ? "ipv6" : "ipv4");
}

function addConfiguredEntry(blockList, entry) {
  const parts = entry.split("/");
  if (parts.length === 1) {
    addAddress(blockList, entry);
    return;
  }
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) throw configurationError();
  const address = normalizeIp(parts[0]);
  const prefix = Number(parts[1]);
  if (isIP(address) !== 4 || prefix < 0 || prefix > 32) throw configurationError();
  blockList.addSubnet(address, prefix, "ipv4");
}

export function createAnalyticsExclusionList(raw = "") {
  const blockList = new BlockList();
  blockList.addSubnet("127.0.0.0", 8, "ipv4");
  blockList.addSubnet("10.0.0.0", 8, "ipv4");
  blockList.addSubnet("172.16.0.0", 12, "ipv4");
  blockList.addSubnet("192.168.0.0", 16, "ipv4");
  blockList.addAddress("::1", "ipv6");
  blockList.addSubnet("fc00::", 7, "ipv6");

  if (typeof raw !== "string") throw configurationError();
  raw.split(",").map((entry) => entry.trim()).filter(Boolean).forEach((entry) => addConfiguredEntry(blockList, entry));

  return {
    has(value) {
      const ip = normalizeIp(value);
      const version = isIP(ip);
      return Boolean(version) && blockList.check(ip, version === 6 ? "ipv6" : "ipv4");
    }
  };
}
