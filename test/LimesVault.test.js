const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LimesVault", function () {
  async function deployFixture() {
    const [owner, spender, stranger] = await ethers.getSigners();

    const MockUSD = await ethers.getContractFactory("MockUSD");
    const token = await MockUSD.deploy();

    const LimesVault = await ethers.getContractFactory("LimesVault");
    const vault = await LimesVault.deploy(owner.address, owner.address, 0);

    // Mint the owner some tokens and do the ONE approve() to LimesVault
    await token.mint(owner.address, ethers.parseEther("1000"));
    await token.connect(owner).approve(await vault.getAddress(), ethers.parseEther("1000"));

    return { owner, spender, stranger, token, vault };
  }

  it("grants a permission with the correct fields", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address,
      await token.getAddress(),
      ethers.parseEther("50"), // cap
      0, // one-shot, no recurring period
      expiry
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find((l) => l.fragment && l.fragment.name === "PermissionGranted");
    expect(event).to.not.be.undefined;

    const id = event.args.id;
    expect(await vault.remainingAllowance(id)).to.equal(ethers.parseEther("50"));
    expect(await vault.isActive(id)).to.equal(true);
  });

  it("lets the authorized spender pull within the cap", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await vault.connect(spender).pull(id, ethers.parseEther("20"));
    expect(await token.balanceOf(spender.address)).to.equal(ethers.parseEther("20"));
    expect(await vault.remainingAllowance(id)).to.equal(ethers.parseEther("30"));
  });

  it("REJECTS a pull that exceeds the cap", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await vault.connect(spender).pull(id, ethers.parseEther("40"));
    await expect(
      vault.connect(spender).pull(id, ethers.parseEther("20")) // 40 + 20 = 60 > 50 cap
    ).to.be.revertedWith("LimesVault: exceeds cap");
  });

  it("REJECTS a pull from anyone other than the authorized spender", async function () {
    const { owner, spender, stranger, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await expect(
      vault.connect(stranger).pull(id, ethers.parseEther("1"))
    ).to.be.revertedWith("LimesVault: not authorized spender");
  });

  it("REJECTS a pull after the permission has expired", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 100;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await time.increase(200); // jump past expiry

    await expect(
      vault.connect(spender).pull(id, ethers.parseEther("1"))
    ).to.be.revertedWith("LimesVault: expired");
    expect(await vault.remainingAllowance(id)).to.equal(0);
  });

  it("lets the owner revoke instantly, blocking all future pulls", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await vault.connect(owner).revoke(id);
    expect(await vault.isActive(id)).to.equal(false);

    await expect(
      vault.connect(spender).pull(id, ethers.parseEther("1"))
    ).to.be.revertedWith("LimesVault: revoked");
  });

  it("REJECTS revoke from anyone other than the owner", async function () {
    const { owner, spender, stranger, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await expect(
      vault.connect(stranger).revoke(id)
    ).to.be.revertedWith("LimesVault: not owner");
  });

  it("resets the spendable cap when a recurring period rolls over", async function () {
    const { owner, spender, token, vault } = await deployFixture();
    const expiry = (await time.latest()) + 10_000;
    const period = 1000; // seconds

    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("10"), period, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    // Spend the full cap for period 1
    await vault.connect(spender).pull(id, ethers.parseEther("10"));
    await expect(
      vault.connect(spender).pull(id, ethers.parseEther("1"))
    ).to.be.revertedWith("LimesVault: exceeds cap");

    // Jump into period 2
    await time.increase(period + 1);

    // Cap should have reset — this pull should now succeed
    await vault.connect(spender).pull(id, ethers.parseEther("10"));
    expect(await token.balanceOf(spender.address)).to.equal(ethers.parseEther("20"));
  });
});

it("deploys with a treasury, an initial fee, and enforces the fee ceiling", async function () {
    const [owner, treasury] = await ethers.getSigners();
    const LimesVault = await ethers.getContractFactory("LimesVault");

    await expect(
      LimesVault.deploy(owner.address, treasury.address, 501) // over MAX_FEE_BPS (500)
    ).to.be.revertedWith("LimesVault: fee exceeds ceiling");

    const vault = await LimesVault.deploy(owner.address, treasury.address, 25);
    expect(await vault.protocolFeeBps()).to.equal(25);
    expect(await vault.treasury()).to.equal(treasury.address);
  });

  it("takes the protocol fee out of a pull, and the fee counts against the FULL cap", async function () {
    const [owner, spender, treasury] = await ethers.getSigners();

    const MockUSD = await ethers.getContractFactory("MockUSD");
    const token = await MockUSD.deploy();
    await token.mint(owner.address, ethers.parseEther("1000"));

    const LimesVault = await ethers.getContractFactory("LimesVault");
    const vault = await LimesVault.deploy(owner.address, treasury.address, 500); // 5% fee, at the ceiling

    await token.connect(owner).approve(await vault.getAddress(), ethers.parseEther("1000"));

    const expiry = (await time.latest()) + 3600;
    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("100"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await vault.connect(spender).pull(id, ethers.parseEther("100")); // full cap in one pull

    // 5% of 100 = 5 to treasury, 95 to spender — but the FULL 100 counted against the cap
    expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseEther("5"));
    expect(await token.balanceOf(spender.address)).to.equal(ethers.parseEther("95"));
    expect(await vault.remainingAllowance(id)).to.equal(0); // cap fully consumed, not just the spender's share
  });

  it("REJECTS grantPermission and pull while paused, but revoke still works", async function () {
    const [owner, spender, treasury] = await ethers.getSigners();

    const MockUSD = await ethers.getContractFactory("MockUSD");
    const token = await MockUSD.deploy();
    await token.mint(owner.address, ethers.parseEther("1000"));

    const LimesVault = await ethers.getContractFactory("LimesVault");
    const vault = await LimesVault.deploy(owner.address, treasury.address, 0);

    await token.connect(owner).approve(await vault.getAddress(), ethers.parseEther("1000"));

    const expiry = (await time.latest()) + 3600;
    const tx = await vault.connect(owner).grantPermission(
      spender.address, await token.getAddress(), ethers.parseEther("50"), 0, expiry
    );
    const receipt = await tx.wait();
    const id = receipt.logs.find((l) => l.fragment?.name === "PermissionGranted").args.id;

    await vault.connect(owner).pause();

    await expect(
      vault.connect(spender).pull(id, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");

    await expect(
      vault.connect(owner).grantPermission(spender.address, await token.getAddress(), ethers.parseEther("1"), 0, expiry)
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");

    // revoke must ALWAYS work, paused or not — this is the safety-critical assertion
    await expect(vault.connect(owner).revoke(id)).to.not.be.reverted;
    expect(await vault.isActive(id)).to.equal(false);
  });

  it("REJECTS pause/fee/treasury changes from anyone but the owner", async function () {
    const [owner, spender, treasury, stranger] = await ethers.getSigners();
    const LimesVault = await ethers.getContractFactory("LimesVault");
    const vault = await LimesVault.deploy(owner.address, treasury.address, 0);

    await expect(vault.connect(stranger).pause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.connect(stranger).setProtocolFeeBps(10)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.connect(stranger).setTreasury(stranger.address)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });