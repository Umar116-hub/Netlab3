import sodium from 'libsodium-wrappers';
let ready = false;
export const initCrypto = async () => {
    if (!ready) {
        await sodium.ready;
        ready = true;
    }
};
/**
 * Generates an Identity Key Pair (X25519)
 */
export const generateIdentityKeyPair = () => {
    if (!ready)
        throw new Error("libsodium not ready");
    return sodium.crypto_box_keypair();
};
/**
 * Generates a Prekey Pair (X25519)
 */
export const generatePrekeyPair = () => {
    if (!ready)
        throw new Error("libsodium not ready");
    return sodium.crypto_box_keypair();
};
/**
 * Sign a piece of data using the Ed25519 secret key
 */
export const signData = (data, privateKey) => {
    if (!ready)
        throw new Error("libsodium not ready");
    return sodium.crypto_sign_detached(data, privateKey);
};
/**
 * Verify a signature using the Ed25519 public key
 */
export const verifySignature = (signature, data, publicKey) => {
    if (!ready)
        throw new Error("libsodium not ready");
    return sodium.crypto_sign_verify_detached(signature, data, publicKey);
};
/**
 * Encrypt a message from sender to recipient (Authenticated Encryption)
 */
export const encryptMessage = (message, recipientPublicKey, senderPrivateKey) => {
    if (!ready)
        throw new Error("libsodium not ready");
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const ciphertext = sodium.crypto_box_easy(message, nonce, recipientPublicKey, senderPrivateKey);
    return { nonce, ciphertext };
};
/**
 * Decrypt a message from sender
 */
export const decryptMessage = (nonce, ciphertext, senderPublicKey, recipientPrivateKey) => {
    if (!ready)
        throw new Error("libsodium not ready");
    const decrypted = sodium.crypto_box_open_easy(ciphertext, nonce, senderPublicKey, recipientPrivateKey);
    return sodium.to_string(decrypted);
};
