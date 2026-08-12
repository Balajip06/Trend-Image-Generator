/**
 * Client-side device fingerprint for the anonymous trial gate.
 *
 * The raw FingerprintJS visitor id must never reach the server (see
 * app/api/generate-anonymous/route.ts) — only its SHA-256 hash is sent.
 * The FingerprintJS agent is memoized module-scope so `load()` only runs
 * once per page session.
 */

let agentPromise: ReturnType<typeof loadAgent> | null = null

async function loadAgent() {
  const FingerprintJS = await import('@fingerprintjs/fingerprintjs')
  return FingerprintJS.load()
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getFingerprintHash(): Promise<string> {
  if (!agentPromise) agentPromise = loadAgent()
  const agent = await agentPromise
  const result = await agent.get()
  return sha256Hex(result.visitorId)
}
