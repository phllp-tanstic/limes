// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LimesVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LimesSubscription
/// @notice A real (not mocked) example of a spender integrating with LimesVault: a
///         recurring-access subscription that can only ever pull exactly what the
///         user capped, never more, and never after expiry.
contract LimesSubscription {
    LimesVault public immutable limesVault;
    address public immutable treasury;
    uint256 public constant PRICE = 5 ether;
    uint256 public constant CYCLE = 30 days;

    mapping(address => uint256) public paidUntil;
    mapping(address => bytes32) public permissionOf;

    event Subscribed(address indexed subscriber, bytes32 permissionId);
    event Charged(address indexed subscriber, uint256 amount, uint256 paidUntil);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    constructor(address _limesVault, address _treasury) {
        limesVault = LimesVault(_limesVault);
        treasury = _treasury;
    }

    function subscribe(bytes32 permissionId) external {
        bytes32 existing = permissionOf[msg.sender];
        bool dueForNewCycle = block.timestamp >= paidUntil[msg.sender];
        bool oldPermissionDead = existing == bytes32(0) || !limesVault.isActive(existing);

        require(dueForNewCycle || oldPermissionDead, "LimesSubscription: still active");

        permissionOf[msg.sender] = permissionId;
        emit Subscribed(msg.sender, permissionId);
        _charge(msg.sender);
    }

    function chargeCycle(address subscriber) external {
        require(block.timestamp >= paidUntil[subscriber], "LimesSubscription: not due yet");
        _charge(subscriber);
    }

    function _charge(address subscriber) internal {
        bytes32 id = permissionOf[subscriber];
        require(id != bytes32(0), "LimesSubscription: no permission linked");

        limesVault.pull(id, PRICE);

        paidUntil[subscriber] = block.timestamp + CYCLE;
        emit Charged(subscriber, PRICE, paidUntil[subscriber]);
    }

    function hasAccess(address subscriber) external view returns (bool) {
        return block.timestamp <= paidUntil[subscriber];
    }

    /// @notice Sweep accumulated subscription revenue to the treasury. Anyone can call
    ///         this — funds only ever move to the fixed, immutable treasury address set
    ///         at deployment, so there's no privileged-caller risk to reason about.
    function withdraw(address token) external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "LimesSubscription: nothing to withdraw");
        require(IERC20(token).transfer(treasury, balance), "LimesSubscription: transfer failed");
        emit Withdrawn(token, treasury, balance);
    }
}