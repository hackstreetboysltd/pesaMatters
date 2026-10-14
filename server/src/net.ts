import dns from "node:dns";

/**
 * Prefer A records when both A and AAAA exist.
 * Node's default `verbatim` order often tries IPv6 first; broken local IPv6
 * then fails Google cert/token fetches as TypeError → google_network.
 */
dns.setDefaultResultOrder("ipv4first");
