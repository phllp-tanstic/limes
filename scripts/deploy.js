const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "MON");

  // Using the deployer as both owner and treasury for now — swap TREASURY_ADDRESS
  // for a real multisig before mainnet.
  const OWNER_ADDRESS = deployer.address;
  const TREASURY_ADDRESS = deployer.address;
  const INITIAL_FEE_BPS = 0; // start at 0% while in beta, raise later via setProtocolFeeBps()

  const MockUSD = await hre.ethers.getContractFactory("MockUSD");
  const token = await MockUSD.deploy();
  await token.waitForDeployment();
  console.log("MockUSD deployed to:", await token.getAddress());

  const LimesVault = await hre.ethers.getContractFactory("LimesVault");
  const vault = await LimesVault.deploy(OWNER_ADDRESS, TREASURY_ADDRESS, INITIAL_FEE_BPS);
  await vault.waitForDeployment();
  console.log("LimesVault deployed to:", await vault.getAddress());

  const LimesSubscription = await hre.ethers.getContractFactory("LimesSubscription");
  const sub = await LimesSubscription.deploy(await vault.getAddress(), TREASURY_ADDRESS);
  await sub.waitForDeployment();
  console.log("LimesSubscription deployed to:", await sub.getAddress());

  console.log("\n--- Save these addresses ---");
  console.log(JSON.stringify({
    mockUSD: await token.getAddress(),
    limesVault: await vault.getAddress(),
    limesSubscription: await sub.getAddress(),
    owner: OWNER_ADDRESS,
    treasury: TREASURY_ADDRESS,
    network: hre.network.name,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});