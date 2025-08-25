// src/scripts/make-atlas-uri.js
const dns = require('dns').promises;

(async () => {
  const CLUSTER = 'scenewebapp.xnu3tr1.mongodb.net';   // your cluster host
  const USER = 'Scenewebapp';
  const PASS = process.env.ATLAS_PASS || 'SAUD11Saud'; // change via env if you rotate
  const DB   = process.env.ATLAS_DB   || 'test';       // you said prod uses "test"

  try {
    // 1) SRV: get the 3 hosts
    const srv = await dns.resolveSrv(`_mongodb._tcp.${CLUSTER}`);
    const hosts = srv
      .sort((a,b) => a.priority - b.priority || a.weight - b.weight)
      .map(r => `${r.name}:${r.port || 27017}`);

    // 2) TXT: find replicaSet param
    const txt = await dns.resolveTxt(CLUSTER);
    const flat = txt.flat().join('');
    const rsMatch = flat.match(/replicaSet=([^&"]+)/i);
    const replicaSet = rsMatch ? rsMatch[1] : null;

    if (!hosts.length || !replicaSet) {
      console.error('Could not resolve hosts or replicaSet from DNS.');
      process.exit(1);
    }

    const uri = `mongodb://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${hosts.join(',')}/${DB}`
      + `?ssl=true&replicaSet=${encodeURIComponent(replicaSet)}&authSource=admin&retryWrites=true&w=majority&appName=Scenewebapp`;

    console.log('--- Standard (non-SRV) URI ---');
    console.log(uri);
  } catch (e) {
    console.error('Failed to build standard URI:', e.message);
    process.exit(1);
  }
})();
