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
/** Ed25519 seed → X25519 private key (SHA-512 scalar clamped) */
export declare function ed25519PrivToX25519(privateKeyHex: string): Uint8Array;
/** Ed25519 compressed public key → X25519 Montgomery public key */
export declare function ed25519PubToX25519(publicKeyHex: string): Uint8Array;
export declare function encryptDM(senderPrivKeyHex: string, recipientPubKeyHex: string, plaintext: string): Promise<string>;
export declare function decryptDM(recipientPrivKeyHex: string, senderPubKeyHex: string, encoded: string): Promise<string>;
export declare function getX25519PubkeyHex(ed25519PubKeyHex: string): string;
