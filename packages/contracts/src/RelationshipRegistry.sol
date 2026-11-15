// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ICanvasAccount} from "./interfaces/ICanvasAccount.sol";
import {IRelationshipRegistry} from "./interfaces/IRelationshipRegistry.sol";
import {IZalFactory} from "./interfaces/IZalFactory.sol";
import {Invite, MemberRole, Relationship, RelStatus, Role} from "./lib/ZalTypes.sol";

/// @dev Buyer and seller relationships between two CanvasAccounts. `msg.sender` is always the acting account,
/// never a member wallet. An Active relationship has no end state in v1.
contract RelationshipRegistry is IRelationshipRegistry, EIP712 {
    bytes32 public constant INVITE_TYPEHASH =
        keccak256("Invite(address proposer,uint8 proposerRole,bytes32 inviteeEmailHash,uint256 nonce,uint64 deadline)");

    IZalFactory public immutable factory;

    uint256 public relationshipCount;
    mapping(uint256 id => Relationship) private _relationships;
    /// @dev The one Proposed or Active relationship for a (buyer, seller) direction, or 0 (ZR-REL-01).
    mapping(address buyer => mapping(address seller => uint256 id)) public liveRelationship;
    mapping(address proposer => mapping(uint256 nonce => bool)) public inviteNonceUsed;

    event RelationshipProposed(
        uint256 indexed id, address indexed buyer, address indexed seller, address proposer, uint64 expiresAt
    );
    event RelationshipAccepted(uint256 indexed id, address indexed buyer, address indexed seller);
    event RelationshipRejected(uint256 indexed id, address indexed buyer, address indexed seller);
    event RelationshipCancelled(uint256 indexed id, address indexed buyer, address indexed seller);

    error NotAccount(address account);
    error SelfRelationship();
    error ExpiryInPast();
    error RelationshipExists(uint256 id);
    error NotProposed(uint256 id);
    error ProposalExpired(uint256 id);
    error NotCounterparty();
    error NotProposer();
    error InviteExpired();
    error InviteNonceUsed();
    error InviteSignerNotAdmin(address signer);

    constructor(IZalFactory factory_) EIP712("Zal RelationshipRegistry", "1") {
        factory = factory_;
    }

    function getRelationship(uint256 id) external view returns (Relationship memory) {
        return _relationships[id];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashInvite(Invite calldata invite) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INVITE_TYPEHASH,
                    invite.proposer,
                    invite.proposerRole,
                    invite.inviteeEmailHash,
                    invite.nonce,
                    invite.deadline
                )
            )
        );
    }

    /// @dev ZR-REL-01. `expiresAt` 0 means the proposal never expires.
    function propose(address counterparty, Role proposerRole, uint64 expiresAt) external returns (uint256 id) {
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert ExpiryInPast();
        id = _create(msg.sender, counterparty, proposerRole, expiresAt, RelStatus.Proposed);
    }

    /// @dev ZR-REL-02.
    function accept(uint256 id) external {
        Relationship storage rel = _pendingForCounterparty(id);
        rel.status = RelStatus.Active;
        emit RelationshipAccepted(id, rel.buyer, rel.seller);
    }

    /// @dev ZR-REL-02.
    function reject(uint256 id) external {
        Relationship storage rel = _pendingForCounterparty(id);
        rel.status = RelStatus.Rejected;
        delete liveRelationship[rel.buyer][rel.seller];
        emit RelationshipRejected(id, rel.buyer, rel.seller);
    }

    /// @dev The proposer may cancel after expiry too, which is how an expired proposal is cleared.
    function cancel(uint256 id) external {
        Relationship storage rel = _relationships[id];
        if (rel.status != RelStatus.Proposed) revert NotProposed(id);
        if (msg.sender != rel.proposer) revert NotProposer();
        rel.status = RelStatus.Cancelled;
        delete liveRelationship[rel.buyer][rel.seller];
        emit RelationshipCancelled(id, rel.buyer, rel.seller);
    }

    /// @dev ZR-REL-03. The invite names no invitee, so whoever holds the signed link redeems it. The signer must
    /// be an Admin of the proposer at redemption time, so removing that Admin voids their unredeemed invites.
    function acceptInvite(Invite calldata invite, bytes calldata signature) external returns (uint256 id) {
        if (block.timestamp > invite.deadline) revert InviteExpired();
        if (inviteNonceUsed[invite.proposer][invite.nonce]) revert InviteNonceUsed();
        inviteNonceUsed[invite.proposer][invite.nonce] = true;

        // The account check comes before `roleOf`, so the call below only ever reaches a factory clone.
        if (!factory.isAccount(invite.proposer)) revert NotAccount(invite.proposer);
        address signer = ECDSA.recover(hashInvite(invite), signature);
        if (ICanvasAccount(invite.proposer).roleOf(signer) != MemberRole.Admin) revert InviteSignerNotAdmin(signer);

        id = _create(invite.proposer, msg.sender, invite.proposerRole, 0, RelStatus.Active);
        Relationship storage rel = _relationships[id];
        emit RelationshipAccepted(id, rel.buyer, rel.seller);
    }

    function _create(address proposer, address counterparty, Role proposerRole, uint64 expiresAt, RelStatus status)
        private
        returns (uint256 id)
    {
        if (proposer == counterparty) revert SelfRelationship();
        if (!factory.isAccount(proposer)) revert NotAccount(proposer);
        if (!factory.isAccount(counterparty)) revert NotAccount(counterparty);
        (address buyer, address seller) =
            proposerRole == Role.Buyer ? (proposer, counterparty) : (counterparty, proposer);

        uint256 existing = liveRelationship[buyer][seller];
        if (existing != 0) {
            Relationship storage old = _relationships[existing];
            // An expired proposal must not hold the pair forever, so a new one replaces it.
            if (old.status != RelStatus.Proposed || !_expired(old)) revert RelationshipExists(existing);
            old.status = RelStatus.Cancelled;
            emit RelationshipCancelled(existing, buyer, seller);
        }

        id = ++relationshipCount;
        _relationships[id] = Relationship({
            buyer: buyer,
            seller: seller,
            proposer: proposer,
            proposedAt: SafeCast.toUint64(block.timestamp),
            expiresAt: expiresAt,
            status: status
        });
        liveRelationship[buyer][seller] = id;
        emit RelationshipProposed(id, buyer, seller, proposer, expiresAt);
    }

    function _pendingForCounterparty(uint256 id) private view returns (Relationship storage rel) {
        rel = _relationships[id];
        if (rel.status != RelStatus.Proposed) revert NotProposed(id);
        if (_expired(rel)) revert ProposalExpired(id);
        address counterparty = rel.proposer == rel.buyer ? rel.seller : rel.buyer;
        if (msg.sender != counterparty) revert NotCounterparty();
    }

    function _expired(Relationship storage rel) private view returns (bool) {
        return rel.expiresAt != 0 && block.timestamp >= rel.expiresAt;
    }
}
