/**
 * the-relay Direct Message encryption
 *
 * Scheme:
 *   1. Convert sender/recipient Ed25519 keys → X25519 (Curve25519)
 *      - Private: clamp(SHA-512(seed)[0:32])
 *      - Public:  birational map u = (1+y)/(1-y) mod p
 *   2. ECDH: shared_secret = X25519(our_priv, their_pub)
 *   3. Key derivation: AES key = HKDF-SHA256(shared_secret, "voicebox-dm-v1")
 *   4. Encrypt: AES-256-GCM(key, iv=random 12B, plaintext)
 *   5. Wire format: base64url(iv[12] || ciphertext+tag)
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha512.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
// ─── Key conversion ───────────────────────────────────────────────────────────
/** Ed25519 seed → X25519 private key (SHA-512 scalar clamped) */
export function ed25519PrivToX25519(privateKeyHex) {
    const seed = hexToBytes(privateKeyHex);
    const h = sha512(seed);
    const priv = h.slice(0, 32);
    priv[0] &= 248;
    priv[31] &= 127;
    priv[31] |= 64;
    return priv;
}
/** Ed25519 compressed public key → X25519 Montgomery public key */
export function ed25519PubToX25519(publicKeyHex) {
    const p = (1n << 255n) - 19n;
    const edBytes = hexToBytes(publicKeyHex);
    const yBytes = new Uint8Array(edBytes);
    yBytes[31] &= 0x7f;
    let y = 0n;
    for (let i = 31; i >= 0; i--)
        y = (y << 8n) | BigInt(yBytes[i]);
    const numer = mod(1n + y, p);
    const denom = mod(1n - y, p);
    const u = mod(numer * modInv(denom, p), p);
    const out = new Uint8Array(32);
    let tmp = u;
    for (let i = 0; i < 32; i++) {
        out[i] = Number(tmp & 0xffn);
        tmp >>= 8n;
    }
    return out;
}
function mod(a, m) { return ((a % m) + m) % m; }
function modInv(a, m) {
    let [old_r, r] = [a, m];
    let [old_s, s] = [1n, 0n];
    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }
    return mod(old_s, m);
}
// ─── ECDH + HKDF ─────────────────────────────────────────────────────────────
async function deriveAESKey(ourPrivKeyHex, theirPubKeyHex) {
    const ourX25519Priv = ed25519PrivToX25519(ourPrivKeyHex);
    const theirX25519Pub = ed25519PubToX25519(theirPubKeyHex);
    const sharedSecret = x25519.getSharedSecret(ourX25519Priv, theirX25519Pub);
    const keyMaterial = await crypto.subtle.importKey("raw", sharedSecret, { name: "HKDF" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("voicebox-dm-v1"),
        info: new Uint8Array(0),
    }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────
export async function encryptDM(senderPrivKeyHex, recipientPubKeyHex, plaintext) {
    const key = await deriveAESKey(senderPrivKeyHex, recipientPubKeyHex);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const out = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), iv.byteLength);
    return btoa(String.fromCharCode(...out))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
export async function decryptDM(recipientPrivKeyHex, senderPubKeyHex, encoded) {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    if (bytes.length < 13)
        throw new Error("DM ciphertext too short");
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const key = await deriveAESKey(recipientPrivKeyHex, senderPubKeyHex);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
}
// ─── X25519 pubkey helper ─────────────────────────────────────────────────────
export function getX25519PubkeyHex(ed25519PubKeyHex) {
    return bytesToHex(ed25519PubToX25519(ed25519PubKeyHex));
}
