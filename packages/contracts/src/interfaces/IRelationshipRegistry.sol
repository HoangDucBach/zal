// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Invite, Relationship, Role} from "../lib/ZalTypes.sol";

interface IRelationshipRegistry {
    function getRelationship(uint256 id) external view returns (Relationship memory);
    function propose(address counterparty, Role proposerRole, uint64 expiresAt) external returns (uint256 id);
    function accept(uint256 id) external;
    function reject(uint256 id) external;
    function cancel(uint256 id) external;
    function acceptInvite(Invite calldata invite, bytes calldata signature) external returns (uint256 id);
}
