const hre = require("hardhat");

async function main() {
  const VAULT_ADDRESS = "0x4aE4CE692aaB16122de473D86918a4B5440A67a6"; // your existing LimesVault — unchanged

  const LimesSubscription = await hre.ethers.getContractFactory("LimesSubscription");
  const sub = await LimesSubscription.deploy(VAULT_ADDRESS);
  await sub.waitForDeployment();

  console.log("New LimesSubscription deployed to:", await sub.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});