// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title LimesVault
/// @notice A non-custodial permission gateway that replaces unlimited, indefinite
///         ERC-20 approvals with capped, time-boxed, revocable spending permissions.
///         The wallet owner does ONE approve() to LimesVault instead of approving
///         every dApp directly, then grants scoped sub-permissions per spender: a
///         hard cap, an optional recurring period, and a hard expiry. LimesVault
///         never custodies funds — it only gatekeeps transferFrom against those
///         rules, and any permission can be revoked instantly, even while paused.
contract LimesVault is ReentrancyGuard, Ownable, Pausable {
    struct Permission {
        address owner;
        address spender;
        address token;
        uint256 cap;
        uint256 period;
        uint256 spent;
        uint256 periodStart;
        uint256 expiry;
        bool revoked;
    }

    /// @notice Absolute ceiling on the protocol fee, hardcoded and never adjustable —
    ///         the owner can set any fee up to this cap, but can never raise the
    ///         ceiling itself. 500 = 5.00%.
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Current protocol fee, in basis points, taken out of every pull().
    uint256 public protocolFeeBps;

    /// @notice Where the protocol fee goes. Adjustable by the owner.
    address public treasury;

    mapping(bytes32 => Permission) public permissions;
    mapping(address => bytes32[]) private _ownerPermissions;

    event PermissionGranted(
        bytes32 indexed id,
        address indexed owner,
        address indexed spender,
        address token,
        uint256 cap,
        uint256 period,
        uint256 expiry
    );
    event PermissionRevoked(bytes32 indexed id, address indexed owner);
    event Pulled(bytes32 indexed id, address indexed spender, uint256 amount, uint256 fee, uint256 newSpent);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event TreasuryUpdated(address newTreasury);

    constructor(address initialOwner, address _treasury, uint256 _initialFeeBps)
        Ownable(initialOwner)
    {
        require(_treasury != address(0), "LimesVault: bad treasury");
        require(_initialFeeBps <= MAX_FEE_BPS, "LimesVault: fee exceeds ceiling");
        treasury = _treasury;
        protocolFeeBps = _initialFeeBps;
    }

    // --- Owner controls -----------------------------------------------------

    function setProtocolFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "LimesVault: fee exceeds ceiling");
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "LimesVault: bad treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /// @notice Freezes new permissions and new pulls in an incident. Does NOT block
    ///         revoke() — users must always be able to protect themselves, paused or not.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Core -----------------------------------------------------------------

    function grantPermission(
        address spender,
        address token,
        uint256 cap,
        uint256 period,
        uint256 expiry
    ) external whenNotPaused returns (bytes32 id) {
        require(spender != address(0), "LimesVault: bad spender");
        require(token != address(0), "LimesVault: bad token");
        require(cap > 0, "LimesVault: cap must be > 0");
        require(expiry > block.timestamp, "LimesVault: expiry must be in the future");

        id = keccak256(
            abi.encodePacked(msg.sender, spender, token, block.timestamp, _ownerPermissions[msg.sender].length)
        );

        permissions[id] = Permission({
            owner: msg.sender,
            spender: spender,
            token: token,
            cap: cap,
            period: period,
            spent: 0,
            periodStart: block.timestamp,
            expiry: expiry,
            revoked: false
        });

        _ownerPermissions[msg.sender].push(id);

        emit PermissionGranted(id, msg.sender, spender, token, cap, period, expiry);
    }

    /// @notice Always callable, regardless of pause state — the kill switch must never
    ///         itself be switchable off by anyone but the permission's own owner.
    function revoke(bytes32 id) external {
        Permission storage p = permissions[id];
        require(p.owner == msg.sender, "LimesVault: not owner");
        require(!p.revoked, "LimesVault: already revoked");
        p.revoked = true;
        emit PermissionRevoked(id, msg.sender);
    }

    /// @notice Called by an authorized spender to pull payment within its granted cap.
    ///         The FULL amount counts against the owner's cap and is what leaves their
    ///         wallet — the cap is always an honest "maximum exposure" number regardless
    ///         of fee. The protocol fee is carved out of that amount before the spender
    ///         receives the remainder; the spender never receives more than amount - fee.
    function pull(bytes32 id, uint256 amount) external nonReentrant whenNotPaused {
        Permission storage p = permissions[id];
        require(p.spender == msg.sender, "LimesVault: not authorized spender");
        require(!p.revoked, "LimesVault: revoked");
        require(block.timestamp <= p.expiry, "LimesVault: expired");

        if (p.period > 0 && block.timestamp >= p.periodStart + p.period) {
            uint256 periodsElapsed = (block.timestamp - p.periodStart) / p.period;
            p.periodStart += periodsElapsed * p.period;
            p.spent = 0;
        }

        require(p.spent + amount <= p.cap, "LimesVault: exceeds cap");
        p.spent += amount;

        uint256 fee = (amount * protocolFeeBps) / 10_000;
        uint256 toSpender = amount - fee;

        emit Pulled(id, msg.sender, amount, fee, p.spent);

        require(IERC20(p.token).transferFrom(p.owner, p.spender, toSpender), "LimesVault: transfer failed");
        if (fee > 0) {
            require(IERC20(p.token).transferFrom(p.owner, treasury, fee), "LimesVault: fee transfer failed");
        }
    }

    // --- Views ------------------------------------------------------------------

    function getOwnerPermissions(address owner) external view returns (bytes32[] memory) {
        return _ownerPermissions[owner];
    }

    function remainingAllowance(bytes32 id) external view returns (uint256) {
        Permission memory p = permissions[id];
        if (p.revoked || block.timestamp > p.expiry) return 0;
        uint256 spent = p.spent;
        if (p.period > 0 && block.timestamp >= p.periodStart + p.period) {
            spent = 0;
        }
        return p.cap > spent ? p.cap - spent : 0;
    }

    function isActive(bytes32 id) external view returns (bool) {
        Permission memory p = permissions[id];
        return !p.revoked && block.timestamp <= p.expiry;
    }
}