import forge from 'node-forge';
import fs from 'fs';
import path from 'path';

function generateCert() {
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'netlab-lan' },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'California' },
    { name: 'localityName', value: 'Mountain View' },
    { name: 'organizationName', value: 'NetLab' },
    { shortName: 'OU', value: 'LAN' }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const pem = {
    key: pki.privateKeyToPem(keys.privateKey),
    cert: pki.certificateToPem(cert)
  };

  const certDir = path.join(process.cwd(), 'certs');
  fs.writeFileSync(path.join(certDir, 'key.pem'), pem.key);
  fs.writeFileSync(path.join(certDir, 'cert.pem'), pem.cert);

  console.log('Self-signed certificate generated successfully in ./certs/');
}

generateCert();
