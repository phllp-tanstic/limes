const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LimesSubscription", function () {
  async function deployFixture() {
    const [owner, other, treasury] = await ethers.getSigners();

    const MockUSD = await ethers.getContractFactory("MockUSD");
    const token = await MockUSD.deploy();

    const LimesVault = await ethers.getContractFactory("LimesVault");
    const vault = await LimesVault.deploy(owner.address, owner.address, 0);

    const LimesSubscription = await ethers.getContractFactory("LimesSubscription");
    const sub = await LimesSubscription.deploy(await vault.getAddress(), treasury.address);

    await token.mint(owner.address, ethers.parseEther("1000"));
    await token.connect(owner).approve(await vault.getAddress(), ethers.parseEther("1000"));

    return { owner, other, treasury, token, vault, sub };
  }

  async function grantPermissionTo(vault, owner, spenderAddress, token, cap, period, expiry) {
    const tx = await vault.connect(owner).grantPermission(spenderAddress, await token.getAddress(), cap, period, expiry);
    const receipt = await tx.wait();
    return receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;
  }

  it("subscribes and charges the first cycle for exactly PRICE", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    expect(await token.balanceOf(await sub.getAddress())).to.equal(ethers.parseEther("5"));
    expect(await sub.hasAccess(owner.address)).to.equal(true);
  });

  it("REJECTS charging a new cycle before it's due", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    await expect(sub.chargeCycle(owner.address)).to.be.revertedWith("LimesSubscription: not due yet");
  });

  it("charges the next cycle once it's due, still gated by the same cap", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 60 * 24 * 60 * 60;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    await time.increase(30 * 24 * 60 * 60 + 1);

    await sub.chargeCycle(owner.address);
    expect(await token.balanceOf(await sub.getAddress())).to.equal(ethers.parseEther("10"));
  });

  it("REJECTS charging once the user's capped budget runs out", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 60 * 24 * 60 * 60;
    const cap = ethers.parseEther("5");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    await time.increase(30 * 24 * 60 * 60 + 1);

    await expect(sub.chargeCycle(owner.address)).to.be.revertedWith("LimesVault: exceeds cap");
  });

  it("REJECTS charging once the user has revoked the permission mid-subscription", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    await vault.connect(owner).revoke(id);
    await time.increase(30 * 24 * 60 * 60 + 1);

    await expect(sub.chargeCycle(owner.address)).to.be.revertedWith("LimesVault: revoked");
  });

  it("REJECTS a second subscribe() call while the current permission is still active and not due", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id);

    await expect(sub.connect(owner).subscribe(id)).to.be.revertedWith("LimesSubscription: still active");
    expect(await token.balanceOf(await sub.getAddress())).to.equal(ethers.parseEther("5")); // only ONE charge landed
  });

  it("ALLOWS resubscribing with a new permission immediately after revoke", async function () {
    const { owner, token, vault, sub } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const firstId = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(firstId);

    await vault.connect(owner).revoke(firstId);

    const secondId = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(secondId); // should succeed, not revert

    expect(await token.balanceOf(await sub.getAddress())).to.equal(ethers.parseEther("10")); // two charges total
  });

  it("lets anyone trigger withdraw(), sweeping the full balance to the fixed treasury", async function () {
    const { owner, token, vault, sub, treasury, other } = await deployFixture();
    const expiry = (await time.latest()) + 100_000;
    const cap = ethers.parseEther("100");

    const id = await grantPermissionTo(vault, owner, await sub.getAddress(), token, cap, 0, expiry);
    await sub.connect(owner).subscribe(id); // 5 mUSD now sitting in the subscription contract

    await sub.connect(other).withdraw(await token.getAddress()); // ANYONE can call it...

    expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseEther("5")); // ...but funds only ever land at treasury
    expect(await token.balanceOf(await sub.getAddress())).to.equal(0);
  });

  it("REJECTS withdraw() when there is nothing to withdraw", async function () {
    const { sub, token } = await deployFixture();
    await expect(sub.withdraw(await token.getAddress())).to.be.revertedWith("LimesSubscription: nothing to withdraw");
  });
});