const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const c = await hre.ethers.deployContract("VitaLedger");
  await c.waitForDeployment();
  const address = await c.getAddress();
  const deployBlock = (await c.deploymentTransaction().wait()).blockNumber;
  const { abi } = await hre.artifacts.readArtifact("VitaLedger");
  const out = JSON.stringify({ address, deployBlock, abi }, null, 2);
  for (const p of ["frontend/src/contract.json", "backend/contract.json"]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, out);
  }
  console.log(`VitaLedger deployed to ${address} (block ${deployBlock})`);
  console.log("Admin (deployer) wallet:", (await hre.ethers.getSigners())[0].address);
  console.log("Wrote frontend/src/contract.json and backend/contract.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
